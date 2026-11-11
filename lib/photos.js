// Product photos on S3 + CloudFront (Phase 4, experiment 11).
//
//   PHOTO_STORAGE=mongo (default)  photos stay as Buffers in the product document (original behaviour)
//   PHOTO_STORAGE=s3               after a product is created/updated with a photo, the buffer is uploaded
//                                  to s3://$PHOTO_BUCKET/photos/<pid>.<ext> and product.photoUrl is set to
//                                  $PHOTO_CDN_URL/photos/<pid>.<ext>; GET /product-photo/:pid then 302s
//                                  to the CDN URL, so the React client needs no change.
// The instance role (or local AWS profile) must allow s3:PutObject on the bucket.
import productModel from "../models/productModel.js";
import { photoRedirects } from "./metrics.js";

const s3Enabled = () => (process.env.PHOTO_STORAGE || "mongo") === "s3";
let s3 = null;
async function client() {
  if (!s3) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    s3 = new S3Client({ region: process.env.AWS_REGION || process.env.PHOTO_BUCKET_REGION || "ap-southeast-2" });
  }
  return s3;
}

export async function uploadPhoto(pid, buffer, contentType) {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `photos/${pid}.${ext}`;
  await (await client()).send(new PutObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: key, Body: buffer, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  return `${process.env.PHOTO_CDN_URL.replace(/\/$/, "")}/${key}`;
}

// Mount AFTER formidable and BEFORE create/updateProductController: once the controller has saved the
// product (it sends 201 with { products }), upload the photo and store the CDN URL.
export function syncPhotoToS3() {
  return function syncPhotoMiddleware(req, res, next) {
    if (!s3Enabled() || !process.env.PHOTO_BUCKET) return next();
    const send = res.send.bind(res);
    res.send = (body) => {
      try {
        const obj = typeof body === "string" ? JSON.parse(body) : body;
        const p = obj?.products;
        if (res.statusCode === 201 && p?._id && p?.photo?.data) {
          const buf = Buffer.isBuffer(p.photo.data) ? p.photo.data : Buffer.from(p.photo.data.data || p.photo.data);
          uploadPhoto(p._id, buf, p.photo.contentType)
            .then((url) => productModel.updateOne({ _id: p._id }, { $set: { photoUrl: url } }))
            .catch((e) => console.log(`photo upload failed: ${e.message}`));
        }
      } catch { /* not JSON, ignore */ }
      return send(body);
    };
    next();
  };
}

// Mount BEFORE productPhotoController: redirect to the CDN when the product has a photoUrl.
export function photoRedirect() {
  return async function photoRedirectMiddleware(req, res, next) {
    if (!s3Enabled()) return next();
    try {
      const p = await productModel.findById(req.params.pid).select("photoUrl").lean();
      if (p?.photoUrl) { photoRedirects.inc(); res.set("Cache-Control", "public, max-age=300"); return res.redirect(302, p.photoUrl); }
    } catch { /* fall through to the Mongo buffer */ }
    next();
  };
}
