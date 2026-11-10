# ShopEase API (+ the committed React build) — single image used locally, in the lab and on EC2.
# glibc-based slim image so bcrypt's prebuilt native binary loads without a compiler.
FROM node:20.18.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install deps first so this layer is cached until package*.json change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source + the pre-built client (client/build is committed; Phase 4 moves it to S3/CloudFront).
COPY . .

# APP_VERSION is stamped by CI (git sha); /healthz reports it so rolling deploys are visible.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

USER node
EXPOSE 8080

# Same probe the ALB / compose use. No curl in slim, so use node's fetch.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
