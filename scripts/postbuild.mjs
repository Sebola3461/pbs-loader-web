// Roda depois do ng build: node scripts/postbuild.mjs <pasta do site gerado>
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildHeaders, inlineScriptHashes } from './lib/static-headers.mjs';

const outDir = process.argv[2];
const htmlFiles = (await readdir(outDir, { recursive: true })).filter((f) => f.endsWith('.html'));

// Sem 404.html na raiz, o Cloudflare Pages trata o site como SPA e responde 200 com a home para qualquer caminho.
// O shell só do cliente serve para qualquer rota: o router decide o que mostrar.
await copyFile(join(outDir, 'index.csr.html'), join(outDir, '404.html'));

const hashes = [];
for (const file of htmlFiles)
  hashes.push(...inlineScriptHashes(await readFile(join(outDir, file), 'utf8')));
await writeFile(join(outDir, '_headers'), buildHeaders(hashes));
console.log(`${htmlFiles.length} página(s), ${new Set(hashes).size} script(s) inline na CSP`);
