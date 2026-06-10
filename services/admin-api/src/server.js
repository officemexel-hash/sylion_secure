import { createApp } from "./app.js";
import { SqliteStore } from "./storage/sqliteStore.js";
import { homedir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";
const defaultDbPath =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA || homedir(), "Sylion", "admin-api.sqlite")
    : "/var/lib/sylion/admin-api.sqlite";
const store =
  process.env.SYLION_DB_DISABLED === "true"
    ? null
    : new SqliteStore({ path: process.env.SYLION_DB_PATH || defaultDbPath });
const app = createApp({ store });
const server = await app.listen(port, host);

const address = server.address();
console.log(`SYLION Admin API listening on http://${address.address}:${address.port}`);
