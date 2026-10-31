import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { Database, Statement } from '../db';

class SqliteStatement implements Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new SqliteStatement(this.db, this.sql, values as SQLInputValue[]);
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }

  async run(): Promise<unknown> {
    return this.db.prepare(this.sql).run(...this.values);
  }

  runSync(): void {
    this.db.prepare(this.sql).run(...this.values);
  }
}

/**
 * Banco em memória com a mesma migração do D1. O batch roda numa transação, como no D1, para os testes pegarem
 * escrita pela metade.
 */
export function createTestDatabase(): Database & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  // Aplica as migrações na ordem dos nomes, igual ao D1: banco de teste nunca diverge do de verdade.
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).sort()) {
    if (file.endsWith('.sql')) raw.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  return {
    raw,
    prepare: (sql) => new SqliteStatement(raw, sql),
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        for (const statement of statements) (statement as SqliteStatement).runSync();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
      return [];
    },
  };
}
