FROM node:20-alpine AS builder

ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Production runner — Next.js standalone
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 80
CMD ["node", "server.js"]
