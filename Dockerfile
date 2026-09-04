FROM node:20-alpine

WORKDIR /app

# No external dependencies to install — the app uses only Node's built-ins.
COPY . .

ENV PORT=3000
EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server.js"]
