# Build stage
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl gnupg \
  && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh \
  && apk del curl gnupg

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["doppler", "run", "--", "node", "dist/index.js"]
