FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Lector de PDF de las cartolas del RSH (pdftotext). Se lee en memoria; no se guarda ningún archivo.
RUN apk add --no-cache poppler-utils
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Logo que va al final de los correos (se puede cambiar desde Mi perfil).
COPY assets ./assets
EXPOSE 3000
CMD ["node", "dist/main"]
