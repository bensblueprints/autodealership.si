FROM node:22-bookworm-slim
WORKDIR /app
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund pg@8.16.3
