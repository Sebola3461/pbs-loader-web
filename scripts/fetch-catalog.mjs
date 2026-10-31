// Roda antes do build e do ng serve. CATALOG_SOURCE troca a fonte (URL https ou caminho de arquivo).
import { mkdir, writeFile } from 'node:fs/promises';
import { DEFAULT_CATALOG_SOURCE, loadCatalog } from './lib/catalog-source.mjs';

const source = process.env.CATALOG_SOURCE || DEFAULT_CATALOG_SOURCE;
const catalog = await loadCatalog(source);
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/catalog.json', `${JSON.stringify(catalog)}\n`);
console.log(`catálogo: ${catalog.mods.length} mod(s) de ${source}`);
