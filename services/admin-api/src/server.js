import { createApp } from "./app.js";
import { SqliteStore } from "./storage/sqliteStore.js";

const port = Number(process.env.PORT || 8080);
const store = process.env.SYLION_DB_PATH ? new SqliteStore({ path: process.env.SYLION_DB_PATH }) : null;
const app = createApp({ store });
const server = await app.listen(port);

const address = server.address();
console.log(`SYLION Admin API listening on http://127.0.0.1:${address.port}`);
