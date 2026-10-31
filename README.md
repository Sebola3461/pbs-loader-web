# Mods do PBS Loader

Site da comunidade para encontrar mods do Proton Bus Simulator. Lista o [catálogo da comunidade](https://github.com/Sebola3461/pbs-loader-catalogo) com busca, filtros e uma página por mod e por autor.

O site é estático: o Angular pré-renderiza todas as páginas no build, a partir do catálogo baixado na hora. Quando um mod entra no catálogo, o workflow de publicação de lá chama o deploy hook e o site é gerado de novo.

A arquitetura completa, incluindo as próximas etapas (login, avaliações e envio pelo site), está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Desenvolvimento

Precisa do Node 24.

```
npm ci
npm start                 # http://localhost:4200, com o catálogo publicado
npm test                  # testes do Angular (Vitest)
npm run test:coverage
npm run test:scripts      # testes dos scripts de build
```

Para trabalhar sem rede ou com mods de exemplo, aponte `CATALOG_SOURCE` para um arquivo:

```
CATALOG_SOURCE=fixtures/sample-catalog.json npm start
```

## Build

`npm run build` faz três passos:

1. `scripts/fetch-catalog.mjs` baixa o catálogo e grava `src/generated/catalog.json`. O build falha se o download falhar ou se o formato do catálogo não for o 1.
2. `ng build` pré-renderiza a home, cada mod (`/mods/<id>`), cada autor (`/autores/<slug>`) e a página de não encontrado.
3. `scripts/postbuild.mjs` copia a página de não encontrado para `404.html` e grava `_headers` com a CSP. Os scripts inline que o Angular gera entram na CSP pelo hash.

O resultado fica em `dist/pbs-loader-web/browser`.

## Deploy no Cloudflare Pages

No painel do Cloudflare, em Workers & Pages, crie um projeto Pages ligado a este repositório:

| Campo | Valor |
|---|---|
| Framework preset | None |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist/pbs-loader-web/browser` |
| Variável de ambiente | `NODE_VERSION` = `24` |

Depois, em Settings → Builds → Deploy hooks, crie um hook para a branch `main` e grave a URL dele como segredo `SITE_DEPLOY_HOOK` no repositório do catálogo. Assim o site é gerado de novo a cada mod publicado.

### Login e avaliações (Pages Functions + D1)

A API fica em `functions/api/` e a lógica em `server/`. Ela guarda usuários, sessões e notas no D1.

1. Crie o banco e aplique as migrações:

   ```
   npx wrangler d1 create pbs-loader-web
   npx wrangler d1 migrations apply pbs-loader-web --remote
   ```

   Copie o `database_id` que o primeiro comando mostra para o `wrangler.toml`.
2. No projeto Pages, em Settings → Bindings, ligue o D1 com o nome `DB`.
3. Crie uma conta no Turnstile (Cloudflare) para o domínio do site e no projeto Pages configure:
   - `TURNSTILE_SITE_KEY` (pública, vai para o navegador);
   - `TURNSTILE_SECRET_KEY` (segredo, cifrada — nunca no repositório).
4. Crie o admin com o script de seed (pede a senha no terminal e só imprime os comandos SQL):

   ```
   node scripts/create-admin.mjs
   ```

   Depois rode o INSERT com `--local` (desenvolvimento) ou `--remote` (produção), como o script mostra.

O login é usuário + senha com Turnstile. Sem as chaves do Turnstile configuradas, cadastro e login falham fechados (503) e o site fica só de leitura.

### Testar a API localmente

```
CATALOG_SOURCE=fixtures/sample-catalog.json npm run build
npx wrangler d1 migrations apply pbs-loader-web --local
npx wrangler pages dev dist/pbs-loader-web/browser
```

No local, o `wrangler.toml` já traz a chave de teste do Turnstile (sempre passa) e a secreta vem de `.dev.vars`.
Opcional: `PBKDF2_ITERATIONS` ajusta as iterações do hash de senha — meça o tempo antes de reduzir.

Os testes do servidor rodam no Node, com o SQLite embutido no lugar do D1: `npx vitest run --config vitest.server.config.ts`.

### Admin do site

O usuário administrador é criado pelo `scripts/create-admin.mjs` (padrão: username `HatsuneMiku`). Moderadores comuns ganham papel pelo banco (`role = 'moderator'`), sempre com evento no histórico.

## Licença

Código sob GPL-3.0.
