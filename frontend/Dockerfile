FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx 1.27 ya no recibe parches (venía sobre Alpine 3.21, con libcrypto3,
# brotli-libs y libxml2 vulnerables). Se usa la rama estable actual y además
# se actualizan los paquetes del sistema al construir, para tomar los parches
# de seguridad publicados después de la imagen base.
FROM nginx:1.30-alpine
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
