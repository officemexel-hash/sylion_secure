import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8080);
const app = createApp();
const server = await app.listen(port);

const address = server.address();
console.log(`SYLION Admin API listening on http://127.0.0.1:${address.port}`);

