import { createPublicPortalApp } from "./app.js";

const port = Number(process.env.PORT || 8088);
const host = process.env.HOST || "127.0.0.1";
const app = createPublicPortalApp();
const server = await app.listen(port, host);
const address = server.address();

console.log(`SYLION Public Portal listening on http://${address.address}:${address.port}`);
