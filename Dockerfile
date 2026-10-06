# One image: builds the React app and runs the API (+ serves the build) on Node. Cloudflare deploy does not use this.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
RUN npm run build -w frontend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/backend
ENV SERVE_STATIC=1 HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["sh", "-c", "npx tsx src/cli/migrate.ts && if [ \"$SEED\" = \"1\" ]; then npx tsx src/cli/seed.ts; fi && exec npx tsx src/node.ts"]
