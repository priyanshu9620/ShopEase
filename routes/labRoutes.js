// Lab-only endpoints (experiment 09 — concurrency control). Mounted at /api/v1/lab only when
// LAB_ROUTES=true; never enabled in a real deployment.
//
//   POST /api/v1/lab/stock/:pid   {quantity}   reset a product's stock (test setup)
//   POST /api/v1/lab/buy/:pid                  buy one unit — OVERSELL_MODE=naive | atomic
//
// naive  : read the product, check quantity > 0, write quantity-1  (two round-trips: a race window)
// atomic : findOneAndUpdate({_id, quantity:{$gt:0}}, {$inc:{quantity:-1}})  (one conditional write;
//          Mongo guarantees the check and the decrement happen together on a single document)
import express from "express";
import productModel from "../models/productModel.js";
import { oversellSales } from "../lib/metrics.js";

const router = express.Router();
const mode = () => process.env.OVERSELL_MODE || "atomic";

router.post("/stock/:pid", async (req, res) => {
  const quantity = Number(req.body?.quantity ?? 1);
  await productModel.updateOne({ _id: req.params.pid }, { $set: { quantity } });
  res.json({ ok: true, quantity });
});

router.post("/buy/:pid", async (req, res) => {
  try {
    let sold = false;
    if (mode() === "naive") {
      const p = await productModel.findById(req.params.pid).select("quantity");
      if (p && p.quantity > 0) {
        await productModel.updateOne({ _id: p._id }, { $set: { quantity: p.quantity - 1 } });
        sold = true;
      }
    } else {
      const r = await productModel.findOneAndUpdate({ _id: req.params.pid, quantity: { $gt: 0 } }, { $inc: { quantity: -1 } }, { new: true, select: "quantity" });
      sold = Boolean(r);
    }
    oversellSales.labels(mode(), sold ? "sold" : "sold_out").inc();
    res.status(sold ? 200 : 409).json({ ok: sold, mode: mode() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/stock/:pid", async (req, res) => {
  const p = await productModel.findById(req.params.pid).select("quantity");
  res.json({ quantity: p?.quantity ?? null });
});

export default router;
