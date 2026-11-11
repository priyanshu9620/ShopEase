// One-off migration (Phase 4): upload every product photo still only in Mongo to S3 and set photoUrl.
//   PHOTO_STORAGE=s3 PHOTO_BUCKET=… PHOTO_CDN_URL=… MONGO_URL=… node scripts/migrate-photos-to-s3.js
// Idempotent: skips products that already have photoUrl. Keeps the Mongo buffer (rollback = unset photoUrl).
import dotenv from "dotenv";
import mongoose from "mongoose";
import productModel from "../models/productModel.js";
import { uploadPhoto } from "../lib/photos.js";

dotenv.config();
await mongoose.connect(process.env.MONGO_URL, { dbName: "ecommerce" });
const cursor = productModel.find({ photoUrl: { $exists: false }, "photo.data": { $exists: true } }).select("photo").cursor();
let n = 0, failed = 0;
const t0 = Date.now();
for await (const p of cursor) {
  try {
    const url = await uploadPhoto(p._id, p.photo.data, p.photo.contentType || "image/png");
    await productModel.updateOne({ _id: p._id }, { $set: { photoUrl: url } });
    n++;
    if (n % 100 === 0) process.stdout.write(`\r  ${n} uploaded`);
  } catch (e) {
    failed++;
    console.log(`\n${p._id}: ${e.message}`);
  }
}
console.log(`\ndone: ${n} photos on S3, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await mongoose.disconnect();
