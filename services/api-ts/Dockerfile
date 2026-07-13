FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY services/api-ts/package.json services/api-ts/package.json
COPY apps/mobile/package.json* apps/mobile/
COPY tests/e2e/package.json* tests/e2e/
RUN npm install --workspace @dachang/api-ts --include-workspace-root
COPY services/api-ts services/api-ts
COPY packages packages
COPY activity-social-app-product/prototype/assets activity-social-app-product/prototype/assets
COPY activity-social-app-product/api activity-social-app-product/api
RUN npm --workspace @dachang/api-ts run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/services/api-ts/dist services/api-ts/dist
COPY --from=build /app/activity-social-app-product/prototype/assets activity-social-app-product/prototype/assets
COPY --from=build /app/activity-social-app-product/api activity-social-app-product/api
COPY --from=build /app/packages packages
WORKDIR /app/services/api-ts
EXPOSE 3100
CMD ["node", "dist/main.js"]
