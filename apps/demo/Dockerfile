FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:demo

FROM nginx:1.27-alpine
COPY apps/demo/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/demo/dist /usr/share/nginx/html
EXPOSE 80 8080
CMD ["nginx", "-g", "daemon off;"]
