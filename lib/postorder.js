// Post-checkout work (experiment 07): the "send confirmation email + build invoice" step that every
// shop does after an order. Here it is simulated: write an order_notifications document and sleep
// POST_ORDER_WORK_MS (default 300) to stand in for a slow third-party email/SMS provider.
//
//   QUEUE_ENABLED=false  → done inline, before the checkout response is sent (baseline)
//   QUEUE_ENABLED=true   → a BullMQ job is enqueued in Redis and worker.js does the work (treatment)
//
// Mounted as a middleware on the payment route: it wraps res.json so the controller is untouched.
import mongoose from "mongoose";
import { Queue } from "bullmq";
import { queueDepth, postOrderDuration } from "./metrics.js";

export const QUEUE_NAME = "post-order";
const enabled = () => (process.env.QUEUE_ENABLED || "false") === "true";
const workMs = () => Number(process.env.POST_ORDER_WORK_MS || 300);

const notificationSchema = new mongoose.Schema({ buyer: mongoose.ObjectId, kind: String, via: String, createdAt: { type: Date, default: Date.now } });
export const Notification = mongoose.models.OrderNotification || mongoose.model("OrderNotification", notificationSchema, "order_notifications");

export async function doPostOrderWork({ buyer, via }) {
  const end = postOrderDuration.startTimer({ via });
  await new Promise((r) => setTimeout(r, workMs()));         // the slow provider
  await Notification.create({ buyer, kind: "order_confirmation", via });
  end();
}

let queue = null;
function getQueue() {
  if (!queue) {
    const u = new URL(process.env.REDIS_URL || "redis://localhost:6379");
    queue = new Queue(QUEUE_NAME, { connection: { host: u.hostname, port: Number(u.port || 6379) } });
    queueDepth.collect = async function () { try { this.set(await queue.getWaitingCount()); } catch { /* redis down: leave last value */ } };
  }
  return queue;
}

export function afterOrder() {
  return function afterOrderMiddleware(req, res, next) {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (!body || body.ok !== true) return json(body);
      const buyer = req.user?._id;
      if (enabled()) {
        getQueue().add("confirm", { buyer, via: "queue" }, { removeOnComplete: 1000, removeOnFail: 1000 }).catch(() => {});
        return json(body);
      }
      // inline: the user waits for the email provider
      return doPostOrderWork({ buyer, via: "inline" }).catch(() => {}).then(() => json(body));
    };
    next();
  };
}
