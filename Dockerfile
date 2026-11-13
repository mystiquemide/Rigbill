# Builds the web app and serves it with nginx. Build arg VITE_NETWORK picks
# the network (mainnet by default).
FROM node:22-alpine AS build
WORKDIR /app
COPY proof ./proof
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
ARG VITE_NETWORK=mainnet
ENV VITE_NETWORK=$VITE_NETWORK
RUN cd web && npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
