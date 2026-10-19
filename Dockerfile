# The toolchain IS the claim: a reproducible .mind only means anything against a declared
# environment, so everything that affects the output is pinned here.
#   node 20  - mind-ar's nested canvas 2.11.2 ships a prebuilt binary for this ABI and no other
#              we tested (node:22 refuses to load it)
#   mind-ar  - 1.2.5, which itself pins canvas 2.11.2 and TFJS 4.22.0
FROM node:20-bookworm

WORKDIR /work
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY det.mjs ./
CMD ["node", "det.mjs"]
