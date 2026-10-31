# Arquitetura do site de mods

Site da comunidade para publicar, encontrar, avaliar e baixar mods do Proton Bus Simulator. Custo zero, sem servidor próprio.

## Requisitos

Funcionais:

1. Enviar mod (novo, nova versão, editar, remover) e listar mods.
2. Avaliação de 1 a 5 estrelas, um voto por usuário por mod.
3. Filtros e ordenação: criador, nome, data, tipo, versão do jogo, avaliação, downloads; busca por texto.
4. Modpacks (segunda fase).
5. Moderação: denúncia, ocultar mod, banir usuário.

Não funcionais:

- Custo zero e sem cartão cadastrado.
- Carga esperada: dezenas a poucas centenas de visitas por dia, algumas dezenas de envios por semana. O catálogo cabe inteiro no navegador (milhares de mods ainda são poucos MB).
- O `catalogo.json` lido pelo instalador continua sendo a fonte de verdade dos mods. O site não cria um segundo catálogo.
- Toda mudança em mod responde quem, quando e por qual operação.

## Visão geral

```
                      Google (login)
                           |
 navegador --- Angular estático (Cloudflare Pages)
     |                     |
     |  /api/*  -----> Pages Functions ----> D1 (usuários, notas, envios, denúncias)
     |                     |
     |                     +--- token do bot ---> repo do catálogo (PR por envio)
     |                                                 |
     |                                   Action: valida, faz merge, agrega
     |                                                 |
     |                     <--- deploy hook --- catálogo agregado publicado
     |
     +--- download ---> GitHub Releases do autor | link externo
```

| Dado | Onde fica | Por quê |
|---|---|---|
| Mods, versões, dono, modpacks | repo do catálogo (Git), um arquivo por mod | o instalador já lê daqui; o Git dá histórico e autoria |
| Arquivos dos mods | GitHub Releases do autor ou link externo | banda sem limite, sem custo, o arquivo não fica conosco |
| Capa do mod | repo do catálogo, 1 imagem WebP até 300 KB | sem storage pago; o navegador converte antes de enviar |
| Usuários, notas, envios, denúncias | Cloudflare D1 | muda a toda hora; não cabe em commit |
| Médias das notas | D1, servidas por `/api/stats` com cache curto | uma página gerada no build ficaria desatualizada |

## Repositórios

| Repo | Conteúdo |
|---|---|
| `pbs-loader` (este) | site Angular, Pages Functions, migrações do D1 |
| `pbs-loader-catalogo` (novo) | `mods/<id>.json`, `capas/<id>.webp`, JSON Schema, Action de validação e agregação |
| `pbsu-loader` | instalador e catálogo base (MelonLoader, mods obrigatórios); passa a ler também o catálogo da comunidade |

O catálogo da comunidade fica num repo próprio porque o token do bot precisa de escrita. Com ele no `pbsu-loader`, um token vazado poderia alterar o código do instalador.

Um arquivo por mod porque os PRs automáticos chegam ao mesmo tempo. Num arquivo único, dois envios simultâneos entram em conflito. A Action junta tudo em `catalogo-comunidade.json` a cada merge.

## Fluxos

### Login

1. Botão do Google Identity Services devolve um ID token.
2. `POST /api/session` confere assinatura (JWKS do Google), `aud`, `iss`, `exp` e `email_verified`.
3. Cria ou encontra o usuário pelo `sub`. No primeiro acesso ele escolhe um apelido. O nome do perfil Google é o nome real e não é publicado.
4. Cookie de sessão assinado (HMAC), `HttpOnly`, `Secure`, `SameSite=Lax`, 30 dias. Em cada escrita a Function confere `Origin` e o estado do usuário no D1, então banir vale na hora.

Só guardamos `sub` e apelido. E-mail não é armazenado.

### Envio de mod

1. Formulário no site: id, nome, tipo, descrição, versões do jogo, dependências e origem do arquivo, que pode ser uma release no GitHub (repo e prefixo da tag) ou um link externo. Capa opcional.
2. `POST /api/submissions` com chave de idempotência gerada no cliente.
3. A Function valida o schema, a posse (editar e remover exigem ser o dono ou moderador), o limite de envios por dia e, se for release, se ela existe e tem `digest`.
4. Grava a linha em `submissions` (`pending`), cria o branch `site/<mod-id>`, faz o commit e abre o PR com o token do bot.
5. No repo do catálogo, a Action valida de novo (o mesmo schema e as mesmas regras, já que nem todo PR vem do site), faz o merge sozinha, regenera o agregado e chama o deploy hook do Pages.
6. O site atualiza `submissions` para `merged` ou `rejected` ao consultar o PR.

