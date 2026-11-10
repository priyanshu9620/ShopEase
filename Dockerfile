# ShopEase — single image used locally, in the lab and on EC2.
#
# Stage 1 builds the React client; stage 2 is the slim runtime that serves the API and the build.
# (Phase 4 moves the build to S3/CloudFront; the API image then shrinks to stage 2 only.)

# ---------- stage 1: client build ----------
FROM node:20.18.0-bookworm-slim AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
# REACT_APP_API empty → same-origin API calls (see client/src/index.js)
ARG REACT_APP_API=
# CI is deliberately NOT set: CRA would turn the original code's eslint warnings into build errors.
ENV REACT_APP_API=${REACT_APP_API} GENERATE_SOURCEMAP=false
RUN npm run build

# ---------- stage 2: runtime ----------
# glibc-based slim image so bcrypt's prebuilt native binary loads without a compiler.
FROM node:20.18.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Install deps first so this layer is cached until package*.json change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# App source (client/ source is excluded by .dockerignore) + the built client from stage 1.
COPY . .
COPY --from=client /client/build ./client/build

# APP_VERSION is stamped by CI (git sha); /healthz reports it so rolling deploys are visible.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

USER node
EXPOSE 8080

# Same probe the ALB / compose use. No curl in slim, so use node's fetch.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
