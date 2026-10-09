import { DatabaseSync } from "node:sqlite";
import { migrations } from "../../src/lib/migrations-manifest.js";

// Execute the production SQL against real SQLite, with D1's asynchronous facade.
export function memoryD1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) sqlite.exec(migration.createSQL);
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      const bound = {
        bind(...args) {
          values = args;
          return bound;
        },
        async first() {
          return statement.get(...values) || null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          return statement.run(...values);
        },
      };
      return bound;
    },
  };
}