Quem tem conta no GitHub pode abrir o PR direto; a Action é o mesmo portão.

### Avaliação

`PUT /api/mods/:id/rating` com `stars` de 1 a 5, ou `DELETE` para retirar o voto. Num batch atômico do D1: atualiza `ratings`, grava `rating_events` e ajusta `mod_rating_stats`. O dono não avalia o próprio mod. A ordenação por nota usa média bayesiana, para um mod com um único voto 5 não passar à frente de um com cem votos 4,8.

### Listagem, filtros e ordenação

No cliente, sobre o catálogo agregado (gerado no build) mais `/api/stats` (notas e downloads). Filtros na URL (`?tipo=onibus&ordem=nota`) para o link poder ser compartilhado. Cada mod e cada criador tem página pré-renderizada, para busca e prévia no Discord.

## Modelo de dados (D1)

D1 é SQLite: sem `timestamptz` nem enum, então datas ficam em texto ISO-8601 UTC conferido por CHECK, e conjuntos fixos também por CHECK. IDs públicos em UUIDv7.

```
users            id (uuidv7 PK), google_sub UNIQUE, nickname UNIQUE, role CHECK(user|moderator|admin),
                 status CHECK(active|banned), created_at, updated_at
user_events      id, user_id FK, actor_id FK, operation CHECK(create|rename|ban|unban|role), detail, created_at
ratings          (user_id FK, mod_id) PK, stars CHECK(1..5), created_at, updated_at
rating_events    id, user_id FK, mod_id, operation CHECK(set|remove), stars (NULL só em remove, por CHECK), created_at
mod_rating_stats mod_id PK, ratings_count CHECK(>=0), stars_sum CHECK(>=0)
submissions      id, user_id FK, mod_id, operation CHECK(publish|edit|remove|hide), idempotency_key,
                 status CHECK(pending|merged|rejected|failed), pr_number, error_code, created_at, updated_at,
                 UNIQUE(user_id, idempotency_key)
reports          id, reporter_id FK, mod_id, reason CHECK(...), detail, status CHECK(open|resolved|dismissed),
                 resolved_by FK, created_at, resolved_at
```

`mod_id` não tem FK porque os mods vivem no Git. A Function confere se o mod existe no catálogo publicado antes de gravar. Notas de mod removido ficam órfãs e são ignoradas pelas consultas.

Rastreabilidade: mudança em mod tem autor, data e operação no commit (`via site, user:<id>, operação:<op>`) e em `submissions`. Mudança de nota fica em `rating_events`, e mudança de usuário (apelido, banimento, papel) em `user_events`. Os três são só de inserção.

## Falhas

| Falha | Resposta |
|---|---|
| Entrada inválida | 400 com código estável (`invalid_mod_id`, `release_not_found`...) |
| Sem sessão ou banido | 401 ou 403 |
| Editar mod de outro | 403 |
| PR aberto para o mesmo mod | 409; o usuário espera o merge |
| Limite de envios | 429 |
| GitHub fora ou com limite de API | `submissions.status = failed` com `error_code`; o usuário reenvia com a mesma chave |
| JWKS do Google inacessível | 503 |
| Erro no D1 | 500 genérico; o detalhe vai só para o log |

## Autorização

| Ação | Quem |
|---|---|
| Ver, filtrar, baixar | qualquer pessoa |
| Avaliar, denunciar | usuário ativo |
| Publicar mod novo | usuário ativo, dentro do limite diário |
| Editar, nova versão, remover | dono do mod ou moderador |
| Ocultar mod, resolver denúncia, banir | moderador |
| Mudar papel | admin |

Spam: o Google não informa a idade da conta, então o controle fica em limite por usuário, banimento e na validação da Action.

## Confiança no instalador

| Nível | Critério | Instalador |
|---|---|---|
| Publicado | passou na Action | aba separada, com confirmação |
| Fonte verificada | release com attestation do GitHub Actions (`gh attestation verify`) | instala normalmente |
| Autor confiável | promovido por moderador | instala normalmente |
| Link externo | arquivo fora do GitHub | só no site, download manual |

## Observabilidade

Logs estruturados em JSON nas Functions, com id da requisição, rota, usuário, status e duração. Erros de GitHub e do D1 são logados com o código. A tabela `submissions` é o registro operacional dos envios.

## Revisar quando crescer

- Imagens no Git: se o repo do catálogo passar de ~1 GB, mover as capas para R2.
- Arquivos hospedados por nós (upload direto), se a maioria dos envios vier como link externo.
- Agregação das notas no D1, se a escrita concorrente virar gargalo (improvável nessa carga).
