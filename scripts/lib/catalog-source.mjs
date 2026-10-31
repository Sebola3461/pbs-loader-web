import { readFile } from 'node:fs/promises';

export const DEFAULT_CATALOG_SOURCE =
  'https://sebola3461.github.io/pbs-loader-catalogo/community-catalog.json';
export const SUPPORTED_FORMAT = 1;

// Os mesmos formatos do schema do pbs-loader-catalogo. O id e o dono viram caminhos de arquivo no pré-render
// (mods/<id>, autores/<slug>), então o site confere de novo em vez de confiar só na validação de lá.
const MOD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const SITE_USER = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasSafePaths(mod) {
  const owner = mod?.dono;
  const ownerOk = GITHUB_LOGIN.test(owner?.github ?? '') || SITE_USER.test(owner?.site ?? '');
  return typeof mod?.id === 'string' && MOD_ID.test(mod.id) && ownerOk;
}

/**
 * Confere o formato do catálogo publicado pelo pbs-loader-catalogo (formato novo exige atualizar o site) e tira
 * os mods com id ou dono fora do formato. warn recebe o id de cada mod descartado.
 */
export function parseCatalog(text, warn = () => {}) {
  const catalog = JSON.parse(text);
  if (catalog?.formato !== SUPPORTED_FORMAT)
    throw new Error(`formato de catálogo não suportado: ${catalog?.formato}`);
  if (!Array.isArray(catalog.mods)) throw new Error('catálogo sem a lista "mods"');
  const mods = catalog.mods.filter((mod) => {
    if (hasSafePaths(mod)) return true;
    warn(`mod descartado (id ou dono fora do formato): ${JSON.stringify(mod?.id)}`);
    return false;
  });
  return { ...catalog, mods };
}

/** Lê de uma URL https ou de um caminho local (para gerar o site sem rede). */
export async function loadCatalog(
  source,
  { fetchImpl = fetch, readFileImpl = readFile, warn = console.warn } = {},
) {
  if (!source.startsWith('https://')) return parseCatalog(await readFileImpl(source, 'utf8'), warn);
  const res = await fetchImpl(source, { headers: { 'User-Agent': 'pbs-loader-web' } });
  if (!res.ok) throw new Error(`não consegui baixar o catálogo de ${source} (${res.status})`);
  return parseCatalog(await res.text(), warn);
}
