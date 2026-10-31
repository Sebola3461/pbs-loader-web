/**
 * O pedaço da API do D1 que o servidor usa. O D1 de verdade satisfaz esta interface, e os testes usam o SQLite do
 * Node atrás dela (server/testing/sqlite-d1.ts).
 */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Database {
  prepare(sql: string): Statement;
  /** Roda as instruções numa transação: ou todas valem, ou nenhuma. */
  batch(statements: Statement[]): Promise<unknown[]>;
}

export interface Env {
  DB: Database;
  GOOGLE_CLIENT_ID: string;
  CATALOG_URL?: string;
}

export function isUniqueViolation(error: unknown, column: string): boolean {
  return error instanceof Error && error.message.includes(`UNIQUE constraint failed: ${column}`);
}
