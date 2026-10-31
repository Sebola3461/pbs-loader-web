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
  CATALOG_URL?: string;
  /** Chave pública do widget Turnstile (vai para o navegador). Em dev, a chave de teste sempre passa. */
  TURNSTILE_SITE_KEY?: string;
  /** Chave secreta do Turnstile; sem ela o cadastro e o login falham fechados (503). */
  TURNSTILE_SECRET_KEY?: string;
  /** Itens de PBKDF2 opcional; para calibrar contra o limite de CPU do plano. */
  PBKDF2_ITERATIONS?: string;
}

export function isUniqueViolation(error: unknown, column: string): boolean {
  return error instanceof Error && error.message.includes(`UNIQUE constraint failed: ${column}`);
}
