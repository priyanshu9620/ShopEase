// Payment gateway factory used by controllers/productController.js (experiments 07 and 08).
//
//   PAYMENT_MOCK=true            use an in-process stand-in for Braintree (the lab cannot hammer the real
//                                sandbox at hundreds of req/s); PAYMENT_MOCK_DELAY_MS=120 base latency,
//                                PAYMENT_MOCK_HANG=true makes every call hang for PAYMENT_MOCK_HANG_MS (default 10 s)
//   BREAKER_ENABLED=true         wrap transaction.sale in an opossum circuit breaker: 2 s timeout, opens after
//                                50 % failures over ≥10 calls, half-open retry after 10 s. When open, calls fail
//                                in ~0 ms instead of waiting on a dead dependency.
//
// Both flags default off, so the app behaves exactly as before outside the lab.
import braintree from "braintree";
import CircuitBreaker from "opossum";
import { paymentCalls, paymentDuration, breakerState } from "./metrics.js";
import { redis, ready } from "./redis.js";

const mockEnabled = () => (process.env.PAYMENT_MOCK || "false") === "true";
const breakerEnabled = () => (process.env.BREAKER_ENABLED || "false") === "true";

function mockGateway() {
  const delay = Number(process.env.PAYMENT_MOCK_DELAY_MS || 120);
  return {
    transaction: {
      async sale(req, cb) {
        // hang mode: env for a static setting, or the Redis flag shopease:payment_hang toggled live by lab/hooks/payment-hang.sh
        let hang = (process.env.PAYMENT_MOCK_HANG || "false") === "true";
        if (!hang && ready()) { try { hang = (await redis.get("shopease:payment_hang")) === "1"; } catch { /* treat as healthy */ } }
        const ms = hang ? Number(process.env.PAYMENT_MOCK_HANG_MS || 10000) : delay + Math.random() * delay * 0.5;
        setTimeout(() => cb(null, { success: true, transaction: { id: `mock_${Date.now().toString(36)}`, status: "submitted_for_settlement", amount: String(req.amount) } }), ms);
      },
    },
    clientToken: { generate: (_, cb) => cb(null, { clientToken: "mock-client-token" }) },
  };
}

function realGateway() {
  return new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: process.env.BRAINTREE_MERCHANT_ID,
    publicKey: process.env.BRAINTREE_PUBLIC_KEY,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY,
  });
}

// promise form of transaction.sale with metrics
function saleAsync(gw, req) {
  const end = paymentDuration.startTimer();
  return new Promise((resolve, reject) => {
    gw.transaction.sale(req, (err, result) => {
      end();
      if (err || !result) { paymentCalls.labels("error").inc(); return reject(err || new Error("payment failed")); }
      paymentCalls.labels("ok").inc();
      resolve(result);
    });
  });
}

export function createGateway() {
  const gw = mockEnabled() ? mockGateway() : realGateway();
  if (!breakerEnabled()) return gw;

  const breaker = new CircuitBreaker((req) => saleAsync(gw, req), {
    timeout: Number(process.env.BREAKER_TIMEOUT_MS || 2000),
    errorThresholdPercentage: 50,
    volumeThreshold: 10,
    resetTimeout: Number(process.env.BREAKER_RESET_MS || 10000),
  });
  breaker.on("open", () => breakerState.set(2));
  breaker.on("halfOpen", () => breakerState.set(1));
  breaker.on("close", () => breakerState.set(0));
  breaker.on("timeout", () => paymentCalls.labels("timeout").inc());
  breaker.on("reject", () => paymentCalls.labels("rejected_open").inc()); // fast-fail while open
  breakerState.set(0);

  // same callback shape the controller expects, so the controller does not change
  return {
    ...gw,
    transaction: {
      sale(req, cb) {
        breaker.fire(req).then((r) => cb(null, r), (e) => cb(e, null));
      },
    },
  };
}
