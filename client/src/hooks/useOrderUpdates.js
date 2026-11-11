// Phase 4: live order status. Opens one socket.io connection (WebSocket only, so it works through any
// load balancer without stickiness) authenticated with the same JWT the API uses, and calls
// onUpdate({orderId, status}) whenever the admin changes one of this user's orders.
import { useEffect } from "react";
import { io } from "socket.io-client";
import { serverval } from "../index";

export default function useOrderUpdates(token, onUpdate) {
  useEffect(() => {
    if (!token) return undefined;
    const base = serverval === "/" ? window.location.origin : serverval.replace(/\/$/, "");
    const socket = io(base, { auth: { token }, transports: ["websocket"], path: "/socket.io" });
    socket.on("order:status", (e) => onUpdate(e));
    return () => socket.disconnect();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
}
