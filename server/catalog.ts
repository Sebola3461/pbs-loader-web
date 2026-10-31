import { HttpError } from './http';

export const DEFAULT_CATALOG_URL =
  'https://sebola3461.github.io/pbs-loader-catalogo/community-catalog.json';
const TTL_MS = 5 * 60 * 1000;

/** Espelha src/app/catalog/catalog.model.ts; a autoridade final é o JSON Schema do repo do catálogo. */
export const MOD_TYPES = ['plugin', 'onibus', 'mapa', 'skin', 'destino', 'som', 'outro'] as const;
export type ModType = (typeof MOD_TYPES)[number];

/** Formato do id de mod: 2 a 64 de letras, números, "_" ou "-", começando por letra ou número. */
export const MOD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

export interface CatalogEntry {
  id: string;
  dono: { github?: string; site?: string };
}

interface Cache {
  mods: Map<string, CatalogEntry>;
  fetchedAt: number;
}

let cache: Cache | null = null;

export function resetCatalogCache(): void {
  cache = null;
}

/**
 * Mods publicados, por id, com cache de 5 minutos por isolate. Se o GitHub Pages falhar, segue com a última
 * cópia boa; sem nenhuma, responde 503 em vez de aceitar nota para mod que pode não existir.
 */
export async function catalogMods(
  url: string,
  { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<Map<string, CatalogEntry>> {
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.mods;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`catálogo respondeu ${res.status}`);
    const body = (await res.json()) as { mods?: CatalogEntry[] };
    cache = { mods: new Map((body.mods ?? []).map((m) => [m.id, m])), fetchedAt: now };
  } catch (error) {
    console.warn(
      JSON.stringify({
        warning: 'catalog_unavailable',
        stale: Boolean(cache),
        error: String(error),
      }),
    );
    if (!cache) throw new HttpError(503, 'catalog_unavailable');
  }
  return cache.mods;
}
