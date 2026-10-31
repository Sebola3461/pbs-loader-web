import { HttpError } from './http';

export const DEFAULT_CATALOG_URL =
  'https://sebola3461.github.io/pbs-loader-catalogo/community-catalog.json';
const TTL_MS = 5 * 60 * 1000;

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
