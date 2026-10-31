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

1. Crie o banco e aplique a migração:

   ```
   npx wrangler d1 create pbs-loader-web
   npx wrangler d1 migrations apply pbs-loader-web --remote
   ```

   Copie o `database_id` que o primeiro comando mostra para o `wrangler.toml`.
2. No projeto Pages, em Settings → Bindings, ligue o D1 com o nome `DB`.
3. No Google Cloud, em APIs e serviços → Credenciais, crie um ID do cliente OAuth do tipo "Aplicativo da Web", com a origem JavaScript autorizada igual ao endereço do site (por exemplo `https://pbs-loader-web.pages.dev`). Não precisa de URI de redirecionamento.
4. No projeto Pages, em Settings → Variables, crie `GOOGLE_CLIENT_ID` com esse ID. Ele é público, vai para o navegador.

Sem `GOOGLE_CLIENT_ID`, o site funciona só para leitura, sem o botão de login.

### Testar a API localmente

```
CATALOG_SOURCE=fixtures/sample-catalog.json npm run build
npx wrangler d1 migrations apply pbs-loader-web --local
npx wrangler pages dev dist/pbs-loader-web/browser --binding GOOGLE_CLIENT_ID=<id>
```

Os testes do servidor rodam no Node, com o SQLite embutido no lugar do D1: `npx vitest run --config vitest.server.config.ts`.

## Licença

Código sob GPL-3.0.
