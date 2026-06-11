# Build the UI, then serve UI + API from the Node server.
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package.json package-lock.json* ./
# Runtime needs only optional deps (e.g. Firestore); the UI is prebuilt.
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/manage ./manage
COPY --from=builder /app/scripts ./scripts

EXPOSE 8080
CMD ["node", "manage/server.mjs"]
