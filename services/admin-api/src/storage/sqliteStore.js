import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class SqliteStore {
  constructor({ path = ":memory:" } = {}) {
    this.path = path;
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS kv_store (
        collection TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, key)
      );
    `);
    this.upsertStatement = this.db.prepare(`
      INSERT INTO kv_store (collection, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(collection, key)
      DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `);
    this.getStatement = this.db.prepare(`
      SELECT value_json FROM kv_store WHERE collection = ? AND key = ?
    `);
    this.listStatement = this.db.prepare(`
      SELECT value_json FROM kv_store WHERE collection = ? ORDER BY updated_at ASC
    `);
    this.deleteStatement = this.db.prepare(`
      DELETE FROM kv_store WHERE collection = ? AND key = ?
    `);
  }

  save(collection, key, value) {
    this.upsertStatement.run(collection, key, JSON.stringify(value), new Date().toISOString());
    return value;
  }

  get(collection, key) {
    const row = this.getStatement.get(collection, key);
    return row ? JSON.parse(row.value_json) : null;
  }

  list(collection) {
    return this.listStatement.all(collection).map((row) => JSON.parse(row.value_json));
  }

  listEntries(collection) {
    return this.db.prepare(`
      SELECT key, value_json FROM kv_store WHERE collection = ? ORDER BY updated_at ASC
    `).all(collection).map((row) => ({
      key: row.key,
      value: JSON.parse(row.value_json)
    }));
  }

  delete(collection, key) {
    this.deleteStatement.run(collection, key);
  }

  close() {
    this.db.close();
  }
}
