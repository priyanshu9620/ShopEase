# The experiment runner: docker CLI + compose plugin + node. Runs with the host's docker socket
# mounted, so "docker compose" inside it controls the same stack the laptop sees.
FROM docker:27.3.1-cli
RUN apk add --no-cache nodejs=~20 npm curl
WORKDIR /runner
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# the scripts live in the image (ESM resolves node_modules next to the file); the repo is mounted at /work
COPY run.js report.mjs aws-report.mjs ./
# the base image's entrypoint is `docker`; we want a plain shell/node
ENTRYPOINT []
CMD ["node", "/runner/run.js"]
