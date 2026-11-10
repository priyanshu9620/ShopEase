// Deterministic benchmark dataset. Idempotent: re-running upserts by slug/email and never duplicates.
//
//   node scripts/seed.js                 # SEED_PRODUCTS (default 5000) products, 12 categories, 2 users
//   SEED_PRODUCTS=50000 node scripts/seed.js
//
// Photos are generated PNGs (no external files, no new dependency) so the product-photo endpoint
// serves realistic ~20–60 KB bodies, which is what the caching / CDN experiments measure.
import dotenv from "dotenv";
import mongoose from "mongoose";
import slugify from "slugify";
import zlib from "zlib";
import productModel from "../models/productModel.js";
import categoryModel from "../models/categoryModel.js";
import userModel from "../models/userModel.js";
import { hashPassword } from "../helpers/authHelper.js";

dotenv.config();

const N = parseInt(process.env.SEED_PRODUCTS || "5000", 10);
const PHOTO_PX = parseInt(process.env.SEED_PHOTO_PX || "256", 10);
const BATCH = 250;

const CATEGORIES = [
  "Electronics", "Books", "Clothing", "Home & Kitchen", "Sports", "Toys",
  "Beauty", "Grocery", "Automotive", "Garden", "Music", "Office",
];
const ADJ = ["Classic", "Premium", "Compact", "Wireless", "Organic", "Vintage", "Smart", "Portable", "Eco", "Pro", "Mini", "Ultra"];
const NOUN = ["Lamp", "Speaker", "Jacket", "Novel", "Blender", "Backpack", "Watch", "Kettle", "Sneakers", "Headphones", "Notebook", "Tent"];

// mulberry32: tiny seeded PRNG so every run produces the same products and photos.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- minimal PNG encoder (RGB, 8-bit) ------------------------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePhoto(rand, px) {
  const raw = Buffer.alloc((px * 3 + 1) * px);
  const base = [rand() * 255, rand() * 255, rand() * 255];
  // a few random rectangles on a gradient: looks like a product thumbnail, compresses to tens of KB
  const rects = Array.from({ length: 6 }, () => ({
    x: rand() * px, y: rand() * px, w: rand() * px * 0.5, h: rand() * px * 0.5,
    c: [rand() * 255, rand() * 255, rand() * 255],
  }));
  for (let y = 0; y < px; y++) {
    const row = y * (px * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < px; x++) {
      let r = base[0] * (x / px), g = base[1] * (y / px), b = base[2] * ((x + y) / (2 * px));
      for (const q of rects) if (x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) [r, g, b] = q.c;
      // coarse 8×8 noise blocks so it looks textured but still compresses to tens of KB
      const n = ((x >> 3) * 31 + (y >> 3) * 17 + base[0]) % 13 - 6;
      const o = row + 1 + x * 3;
      raw[o] = Math.max(0, Math.min(255, r + n));
      raw[o + 1] = Math.max(0, Math.min(255, g + n));
      raw[o + 2] = Math.max(0, Math.min(255, b + n));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0); ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- main ----------------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  await mongoose.connect(process.env.MONGO_URL, { dbName: "ecommerce" });
  console.log(`connected to ${mongoose.connection.host}, seeding ${N} products (${PHOTO_PX}px photos)`);

  // users (role 1 = admin, matches middlewares/authMiddleware.js)
  const users = [
    { name: "Admin", email: "admin@shopease.local", pw: process.env.SEED_ADMIN_PASSWORD || "admin123", role: 1 },
    { name: "Buyer", email: "buyer@shopease.local", pw: process.env.SEED_BUYER_PASSWORD || "buyer123", role: 0 },
  ];
  for (const u of users) {
    await userModel.updateOne(
      { email: u.email },
      { $setOnInsert: { name: u.name, email: u.email, password: await hashPassword(u.pw), phone: "9999999999", address: "Lab Street 1", answer: "lab", role: u.role } },
      { upsert: true }
    );
  }

  // categories
  const catIds = [];
  for (const name of CATEGORIES) {
    const slug = slugify(name).toLowerCase();
    const doc = await categoryModel.findOneAndUpdate({ slug }, { $setOnInsert: { name, slug } }, { upsert: true, new: true });
    catIds.push(doc._id);
  }

  // products, in batches, upsert by slug; existing slugs are skipped without regenerating photos
  if (process.env.SEED_RESET === "1") {
    const r = await productModel.deleteMany({});
    console.log(`SEED_RESET=1: deleted ${r.deletedCount} products`);
  }
  const existing = new Set((await productModel.find({}, { slug: 1, _id: 0 }).lean()).map((p) => p.slug));
  const rand = rng(42);
  let written = 0;
  for (let start = 1; start <= N; start += BATCH) {
    const ops = [];
    for (let i = start; i < Math.min(start + BATCH, N + 1); i++) {
      const name = `${ADJ[Math.floor(rand() * ADJ.length)]} ${NOUN[Math.floor(rand() * NOUN.length)]} ${String(i).padStart(5, "0")}`;
      const slug = slugify(name).toLowerCase();
      if (existing.has(slug)) {
        // keep the PRNG stream aligned so later products are unchanged
        makePhoto(rand, 1); rand(); rand(); rand();
        continue;
      }
      ops.push({
        updateOne: {
          filter: { slug },
          update: {
            $setOnInsert: {
              name, slug,
              description: `${name}. Seeded product #${i} for the ShopEase lab; lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
              price: Math.round(99 + rand() * 9900),
              category: catIds[i % catIds.length],
              quantity: Math.floor(rand() * 500) + 1,
              shipping: rand() > 0.3,
              photo: { data: makePhoto(rand, PHOTO_PX), contentType: "image/png" },
            },
          },
          upsert: true,
        },
      });
    }
    if (ops.length) {
      const r = await productModel.bulkWrite(ops, { ordered: false });
      written += r.upsertedCount;
    }
    process.stdout.write(`\r  ${Math.min(start + BATCH - 1, N)}/${N} (new: ${written})`);
  }
  const total = await productModel.countDocuments();
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${total} products, ${catIds.length} categories, ${users.length} users`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
