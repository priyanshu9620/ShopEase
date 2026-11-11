// Real-time order tracking (Phase 4, experiment 12): socket.io on the same HTTP server.
//
//   client:  io(url, { auth: { token }, transports: ["websocket"] })  → joins room user:<id>
//   server:  emitOrderStatus(buyerId, order)  → "order:status" to that room on EVERY replica,
//            because the Redis adapter relays emits between replicas (pub/sub). Without it an
//            update handled by replica A never reaches a socket connected to replica B.
//
// transports: ["websocket"] on the client skips the HTTP long-polling handshake, so no load-balancer
// stickiness is needed (nginx and the ALB both pass WebSocket upgrades).
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import JWT from "jsonwebtoken";
import { socketConnections, realtimeEvents } from "./metrics.js";

let io = null;

export async function attachRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: "*" }, path: "/socket.io" });

  // REALTIME_ADAPTER=false disables the relay (experiment 12's "what if we forgot" arm)
  if (process.env.REDIS_URL && (process.env.REALTIME_ADAPTER || "true") === "true") {
    const { createClient } = await import("redis");
    const pub = createClient({ url: process.env.REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
  }

  // JWT from the app's own login; same secret and shape as middlewares/authMiddleware.js
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      const decoded = JWT.verify(token, process.env.JWT_SECRET);
      socket.data.userId = String(decoded._id);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);
    socketConnections.inc();
    socket.emit("hello", { replica: process.env.HOSTNAME || "local", at: Date.now() });
    socket.on("disconnect", () => socketConnections.dec());
  });
  return io;
}

export function emitOrderStatus(buyerId, order) {
  if (!io || !buyerId) return;
  io.to(`user:${buyerId}`).emit("order:status", { orderId: String(order._id), status: order.status, at: Date.now(), replica: process.env.HOSTNAME || "local" });
  realtimeEvents.labels("order:status").inc();
}

// Mount on PUT /order-status/:orderId AFTER auth, BEFORE the controller: wraps res.json so the
// controller is untouched; the controller returns the updated order with its buyer id.
export function afterOrderStatus() {
  return function afterOrderStatusMiddleware(req, res, next) {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (body && body._id && body.buyer) emitOrderStatus(String(body.buyer), body);
      return json(body);
    };
    next();
  };
}
