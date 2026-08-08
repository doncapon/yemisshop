# syntax = docker/dockerfile:1

ARG NODE_VERSION=23.11.0
FROM node:${NODE_VERSION}-slim AS build

WORKDIR /app

COPY package-lock.json package.json ./
RUN npm ci --include=dev

COPY . .

ARG VITE_API_URL
ARG VITE_APP_URL
ARG VITE_TAWK_TO_WIDGET_ID
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_TAWK_TO_WIDGET_ID=$VITE_TAWK_TO_WIDGET_ID

RUN npm run build

FROM nginx:latest

COPY --from=build /app/dist /usr/share/nginx/html

# ✅ add nginx SPA fallback config
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["/usr/sbin/nginx", "-g", "daemon off;"]
