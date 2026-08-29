FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com

COPY . .

EXPOSE 9000

CMD ["node", "src/index.js"]
