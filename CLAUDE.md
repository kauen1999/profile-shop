# PokeShopping (repositório: profile-shop)

**Rebrand em 2026-07-13**: o produto se chama **PokeShopping** (nome de pasta/
repositório continua `profile-shop`, não renomeado — mudar isso tem custo
técnico maior, não pedido). Mudança de conceito junto com o nome: deixou de
ser um marketplace único e virou uma plataforma onde cada usuário cria sua
própria loja — ver `frontend/src/pages/Landing.jsx`.

Este arquivo é a **memória operacional específica do Claude Code** — estado
atual, decisões recentes, detalhes de implementação. Regras invariáveis de
arquitetura (o que nunca muda, independente de ferramenta) estão em
**[`ARCHITECTURE_RULES.md`](./ARCHITECTURE_RULES.md)**; como o trabalho é
organizado em papéis está em **[`DEVELOPMENT_PROCESS.md`](./DEVELOPMENT_PROCESS.md)**.
Visão geral do projeto está no **[`README.md`](./README.md)**. A arquitetura
detalhada do pipeline do catálogo (estado ativo, componentes legados,
decisões de domínio, o que não alterar sem revisão) está em
**[`CATALOG_PIPELINE.md`](./CATALOG_PIPELINE.md)**. Sem testes automatizados
neste projeto.

> **Manutenção deste arquivo**: toda vez que uma mudança relevante for feita no
> sistema (schema novo, script de sync novo, rota nova, número de itens/categorias
> mudou de forma material), **atualize as seções correspondentes deste CLAUDE.md
> antes de terminar a tarefa** — principalmente "Estado atual do catálogo" (números
> ficam velhos rápido) e qualquer tabela/lista que passe a estar incompleta. Se a
> mudança for uma **regra invariável nova** (não um estado/contexto), ela vai em
> `ARCHITECTURE_RULES.md`, não aqui. O objetivo é nenhum dos dois arquivos ficar
> defasado a ponto de uma sessão futura (pós-compactação de contexto) tomar decisão
> errada por achar que algo ainda não existe, ou duplicar trabalho já feito.

## Como trabalhamos

Papéis e processo estão descritos de forma agnóstica de ferramenta em
`DEVELOPMENT_PROCESS.md`. Nesta ferramenta (Claude Code) especificamente:

- Papel **Servidor & Catálogo** → subagente `.claude/agents/backend-catalog.md`.
- Papel **Interface** → subagente `.claude/agents/frontend.md`. Esse
  subagente sempre verifica mobile-first contra **375×667** como piso
  mínimo real (não só escreve CSS "mobile-first de memória") — ver Regra 6
  de `ARCHITECTURE_RULES.md` e a seção própria no arquivo do subagente.
- Momento **Revisão de arquitetura** → modo `Plan` (`EnterPlanMode`).
- Momentos **Revisão de segurança** / **Revisão de performance** → skill
  `/code-review ultra` (revisão multi-agente da branch atual).
- Demais momentos ocasionais (schema, bootstrap de testes/CI, release) ainda
  não têm uma capacidade dedicada nesta ferramenta — tratar como tarefa pontual
  quando surgir a necessidade.

Se trocar de ferramenta de IA no futuro, só esta seção + os arquivos em
`.claude/agents/` precisam ser reconstruídos — `ARCHITECTURE_RULES.md` e
`DEVELOPMENT_PROCESS.md` continuam valendo sem alteração.

## Rodando localmente

```bash
npm start              # backend em http://localhost:3000
cd frontend && npm run dev   # frontend em http://localhost:5173
```

`.env` (raiz) tem `DATABASE_URL` do Neon — **nunca** logar ou colar esse valor em
lugar público. Também tem `FIREBASE_SERVICE_ACCOUNT_PATH` (caminho relativo à raiz
do repo pro JSON de service account do Firebase Admin SDK, ex:
`./firebase-service-account.json`) — o arquivo apontado está no `.gitignore`,
**nunca** ler/colar o conteúdo dele em lugar público. `frontend/.env` tem
`VITE_API_URL`.

**Neon hiberna após inatividade.** A primeira query depois de acordar pode falhar
uma vez. Todas as rotas em `src/index.js` e `src/routes/catalogItems.js` passam por
`src/asyncHandler.js` + um middleware de erro global — isso existe especificamente
para não deixar essa falha transitória derrubar o processo Node inteiro (já
aconteceu antes dessa correção). Se adicionar uma rota nova, sempre envolva com
`asyncHandler(async (req, res) => {...})`.

## Vulnerabilidades de dependência + rede de testes de negócio (2026-07-22)

**8 vulnerabilidades corrigidas via `npm overrides`, sem tocar
`firebase-admin`**: `npm audit` mostrava 8 vulnerabilidades moderadas, todas
com a mesma causa raiz — uma versão antiga de `uuid` (< 11.1.1) puxada por
duas cadeias transitivas dentro do `firebase-admin`:
`@google-cloud/firestore` → `google-gax` → `uuid`/`retry-request`, e
`@google-cloud/storage` → `teeny-request` → `uuid`. Este projeto usa
`firebase-admin` só pra `admin.credential.cert()` +
`admin.auth().verifyIdToken()` (`src/firebaseAdmin.js`) — nunca toca
Firestore nem Cloud Storage, então as duas cadeias inteiras carregam
funcionalidade não utilizada com uma dependência vulnerável.
**Testado em isolamento antes de aplicar** (diretório de scratch): atualizar
`firebase-admin` pra `14.2.0` **não resolve** (`@google-cloud/storage@7.21.0`
continua puxando `uuid@9.0.1`, 6 vulnerabilidades permanecem); adicionar
`"overrides": { "uuid": "^11.1.1" }` **mantendo `firebase-admin` na versão já
fixada `^13.10.0`** resolve as 8 por completo (`npm audit` → 0). Aplicado no
`package.json` raiz, `npm install` rodado, `package-lock.json` regenerado.
Verificado: `npm ls uuid` → só `11.1.1` na árvore inteira (as duas cadeias);
backend reiniciado, `GET /health` limpo; `POST /auth/google` com token
inválido continua devolvendo `401` limpo (mesma superfície de Firebase Admin
usada hoje, nenhuma mudança de comportamento).

**Rede de testes automatizada para `src/routes/stores.js`** — motivado por
um risco real já materializado nesta sessão: o bug de
`extraMoveCount`/`presetSlotCount` nunca persistidos (só descoberto por
reclamação de usuário, nunca por teste) é exatamente a classe de regressão
que esta rede agora cobre. Novo `test/storeRoutes.test.js`, 5 casos, todos
autocontidos (criam seu próprio `User`/`Store`/`CatalogItem` com
`wikiPageId` sintético na faixa `999_600_000+` — fora de qualquer faixa já
documentada neste arquivo e do id fixo usado por `deduplication.test.js` —
e apagam tudo num `finally`, nunca dependem de dado acumulado):
1. Isolamento de posse — `PATCH`/`DELETE` de item/Pokémon contra a loja de
   outro dono sempre `404`, e a linha do dono real sobrevive intocada.
2. Transição de status ⇄ `soldAt` — marcar `SOLD` grava timestamp real,
   reverter pra `ACTIVE` limpa pra `null` (item e Pokémon).
3. Validação de preço — `POST /me/items` sem preço, com `0`, ou negativo →
   `400`; positivo → `201`.
4. Validação de Mundo — `world` fora dos `StoreWorld` cadastrados pela loja
   → `400` (inclusive loja sem nenhum mundo cadastrado); dentro → `201`.
5. `extraMoveCount`/`presetSlotCount` — persistidos como número (não só o
   texto derivado) na criação e na edição; valor acima do cap real da
   espécie → `400` nos dois. Usa a mesma falha em cascata documentada em
   `computeExtraMovesCap` (`src/routes/storePokemonOptions.js`) a favor:
   como o `wikiPageId` sintético nunca bate em `data/wiki-crawl/index.json`,
   o cap sempre cai no fallback `maxExtraMoves: 10` — determinístico em
   qualquer ambiente, inclusive numa CI onde `data/wiki-crawl/` (gitignored)
   nem existe.

**Técnica de invocação** (reusa a mesma já documentada nesta sessão pra
testar rota protegida por `requireAuth` sem token Firebase real — nunca
precisou de biblioteca de mock nova): localiza o handler final na pilha do
próprio router (`router.stack`, pulando `requireAuth`) e invoca com um
`req`/`res`/`next` fake, `req.currentUser` setado direto pra um `User` real
do banco. Cuidado reaplicado: `asyncHandler` não retorna a Promise interna
— a invocação envolve numa `new Promise` que resolve via `res.json()` e
rejeita via um `next(err)` de verdade.

**Verificado que os testes realmente pegam regressão, não só passam à
toa**: sabotagem temporária de `data.soldAt = status === 'SOLD' ? new
Date() : null` (comentada) fez o teste 2 falhar exatamente como esperado
(`'item soldAt must be set after marking SOLD'`); revertido, `node -c` +
suíte inteira voltando a verde. Rodado contra o Neon real de dev (única
opção neste ambiente — sem Docker/Postgres local disponível pra simular o
container efêmero da CI) — confirmado sem nenhum resíduo depois (`0`
usuários/itens de catálogo com o namespace de teste, checado por query
direta).

**Achado preciso sobre os 3 testes de banco já existentes, que motivou a
descoberta acima**: `deduplication.test.js` é autocontido (cria/apaga sua
própria linha de fixture) — **portável pra qualquer Postgres vazio**,
incluindo um container efêmero; `dailyBossAccess.test.js` é um **canário de
dado de produção** (verifica que uma categoria apagada em 2026-07-15
continua com 0 linhas no banco real) — rodar contra um banco vazio seria um
"passa" sem propósito, não é portável nem faz sentido tentar;
`syncIdempotency.test.js` roda um script de sync real que lê de
`data/wiki-crawl/` (gitignored, não existe num checkout de CI) — bloqueado
por ausência de dado, não pelo banco. Só o primeiro + o `storeRoutes.test.js`
novo entram na CI; os outros 2 continuam manuais, agora por motivo
documentado com precisão (não só "flakiness" genérico).

**CI (`.github/workflows/ci.yml`)**: novo job `test-db` — sobe um
`postgres:16` efêmero via `services:` do GitHub Actions (nunca o Neon real,
sem secret novo — a URL de conexão é sempre a mesma, local ao runner),
`npx prisma db push --skip-generate` cria o schema do zero, depois `node
--test test/deduplication.test.js test/storeRoutes.test.js`. Jobs
`backend`/`frontend` já existentes intocados. YAML validado
sintaticamente (`yaml.safe_load`) — **não verificado ainda rodando de
verdade no GitHub** (esta sessão não tem Docker/Postgres local pra simular
o job completo, e abrir um PR de teste exigiria commitar/empurrar pro
remoto, fora do escopo de uma mudança sem pedido explícito do usuário para
esse passo específico) — a lógica em si (mesmos comandos, mesmos 2
arquivos de teste) já roda limpa localmente contra um Postgres real
(Neon), só a etapa "container efêmero espec[í]fico do Actions" fica
pendente de confirmação na primeira vez que este workflow rodar de
verdade. **Branch protection ainda não foi atualizada** pra exigir o
check `test-db` — deliberadamente adiado até essa primeira execução real
confirmar verde (adicionar um check obrigatório que nunca passou
travaria todo merge futuro, incluindo do próprio dono, já que
`enforce_admins: true`).

## O banco: CatalogItem é o hub

Schema em `prisma/schema.prisma`. **Prisma fixado em 6.x, não atualizar para 7.x** —
o Prisma 7 quebra `url` no `datasource` do schema (exige `prisma.config.ts` +
adapter), incompatível com o setup atual.

`CatalogItem` (chave primária `wikiPageId: Int`) é o hub do catálogo. O modelo
`category`/`subcategories` segue a regra 1 de `ARCHITECTURE_RULES.md`
(categoria = o que é, nunca de onde veio); detalhes operacionais específicos
deste projeto:
- `category`: 41 categorias hoje (`pokemon`, `evolution-items`, `held-items`,
  `addons`, `materials`, etc.)
- `extractedFields` (Json) = tudo mais, incluindo:
  - `extractedFields.subcategories: string[]` = onde o item é usado/obtido.
    Valores possíveis: `eventSources`, `dailyBossSources`,
    `dailyBossAccessSources`, `dungeonSources`, `questSources`,
    `npcShopSources`, `minigameSources`, `craftSystemSource`, `craftIngredient`,
    `battlePassSources`. Cada chave homônima em `extractedFields` (ex:
    `dailyBossSources`) guarda o detalhe (array de `{boss, section, cooldown}` etc).
  - Exemplo real: **Dusk Stone** — `category: evolution-items`,
    `subcategories: [eventSources, dailyBossSources, dungeonSources, questSources,
    craftIngredient]` — é o item mais "cruzado" do catálogo (5 sistemas).
  - Campos do pipeline legado (pré-existente, não fui eu que criei):
    `sections`, `infoboxFields`, `addonSources`, `tmSources`,
    `backpackSourceWikiTitle/Url`, `cherishBall*`, `megaStone*`. Não são
    subcategorias, são proveniência de extração — não misturar na lógica de
    subcategorias (`src/wiki-crawler/parsers/syncSubcategories.js` já ignora esses
    de propósito).

**Regra de ouro ao criar itens em qualquer script de sync** (regra 2 de
`ARCHITECTURE_RULES.md`, aplicada aqui): antes de criar uma linha nova, sempre
faça `findFirst` por `wikiTitle` **e** por `name` (case-insensitive) em
**qualquer categoria** — se já existir (ex: "Fire Stone" já é
`evolution-items`), **não duplicar**; só atualizar `extractedFields` com a
subcategoria nova, mantendo a `category` original. Isso é o que faz o Dusk
Stone funcionar, e checar só `wikiTitle` foi o que escondeu o bug de
`mega-stones` (ver "Estado atual do catálogo" abaixo) — checar os dois campos.
A exceção é `battlePass:sync`, que por decisão de design antiga usa
`findUnique` por um `wikiPageId` próprio (não faz cross-link com outras
categorias) — inconsistência conhecida, não "corrigir" sem perguntar.

### Tabelas do schema sem consumidor real (2026-07-13)

`prisma/schema.prisma` tem 6 modelos — `WikiPage`, `SyncExecution`,
`ParserAuditRecord`, `CatalogItemLineage`, `ReplaySnapshot`, `WikiSyncLog` —
que **têm dado histórico real no banco** (`WikiPage`: 993 linhas,
`ParserAuditRecord`: 70, `CatalogItemLineage`: 34, `WikiSyncLog`: 10,
`SyncExecution`: 2, `ReplaySnapshot`: 2), mas **nenhum script/rota atual em
`src/`, `frontend/src/` ou `scripts/` lê ou escreve em nenhuma delas**
(confirmado por busca exaustiva no repositório inteiro, não só nos scripts de
sync). Não são tabelas vazias/nunca-usadas — são **infraestrutura de uma
geração anterior do pipeline**, abandonada sem migração nem descomissionamento
formal, quando os scripts `sync*.js` atuais passaram a escrever direto em
`CatalogItem` sem registrar execução/auditoria/linhagem.

Note em particular: `WikiPage` (993 linhas, campos `pageId`/`title`/
`wikitext`/`html`) é um mecanismo de armazenamento de wikitext **totalmente
separado e dessincronizado** de `data/wiki-crawl/*.json` (1897 páginas, ver
seção "Wiki crawler" abaixo) — os números não batem porque são pipelines
diferentes; todo parser atual lê de `data/wiki-crawl/`, nenhum lê de
`WikiPage`.

**Decisão registrada**: não dropar/alterar essas tabelas sem justificativa
concreta (constraint deste projeto) — ficam como estão, só documentadas aqui
pra não serem confundidas com infraestrutura ativa numa sessão futura, nem
levar alguém a gastar tempo comprovando de novo que estão órfãs.

### Campos denormalizados sem consumidor confirmado

`extractedFields.mainCategory` (escrito só por `syncSubcategories.js:54`) e
`CatalogItem.slug` (usado só internamente pra evitar colisão na criação, via
o `usedSlugs` Set de cada script) **não têm nenhum consumidor real** —
busca no repositório inteiro (`src/`, `frontend/src/`) não encontra leitura
de `mainCategory` em lugar nenhum, e `slug` não aparece em nenhuma rota nem
componente do frontend (só é devolvido de graça porque as queries não usam
`select`). Ambos podem ficar desatualizados depois de uma reclassificação
manual de `category` (confirmado: 399/809 itens com `mainCategory`
divergente do `category` real) sem nenhuma consequência funcional hoje — não
é bug ativo, é inconsistência silenciosa sem efeito observável, então não foi
corrigida (corrigir exigiria complexidade nova — atualizar os dois campos em
todo update de `category` — sem nenhum ganho funcional real, já que nada os
lê).

### IDs sintéticos (itens sem página própria na wiki)

Vários itens (recompensas de quest, drops de boss, ingredientes de craft) não têm
página própria — o `wikiPageId` é um hash MD5 do nome, deslocado por uma faixa
numérica fixa por sistema, para nunca colidir:

| Faixa (soma) | Sistema | Script |
|---|---|---|
| `1_000_000_000 + realId` | pokemon-shiny | `syncShinyPokemonCatalog.js` |
| `1_100_000_000 + hash` | craft-system (Bill's Grandfather/Sister) | `syncCraftSystemCatalog.js` |
| `1_200_000_000 + hash` | quest-rewards | `syncQuestCatalog.js` |
| `1_300_000_000 + hash` | dungeon-drops | `syncDungeonCatalog.js` |
| `1_400_000_000 + hash` | craft-ingredients / daily-boss-access | `syncCraftingIngredients.js` / `syncDailyBossCatalog.js` |
| `1_500_000_000 + hash` | daily-boss-drops | `syncDailyBossCatalog.js` |
| `1_600_000_000 + hash` | event-items | `syncEventCatalog.js` |
| `1_700_000_000 + hash` | minigame-items | `syncMinigamesCatalog.js` |
| `1_900_000_000 + hash` | battle-pass | `syncBattlePassCatalog.js` |
| pageid real (< 20000) | páginas reais da wiki | pipeline legado |
| ~1.0–1.5 bi (hash, sem padrão fixo) | `event-items` legado (12 registros originais) | pipeline antigo, anterior a esta sessão |

Se criar um sync novo, escolha uma faixa nova (`2_000_000_000 +`) para não colidir.

## Wiki crawler (`src/wiki-crawler/`, `data/wiki-crawl/`)

**A wiki (`wiki.otponline.com`) está atrás de Cloudflare e bloqueia qualquer acesso
automatizado — já tentamos e confirmamos que NENHUMA dessas abordagens funciona:**
Playwright/Puppeteer (headless ou visível, com stealth), `curl`, `node fetch`, e a
ferramenta `WebFetch` — todas retornam 403 ou travam na tela "Verifying you are
human". O bloqueio é por fingerprint de conexão (JA3/TLS) e detecção de CDP, não só
por falta de cookie — **não vale a pena tentar de novo com as mesmas técnicas.**

**A solução que funciona**: um bookmarklet/userscript (`userscripts/*.js`) que roda
*dentro do navegador real do usuário*, já autenticado, e chama a API do MediaWiki
via `fetch` no console da página. O backend expõe `/wiki-crawl/next`,
`/wiki-crawl/result`, `/wiki-crawl/status` (`src/wiki-crawler/routes.js` +
`state.js`) como uma fila que o bookmarklet consome. Já rodamos isso e coletamos
**1897 páginas** em `data/wiki-crawl/` (`index.json` + `pages/*.json` com
wikitext bruto). Não recriar esse crawler do zero — os dados já estão coletados.

**Imagens (`imageUrl`) tinham o mesmo bloqueio, resolvido com o mesmo truque do
bookmarklet.** Hotlink direto pra `wiki.otponline.com/images/...` dá 403 sempre
(confirmado por `curl`, mesmo com URL certa via hash MD5 — `mwImageUrl()` repetido
em vários scripts de sync), então em vez de o backend baixar a imagem, quem baixa é
o **navegador do usuário** (sessão real, sem bloqueio) via
`userscripts/wiki-image-downloader.bookmarklet.js`:
1. `GET /wiki-images/pending?limit=&exclude=` (`src/routes/wikiImages.js`) devolve
   itens cujo `imageUrl` ainda começa com `https://wiki.otponline.com`
2. o bookmarklet faz `fetch(item.imageUrl)` **de dentro da aba da wiki** (mesma
   origem, herda cookies/fingerprint reais) e manda os bytes em base64 pra
   `POST /wiki-images/upload`
3. o backend salva em `public/images/<wikiPageId>.<ext>` (estático, servido em
   `/images/...`), reescreve `CatalogItem.imageUrl` pra apontar pro backend local, e
   guarda a URL original em `extractedFields.wikiImageUrl` (não se perde a
   referência).

`public/images/` está no `.gitignore` (binário, não versionar). O bookmarklet tem
retry: só desiste depois de `MAX_EMPTY_ROUNDS` (5) lotes de 30 **consecutivos** sem
nenhum sucesso, com espera de 5s entre tentativas — a primeira versão desistia num
único lote ruim, o que era falso-positivo (Cloudflare tem hiccups transitórios). Se
mexer nesse bookmarklet nunca reduza essa tolerância a zero de novo.

O frontend (`Catalog.jsx`) esconde `<img>` quebrada via `onError` como rede de
segurança pros itens sem imagem ainda.

**Extensão (2026-07-14) — imagens aninhadas de addon (`looktypeImageUrl`/
`looktypeShinyImageUrl`)**: a migração original acima só olhava o `imageUrl`
**de topo** de `CatalogItem`. Um bug real no formulário de anúncio de Pokémon
(preview visual não mostrava o addon equipado) revelou que
`extractedFields.addonCompatibilities[i].looktypeImageUrl`/
`.looktypeShinyImageUrl` (categoria `addons`, um array porque um addon pode
valer pra várias espécies — ex: "Blue Cap Addon" tem 2 entradas) nunca
passaram por essa migração — são URLs cruas de `wiki.otponline.com` até
hoje. **Confirmado por query real (2026-07-14): 566 das 739 linhas de
`addons` têm pelo menos uma URL aninhada pendente, somando 1542 URLs
individuais pendentes** (uma mesma linha pode ter várias — `looktypeImageUrl`
e `looktypeShinyImageUrl` de cada compatibilidade, cada um podendo estar
pendente independentemente).

Estendido o pipeline existente em vez de criar um paralelo (`src/routes/wikiImages.js`):
- `GET /wiki-images/pending`: além do `imageUrl` de topo (comportamento e
  formato 100% preservados — `{ wikiPageId, imageUrl, name }`, sem chave
  nova), agora também varre as 739 linhas de `addons` em memória (mesmo
  padrão "categoria pequena, filtra em JS" de
  `src/routes/storePokemonOptions.js`) e devolve entradas extras com um
  descritor `nested: { compatibilityIndex, field }` apontando exatamente
  onde reescrever depois — `{ wikiPageId, imageUrl: <URL aninhada em si>,
  name, nested }`. `remaining` agora soma pendências de topo + aninhadas.
  O parâmetro `exclude` aceita tanto o token numérico de sempre (`wikiPageId`,
  afeta só a query de topo) quanto um token novo prefixado
  `nested:<wikiPageId>:<compatibilityIndex>:<field>` (afeta só aquela
  entrada aninhada específica) — necessário porque uma mesma linha de addon
  pode ter várias URLs aninhadas pendentes independentes; excluir só por
  `wikiPageId` esconderia as outras também.
- `POST /wiki-images/upload`: aceita um `nested` opcional no body, mesmo
  formato. Quando presente, salva o arquivo em
  `public/images/<wikiPageId>-looktype-<compatibilityIndex>-<normal|shiny><ext>`
  (nome distinto da imagem de topo do próprio item, pra não colidir) e
  reescreve só `extractedFields.addonCompatibilities[compatibilityIndex][field]`
  daquela linha (o resto de `extractedFields`, incluindo as outras entradas
  do array, fica intocado) — em vez do `imageUrl` de topo. Preserva a URL
  remota original em `addonCompatibilities[i].wikiLooktypeImageUrl`/
  `.wikiLooktypeShinyImageUrl` (mesmo padrão do `wikiImageUrl` de topo).
  Quando `nested` está ausente, o comportamento é idêntico ao de antes —
  mudança puramente aditiva.
- `userscripts/wiki-image-downloader.bookmarklet.js`: repassa `nested` (se o
  item pendente tiver) na chamada de `/upload`, e a chave usada em
  `failed`/`exclude` agora é `itemKey(item)` (o `wikiPageId` puro pra itens de
  topo, ou o token `nested:...` composto pra aninhados) em vez do `wikiPageId`
  puro sempre — necessário pelo mesmo motivo do parágrafo acima. Retry/
  `MAX_EMPTY_ROUNDS`/espera de 5s **não foram alterados**.

**Importante**: essa mudança é só backend + script — **o usuário ainda
precisa rodar o bookmarklet atualizado no navegador** pra efetivamente
baixar essas 1542 URLs aninhadas (mesmo passo manual da migração original,
documentado acima). Nada foi baixado por esta mudança em si. Verificado
nesta sessão: `GET /wiki-images/pending` devolvendo os dois formatos
corretamente lado a lado (`remaining` bateu exatamente com `9 (topo) + 1542
(aninhado) = 1551`); `exclude` com token `nested:...` filtrando só a entrada
certa (confirmado: excluir a `looktypeImageUrl` de uma linha manteve a
`looktypeShinyImageUrl` da mesma linha aparecendo, `remaining` caiu em
exatamente 1); `POST /upload` com `nested` testado contra uma linha real
(`Hollow Pinsir addon`, `wikiPageId` 2053017183) usando um buffer de imagem
dummy (não o real, bloqueado) — confirmado que só o campo
`addonCompatibilities[0].looktypeImageUrl` daquela linha mudou, resto de
`extractedFields` intocado, `imageUrl` de topo do item intocado — **revertido
em seguida** (o buffer de teste era um PNG 1x1 dummy, não a imagem real do
addon, então não é dado reaproveitável — a linha foi restaurada ao estado
exato de antes do teste e o arquivo dummy apagado de `public/images/`).

**Causa raiz encontrada (2026-07-14) — bookmarklet rodado pelo usuário migrou
só 9 de 1551 pendentes**: das 1551 URLs pendentes (9 de topo + 1542
aninhadas), só as 9 de topo migraram na primeira rodada real do bookmarklet
— as 1542 aninhadas falharam **todas**. Diagnóstico (com o usuário
confirmando manualmente que uma dessas URLs abre uma imagem real ao colar
direto na barra de endereço, descartando "URL/dado errado"): erro real no
console era `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` — os arquivos de
looktype de addon têm um header `Cross-Origin-Resource-Policy` que bloqueia
`fetch()`/XHR de ler os bytes via script, mesmo same-origin, mas **não**
bloqueia um elemento `<img>` normal nem navegação direta (por isso abria
certo colando a URL, e por isso as imagens já aparecem certas dentro da
própria wiki). As imagens de topo (já migradas há sessões anteriores) não
têm esse header — só as de looktype de addon, aparentemente.

Corrigido em `userscripts/wiki-image-downloader.bookmarklet.js`: quando o
`fetch()` direto falha, cai num fallback `loadImageViaCanvas()` — carrega a
URL num elemento `<img>` (permitido), desenha num `<canvas>` e reextrai via
`canvas.toDataURL('image/png')` (sempre same-origin aqui, canvas nunca fica
"tainted"). Força extensão `.png` no fallback (o re-encode do canvas
descarta o formato original). Também corrigido um bug relacionado
encontrado no processo: a chamada `POST /upload` do bookmarklet nunca
checava `res.ok` — uma falha do lado do servidor seria silenciosamente
contada como sucesso (`processed++`), o que mascarava progresso real;
agora lança erro e cai no mesmo tratamento de falha das demais. Adicionado
`console.error` com a URL e o erro real de cada falha, pra não ter que
adivinhar às cegas numa próxima vez.

**Correção de uma 1ª tentativa (mesmo dia) — canvas via `<img>` não foi
suficiente**: rodando o bookmarklet atualizado, o usuário confirmou "o mesmo
erro" continuava aparecendo no console. Reavaliado: `Cross-Origin-Resource-
Policy` **não** é específico de `fetch()`/XHR como documentado acima — ele
bloqueia qualquer *embed* de sub-recurso cross-origin, incluindo `<img>`
normal. A mensagem `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` é um log de
rede do próprio navegador, que aparece igual não importa qual API disparou o
pedido bloqueado — por isso trocar `fetch()` por `<img>`+canvas não mudou
nada. O que **de fato** escapa do CORP é só uma navegação de verdade
(barra de endereço, ou um `<iframe>` navegando pra aquela URL como seu
próprio documento — isso conta como "navigate", não como "embed"). Corrigido
de novo: novo fallback `loadImageViaIframe()` — cria um `<iframe>` oculto,
navega direto pra URL da imagem (o navegador renderiza um documento mínimo
com um `<img>` dentro, do jeito que já faz ao abrir uma imagem "pelada"),
lê esse `<img>` de dentro do próprio `contentWindow`/`contentDocument` do
iframe (mesma origem, nunca cross-origin de verdade) e desenha num canvas
criado também dentro do iframe antes de extrair `toDataURL`. Cadeia de
fallback agora é: `fetch()` → `<img>`+canvas → `<iframe>` navegado+canvas
(mantém o canvas simples como 1º fallback por ser barato, mesmo já sabendo
que sozinho não resolve esse caso específico — pode ajudar em outras classes
de bloqueio no futuro).

**Confirmado (mesmo dia) — fallback via iframe funciona, mas Cloudflare
passou a bloquear por volume**: rodando o bookmarklet com o fallback de
iframe, a hipótese "navigate escapa do CORP" se confirmou —
`looktypeImageUrl` do Hollow Pinsir (usado como caso de teste desde o
início) migrou com sucesso pra local. Numa rodada real chegou a baixar
**916 imagens** antes de travar (5 lotes seguidos falhando). Numa rodada
seguinte, porém, **0 de 150 tentativas** tiveram sucesso — usuário colou o
log real do console: a partir de um certo ponto, toda tentativa devolvia
`Failed to load resource: the server responded with a status of 403 ()`
pra **qualquer** URL, inclusive as que já tinham funcionado antes. Isso não
é mais o bloqueio de CORP (que não gera esse log de rede especificamente) —
é rate-limiting real da Cloudflare, disparado pelo volume: essa migração é
~1500+ imagens numa tacada só, bem maior que qualquer migração anterior
deste projeto (a original de ~3642 imagens foi claramente feita aos poucos,
não tudo de uma vez).

Corrigido (ritmo do bookmarklet, não mais a lógica de download): pausa
entre cada imagem subiu de 120ms → 400ms; pausa entre lotes sem sucesso
subiu de 5s → 15s (mesmo `MAX_EMPTY_ROUNDS = 5`, não alterado — CLAUDE.md
já pede pra nunca reduzir essa tolerância, e aumentar o tempo de espera por
rodada já triplica a paciência total antes de desistir, de 25s pra ~75s).
Se a Cloudframe continuar bloqueando mesmo assim, a próxima tentativa seria
esperar mais tempo entre execuções manuais do bookmarklet (minutos, não
segundos) em vez de mexer mais no código — o problema já não é mais de
lógica, é de volume/tempo.

**Estado em 2026-07-14 (fim da sessão)**: migração em andamento, não
concluída — `GET /wiki-images/pending` é a fonte da verdade pro que ainda
falta (nenhum número fixo documentado aqui de propósito, já que muda a
cada rodada do usuário).

**Concluído em 2026-07-16**: usuário rodou o bookmarklet mais algumas vezes
nos dias seguintes até esgotar a fila. `public/images/` foi de 3642
(baseline original) para **5195** arquivos. `GET /wiki-images/pending` →
`remaining: 0` — migração de imagem 100% concluída, tanto a de topo quanto
a cauda do backlog de looktype de addon aninhado (~1542 originais). Sem
nenhum sinal do bloqueio de rate-limit da Cloudflare documentado acima
nesta leva final. Não há mais nenhuma imagem pendente de download no
catálogo — se uma sync futura criar itens novos com `imageUrl` remoto, a
fila volta a ter itens (comportamento normal do endpoint), mas não há
backlog histórico restante.

**Bug de dado real corrigido em 2026-07-16 — pares normal/shiny de
`addonCompatibilities` desalinhados por um passo**: reportado pelo usuário
(via investigação do papel Interface testando o preview de addon do
formulário/modal de vitrine com dado real) — em várias linhas de `addons`,
o campo rotulado "normal" de uma entrada de `addonCompatibilities[i]` na
verdade contém a imagem **shiny** da mesma espécie, e o campo rotulado
"shiny" contém a imagem **normal da próxima espécie da lista**, formando uma
cadeia deslocada por uma posição. **Confirmado por `grep` exaustivo: não
existe (e nunca existiu neste repositório) nenhum script/parser vivo em
`src/wiki-crawler/` que escreva `addonCompatibilities`** — esse campo foi
populado por algo de uma sessão anterior não presente no código-fonte atual
(nem em `CLAUDE.md` há menção de qual script criou isso); a correção abaixo
foi uma migração de dado direta única (mesmo padrão de toda correção
anterior de `CatalogItem` nesta sessão/arquivo), não um "rodar sync de
novo".

**Causa raiz mais provável (inferida pelos dados, não confirmada por
código-fonte, já que o extrator original não existe mais)**: em `addons`
cuja imagem própria do item (`extractedFields.addonItemFileKey`, que
deveria seguir o padrão `Itens-addons-<nome>.png`) aparece usando o padrão
`Looktype-addons-<primeira-espécie>...png` (i.e., a imagem *normal* da
primeira espécie compatível foi desviada pra virar o ícone do próprio
addon), toda a lista de imagens normal/shiny por espécie parece ter sido
lida como uma sequência achatada e "zipada" em pares a partir da posição
errada, empurrando cada par (normal, shiny) uma posição adiante da espécie
correta — consistente em todas as linhas afetadas onde o problema começa
na espécie de índice 0. Em linhas onde o deslocamento começa **no meio** da
lista (não no índice 0), a causa provável é uma imagem shiny genuinamente
ausente/não capturada para aquela espécie específica no meio, causando o
mesmo desvio em cascata a partir dali.

**Detecção**: heurística ingênua inicial (`normalAlt` contém a palavra
"shiny" OU `shinyAlt` não menciona o nome da própria espécie) achou 43
linhas suspeitas, mas com falsos positivos confirmados (ex: "Champion 2020
Addon" — convenção de arquivo sem nome de espécie, correta; "Shiny
Infernape..." — a palavra "shiny" faz parte do nome da **espécie**
compatível em si, não indica variante shiny da imagem; "Rampardos - Shiny
Zard Costume addon.png" — a palavra "shiny" faz parte do nome do **addon**,
aparecendo depois do nome da espécie, não antes; convenção de abreviação
`Sh<Espécie>`/`S<Espécie>` sem espaço, ex: "ShArcheops"/"Sampharos" —
shiny real, só grafado sem a palavra por extenso; "Alolan Raticate" com
"Shiny" separado por um qualificador de forma regional no meio). Refinada
pra uma detecção por tokens: localiza a espécie como sequência de tokens
exata dentro do texto do arquivo (tolera qualificadores no meio, tipo
"Shiny Alolan Raticate") e só considera "shiny" um marcador real quando o
token "shiny" (ou abreviação `s`/`sh` grudada sem espaço, só quando o
prefixo é exatamente isso, não qualquer prefixo de 1-2 caracteres —
descartou um falso positivo tipo "H.L abomasnow.png") aparece **antes** da
ocorrência da espécie — nunca depois (evita o caso "Rampardos - Shiny Zard
Costume"). Cadeia de deslocamento detectada comparando o nome de arquivo de
cada campo contra o nome de **todas as outras espécies da mesma linha**
(não uma lista global de Pokémon) — sinal direto e determinístico do
"aponta pra próxima espécie da lista", sem heurística especulativa.
**Resultado final, contra as 567 linhas de `addons` com
`addonCompatibilities` preenchido: 25 linhas genuinamente afetadas** (bem
abaixo das 43 da heurística ingênua — a maioria da diferença eram os falsos
positivos confirmados acima).

**Correção aplicada em 23 das 25 linhas** (reconstrução do pareamento
correto usando o texto/URL já presente nas próprias entradas como fonte da
verdade, nunca inventando dado novo): pra cada entrada da cadeia, a imagem
"shiny" verdadeira já estava sentada no campo "normal" da mesma entrada
(só precisa trocar de campo); a imagem "normal" verdadeira de cada espécie
(exceto a primeira de cada cadeia) já estava sentada no campo "shiny" da
entrada **anterior** (só precisa mover de entrada). Os dados órfãos que
sobram no meio do caminho (ex: um campo "shiny" que aponta pra uma espécie
nem sequer presente na lista de compatibilidade daquela linha — contaminação
cruzada de outra tabela da mesma página wiki, achado em algumas linhas) são
descartados, nunca escritos em lugar nenhum. Nenhuma chamada de rede/download
foi feita — a correção só move os campos `looktypeImageUrl`/
`looktypeImageAlt`/`wikiLooktypeImageUrl`/`looktypeShinyImageUrl`/
`looktypeShinyImageAlt`/`wikiLooktypeShinyImageUrl` (todos strings, seja URL
local já baixada ou remota ainda pendente) entre entradas/campos —
**nenhum arquivo em `public/images/` foi tocado, renomeado ou baixado**; um
arquivo físico já baixado continua no mesmo caminho, só a referência a ele
dentro de `extractedFields` mudou de posição (o nome do arquivo local
codifica `<wikiPageId>-looktype-<índice>-<normal|shiny>`, mas isso nunca é
reprocessado por nenhum código — é só um identificador único de arquivo,
não semântica lida de volta).

**8 dessas 23 linhas ficaram com o campo "normal" da primeira espécie da
cadeia irrecuperável** (`looktypeImageUrl`/`looktypeImageAlt` setados pra
`null`, `wikiLooktypeImageUrl` removido quando presente — mesma convenção já
usada no resto do catálogo pra "não temos essa imagem", que o frontend já
trata graciosamente caindo pro sprite normal do Pokémon): a imagem normal
verdadeira dessa espécie não sobrevive em nenhum lugar dentro de
`addonCompatibilities` — o rastro aponta pra ela ter sido desviada pra
`extractedFields.addonItemFileKey`/`imageUrl` do **item** (confirmado: nas
8 linhas, `addonItemFileKey` bate exatamente com o nome de arquivo que
seria a imagem normal daquela primeira espécie, e usa o padrão
`Looktype-addons-` em vez do padrão esperado `Itens-addons-` de todo outro
addon). **Deliberadamente não tocado** — mexer em `imageUrl`/
`addonItemFileKey` de topo é uma decisão de escopo maior (identidade visual
do próprio `CatalogItem`, usada em outros lugares do app) e não foi
autorizada nesta tarefa; documentado aqui como gap conhecido, não
"resolvido por adivinhação". As 8 linhas: Desert Flower Addon (2056734667,
Lunatone), Queens Crown Addon (2047001653, Metagross), Porygon Hat Addon
(2009329881, Jynx), Flower Branch Hat Addon (2017415777, Infernape), Kings
Crown Addon (2012914387, Metagross), Porygon Hat Addon (2013983779,
Umbreon — linha de entrada única, cadeia de tamanho 1), Porygon Cap Addon
(2103636814, Krookodile), Horned Christmas Hat Addon (2139529348, Steelix).

**2 linhas identificadas pela heurística mas deliberadamente NÃO
corrigidas** (dado ambíguo demais pra reconstruir com segurança — "nunca
adivinhar"):
- **Flower hat addon** (2072426025): as 3 entradas (todas `pokemonWikiTitle:
  "Florges"`) usam os campos normal/shiny pra guardar **cores de forma
  diferentes** (Red/Orange/White vs Blue/Yellow/null) — Florges tem várias
  formas de cor no jogo, e a wiki parece ter reaproveitado a convenção de
  colunas normal/shiny da tabela pra listar 2 cores por linha, não uma
  variante shiny de verdade. Não há um "certo" pra reconstruir aqui — os
  dois campos provavelmente já contêm exatamente as imagens certas, só
  rotuladas com um nome de campo (normal/shiny) que não reflete o conceito
  real (cor de forma). Deixado como está.
- **Tangrowth Santa Claus addon** (2050754463): entrada única, nenhum dos
  dois nomes de arquivo (`"Tangrowth Tangrowth Santa Claus.png"` /
  `"Tangrowth Santa Claus.png"`) tem qualquer marcador de shininess
  (nem "shiny" nem abreviação `s`/`sh`) — impossível confirmar se há de
  fato uma variante shiny distinta ou se é a mesma arte duplicada por
  outro motivo. Deixado como está.

**3 linhas com um bug DIFERENTE, adjacente, encontrado no caminho mas fora
do escopo desta correção (não tocadas)**: `looktypeImageUrl` e
`looktypeShinyImageUrl` apontam pro **mesmo arquivo original da wiki**
(`wikiLooktypeImageUrl === wikiLooktypeShinyImageUrl` idêntico) — não é um
deslocamento de posição, é a mesma imagem única duplicada nos dois campos,
sugerindo que só existe uma arte pra esse addon+espécie e o extrator
original preencheu os dois campos com ela em vez de deixar o shiny `null`.
Linhas: **Link Cosplay addon** (2143222106, Ampharos), **Blackbeard
Cosplay addon** (2040458475, Whiscash), **Easter Bunny Addon** (2106623665,
Plusle — esta também tem um problema à parte, não relacionado: o nome do
arquivo capturado é literalmente `"Shiny Minun 4264.png"`, mencionando
"Minun", não "Plusle" — possível espécie errada associada, não investigado
mais a fundo). Não corrigidas — decidir se o campo shiny deveria virar
`null` (ou se há uma imagem shiny real perdida em algum lugar) é uma
decisão de dado diferente da correção de deslocamento pedida aqui, precisa
de autorização própria.

**Segurança da migração**: backup completo das 23 linhas (todos os campos,
pré-mudança) em
`/tmp/.../scratchpad/pre-addon-looktype-shift-fix-backup.json` (efêmero,
sessão específica — não depender disso em sessões futuras). Cada
`update` verificou, imediatamente antes de escrever, que
`extractedFields.addonCompatibilities` ainda batia byte-a-byte com o que
foi lido no backup (proteção contra dado ficar stale entre leitura e
escrita — nenhuma stale detectada, todas as 23 escritas prosseguiram).
Nenhum outro campo de `CatalogItem` tocado (`name`/`wikiTitle`/`category`/
`slug`/`imageUrl` intocados nas 23 linhas — só
`extractedFields.addonCompatibilities` mudou). Catálogo total antes/depois:
**3537** (inalterado — nenhuma linha criada/apagada); `addons`: **740**
(inalterado). Verificado: re-rodar a mesma detecção contra o estado
pós-escrita encontra só as 2 linhas deliberadamente não corrigidas (Flower
hat addon, Tangrowth Santa Claus addon) — as 23 corrigidas não aparecem
mais como afetadas, e nenhuma linha nova passou a aparecer como afetada
(sem regressão introduzida pela correção).

### Parsers reutilizáveis (`src/wiki-crawler/parsers/`)

- `dailyBoss.js` — exporta `resolveLink`, `parseDrops`/`parseDropsWithImages`
  (formato `[[Arquivo:file]] '''Nome'''`), `parseSmallBoldDrops`/
  `parseSmallBoldDropsWithImages` (formato de tabela com linha de nomes em negrito
  seguida de linha de imagens, pareados por posição). Usado por quase todos os
  outros parsers — é a base compartilhada.
- `dungeons.js` — `parseRewardProse` (recompensa em texto corrido separado por
  vírgula/"e"/"ou", sem imagem disponível) e `buildDungeonsIndexMap` (página-índice
  "Dungeons").
- `battlePass.js`, `craftingList.js`, `quests.js`, `pokemonIndex.js`,
  `shopTable.js` — parsers específicos de cada sistema, cada um com seu próprio
  formato de tabela wiki (documentados inline).
- `categoryClassifier.js` — exporta `classifyItemCategory(name)`. Usado pelo
  branch de **criação** (item novo, não achado por `findFirst`) de todo script
  `sync*.js` que antes fixava uma das 11 categorias de origem aposentadas
  (ver "Estado atual do catálogo" abaixo) como `category`. Aplica as mesmas
  regras de nome usadas na limpeza pontual de 2026-07-13 (`carpet`→`carpets`,
  `doll`→`doll`, prefixo `TM` →`tms`, etc., caindo em `materials` se nada
  bater). **Não** cobre `pokeballs`/`held-items`/`evolution-items`/
  `mega-stones`/`pokemon` — sem padrão de nome confiável, scripts que já
  criam esses tipos continuam com a lógica própria, intocados.
  **Sinal de fallback (2026-07-13)**: retorna `{ category, matchedRule }` em
  vez de uma string nua — `matchedRule: false` quando o resultado foi o
  fallback cego pra `materials` (nome vazio ou nenhuma regra de `RULES`/prefixo
  `TM` bateu), `true` quando bateu uma regra de verdade. Motivo: auditoria
  encontrou 100 dos 169 itens de `materials` que não batem em nenhum padrão de
  palavra do classificador — alguns confirmadamente errados na inspeção manual
  (uma luminária, uma pintura, uma pelúcia, um móvel, uma ferramenta, uma
  poção), mas sem forma de distinguir isso de um material genuíno sem reler
  código/wiki item a item. Todo caller (`syncDailyBossCatalog.js`,
  `syncDungeonCatalog.js`, `syncNpcShopCatalog.js`, `syncEventCatalog.js`,
  `syncMinigamesCatalog.js`, `syncCraftSystemCatalog.js`,
  `syncCraftingIngredients.js`, `syncQuestCatalog.js`, e
  `syncBattlePassCatalog.js` no seu branch de item genuinamente novo) agora
  desestrutura `{ category, matchedRule }` e, quando `matchedRule` é `false`,
  grava `extractedFields.classifierFallback = true` na criação. Não é uma
  subcategoria — `syncSubcategories.js`'s `SUBCATEGORY_KEYS` não inclui essa
  chave de propósito, pra não aparecer como subcategoria de origem. Só um
  sinal pra auditoria futura poder filtrar
  `extractedFields.classifierFallback = true` e reclassificar em lote os itens
  que caíram em `materials` por falta de regra, em vez de terem sido
  confirmados como material de verdade. Como é só tagueado no momento da
  criação, os 169 itens de `materials` já existentes no banco (criados antes
  desta mudança) **não têm** essa tag retroativamente — só itens criados por
  syncs futuras a partir de 2026-07-13.

### Scripts de sync (rodar com `npm run <nome>`, todos idempotentes)

`pokemon:sync`, `pokemon:sync-shiny`, `battlepass:sync`, `events:sync`,
`dailyboss:sync`, `dungeons:sync`, `quests:sync`, `craftsystem:sync`,
`minigames:sync`, `npcshops:sync`, `crafting:sync`, `subcategories:sync`.

Ordem recomendada se rodar tudo do zero: pokemon → shiny → battlepass → events →
dailyboss → dungeons → quests → craftsystem → minigames → npcshops → crafting →
**subcategories por último** (ele varre `extractedFields` de tudo que já existe).

## Estado atual do catálogo (2026-07-13)

- **3571 itens**, 41 categorias principais (número de categorias não mudou
  nesta rodada — só realocação interna, ver item abaixo)
- **Auditoria de domínio (2026-07-13) — Fase 1 concluída**: `misc` (124 itens)
  nunca tinha sido auditado nas rodadas de reorganização anteriores (elas só
  tocaram as 11 categorias de origem já removidas). Auditoria encontrou o
  mesmo padrão de mistura categoria/origem escondido lá dentro. Fase 1
  (só confiança alta, sem inferência nova, critério = palavra "Decoration"/
  "Decorative" no nome ou já ter `craftIngredient`/`craftSystemSource` na
  subcategoria) moveu **8 itens**: 6 pra `collectibles` (Cofagrigus Decoration,
  Decoration Hand, Spinarak Decoration, Mother decoration neon, Ghost
  Decorative Gem, Decorative Costume Tauros Skull) e 2 pra `materials`
  (Rainbow Opal, Prismatic Material) — `misc` foi de 124 para 116.
  Validado: total geral continua 3571, nenhuma `extractedFields.subcategories`
  perdida, nenhum outro campo alterado.
  **Pendente (Fase 2, não decidido ainda)**: itens ambíguos que exigem ver a
  wiki/imagem antes de mover — "Baby Shiny Charizard", "Sleepy Umbreon",
  "Party Raticate", "Lonely Karp", "Puff Snorlax", "Teddy Beartic" (nome de
  Pokémon + qualificador, sem palavra que confirme se é a criatura ou uma
  decoração/pelúcia temática), um grupo de ~7 itens de doces/confeitaria
  (cotton candy, lollipop, sundae — candidato a categoria nova `sweets` se
  crescer), e ~4 itens de "Sacred/Volcanic X Crystal". Também identificado
  mas não resolvido: `daily-boss-access` (24 itens) não representa item
  físico algum (são janelas de acesso sazonal, ex: "Halloween 2024") — decisão
  de modelagem maior, não uma simples reclassificação, não mexida sem
  perguntar.
- **Resolvido em 2026-07-13 (reorganização das categorias de origem)**: as 11
  categorias que existiam pra representar "de onde o item veio" em vez de "o
  que ele é" (`loot`, `daily-boss-drops`, `dungeon-drops`, `event-items`,
  `quest-rewards`, `battle-pass`, `npc-shop-items`, `minigame-items`,
  `craft-system`, `craft-ingredients` — violação da regra 1 de
  `ARCHITECTURE_RULES.md`) foram reorganizadas em 3 passes sobre 331 itens:
  1. **28 duplicatas reais** (mesmo item já existia em `pokemon`/`pokemon-shiny`/
     `mega-stones`/`cherish-ball-pokemon` com nome idêntico ou quase-idêntico —
     ex: "Shiny Charizard" em `dungeon-drops` **e** em `pokemon-shiny`,
     "Gachompite" [erro de digitação] duplicando "Garchompite" em
     `mega-stones`, "Snover na Cherish Ball" duplicando "Snover"). Mescladas
     (mantida a linha de tipo correta, subcategoria da origem adicionada,
     linha do bucket apagada) — mesmo padrão das duas rodadas de dedup
     anteriores. **Causa de terem escapado da varredura anterior**: aquela
     varredura excluía Pokémon/mega-stones do pool de comparação inteiro (não
     só do lado sobrevivente), então nunca comparava um item de
     `dungeon-drops` contra um `pokemon-shiny` de mesmo nome.
  2. **136 itens reclassificados** pra categoria de tipo já existente via
     padrão de nome (ex: "Pink heart carpet" → `carpets`, "Legendary Reaper
     Backpack" → `backpacks`, "TM - Pollen Puff" → `tms`, "Legendary Blastoise
     Cursed Statue" → `collectibles`) + 7 casos especiais sem padrão de nome
     óbvio ("Shiny Aggron"/"Shiny Pidgeot"/"Shiny Pachirisu" → `pokemon-shiny`,
     "Baby Charizard"/"Baby Shiny Lapras"/"Baby Lapras"/"Baby Magikarp" →
     `pokemon` — nenhum tinha duplicata existente, só precisavam da categoria
     certa).
  3. **167 itens sem categoria de tipo existente** (sementes, berries, moedas,
     penas, pelo, ossos, parafusos, poções — materiais de crafting e loot
     genérico) foram pra uma **categoria nova: `materials`**.
  `daily-boss-access` (24 itens) foi **deixado de fora de propósito** — não
  são itens físicos, são registros de janela de acesso/evento sazonal (ex:
  "Halloween 2024", "Dia das Mães 2023"), não se encaixam no modelo
  categoria=tipo-de-objeto. Decisão pendente se isso deveria nem ser
  `CatalogItem` — não mudado sem perguntar.
  Backup das 335 linhas envolvidas em
  `/tmp/.../scratchpad/pre-reclass-backup.json` (efêmero, sessão específica).
  **Seguido em 2026-07-13 (aplicado nos scripts de sync, não só uma limpeza
  pontual)**: essa reclassificação só tinha corrigido as linhas já existentes
  no banco — os próprios scripts `sync*.js` continuavam fixando a categoria
  de origem aposentada (`category: 'quest-rewards'`, `'daily-boss-drops'`,
  `'dungeon-drops'`, `'event-items'`, `'battle-pass'`, `'npc-shop-items'`,
  `'craft-system'`, `'craft-ingredients'`, `'minigame-items'`) no branch de
  **criação** de item novo (quando `findFirst` não acha nada) — então o
  próximo item genuinamente novo descoberto por qualquer uma dessas syncs
  reintroduziria a violação da regra 1. Corrigido extraindo as regras de nome
  da limpeza pontual pra um módulo compartilhado,
  `src/wiki-crawler/parsers/categoryClassifier.js`
  (`classifyItemCategory(name)`), importado no branch de criação de
  `syncQuestCatalog.js`, `syncDungeonCatalog.js`, `syncEventCatalog.js`,
  `syncNpcShopCatalog.js`, `syncCraftSystemCatalog.js`,
  `syncCraftingIngredients.js`, `syncMinigamesCatalog.js` e
  `syncDailyBossCatalog.js` (só o namespace `drop`, não `access` —
  `daily-boss-access` continua de fora de propósito, mesma decisão pendente
  de sempre). `syncBattlePassCatalog.js` é um caso à parte: como ele usa
  `findUnique` por `wikiPageId` próprio (não faz `findFirst` cross-category),
  o "achou" ali significa "este item já foi criado por esta mesma sync antes"
  — nesse caso a categoria existente é preservada (`existing.category`), só
  item genuinamente novo passa pelo classificador; isso também tem o efeito
  colateral positivo de não sobrescrever de volta pra `battle-pass` uma linha
  que a limpeza pontual reclassificou à mão. O branch de "achou item
  existente" **não** tinha sido alterado nesta rodada (2026-07-13) — só a
  atribuição de `category` no branch de criação — e continuava, nos 8
  scripts, checando **só** `wikiTitle` via `findFirst`, apesar deste mesmo
  arquivo e `ARCHITECTURE_RULES.md` regra 2 já descreverem "por `wikiTitle` e
  `name`" como se já fosse esse o comportamento real. Corrigido de fato numa
  auditoria seguinte no mesmo dia — ver entrada "golden-rule fix" logo abaixo.
  `daily-boss-access` não foi tocado, como pedido.
- **Resolvido em 2026-07-13 (golden-rule fix — `findFirst` checava só
  `wikiTitle`, nunca `name`)**: auditoria de arquitetura confirmou via `grep`
  que os 8 scripts que usam `classifyItemCategory` (todos os listados acima,
  exceto `syncBattlePassCatalog.js`, que usa `findUnique` por `wikiPageId`
  próprio — decisão à parte, não tocada) faziam
  `findFirst({ where: { wikiTitle: { equals: name, mode: 'insensitive' } } })`
  — **nunca** olhavam `name`, apesar deste arquivo e `ARCHITECTURE_RULES.md`
  regra 2 sempre terem descrito "checar `wikiTitle` **e** `name`" como se já
  fosse assim. Essa lacuna é a causa raiz confirmada de várias duplicatas já
  encontradas nesta sessão (mega-stones com `wikiTitle: "Mega_Evolução"`,
  Shiny Pokémon duplicados em `dungeon-drops`/`quest-rewards`/
  `minigame-items`, "Snover"/"Bunnelby na Cherish Ball"): sempre que o
  wikitext de origem de um item novo grafava o nome de forma diferente do
  `wikiTitle` já salvo (capitalização, "X na Cherish Ball" vs "X", nome de
  página vs nome do item), o `findFirst` não encontrava a linha existente e
  criava uma duplicata. Corrigido nos 8 arquivos — `findFirst` agora usa
  `OR: [{ wikiTitle: {...} }, { name: {...} }]`, ambos case-insensitive:
  `syncDailyBossCatalog.js`, `syncDungeonCatalog.js`, `syncNpcShopCatalog.js`,
  `syncEventCatalog.js`, `syncMinigamesCatalog.js`,
  `syncCraftSystemCatalog.js`, `syncCraftingIngredients.js` (dois `findFirst`
  no arquivo, ambos corrigidos), `syncQuestCatalog.js`.
  `syncBattlePassCatalog.js` deliberadamente **não** tocado (mesma decisão de
  design de sempre). `syncPokemonCatalog.js`/`syncShinyPokemonCatalog.js`
  também não tocados — checado, usam `findUnique` por `wikiPageId` (real ou
  sintético), não o padrão vulnerável. Nenhuma migração de dado feita (é fix
  de lógica no caminho de criação, não mexe em linha já existente) — o efeito
  vale a partir da próxima vez que qualquer uma dessas syncs rodar.
- **Decisão de arquitetura 2026-07-13 (segurança de falha parcial nos loops de
  sync — avaliada, não implementada)**: nenhum dos 8 scripts do golden-rule
  fix acima envolve seu loop de create/update em `$transaction`. Avaliado
  deliberadamente e decidido **não fazer isso**: cada iteração do loop faz
  exatamente **uma** chamada Prisma dependente por item (um `create` OU um
  `update` — o `findFirst` anterior é leitura, não uma segunda escrita), então
  já não existe uma operação "meio feita" possível por item. Atomicidade por
  item + idempotência (a correção do golden-rule acima garante que reprocessar
  depois de um crash faz `findFirst` achar o item já criado e atualizar em vez
  de duplicar) já é a mitigação certa pra um job em lote como esses. Envolver
  o loop inteiro (potencialmente centenas de itens, centenas de round-trips de
  rede pro Neon) numa única transação criaria riscos novos e piores: locks
  longos, timeout de conexão do Neon (que já hiberna — ver seção "Rodando
  localmente"), e um item ruim no meio do lote desfazendo todo o trabalho já
  commitado antes dele na mesma run. A única exceção conceitual seria uma
  operação que precisasse de fato de mais de uma escrita dependente pra uma
  mesma mudança lógica — auditado e não existe nenhuma hoje:
  `syncCraftingIngredients.js` tem dois loops (ingredientes, depois receitas)
  mas cada iteração de cada loop ainda é uma escrita só, em linhas
  tipicamente diferentes. Se uma sync futura precisar mesmo de duas escritas
  atômicas pra uma única mudança lógica, envolver **só aquele trecho** — não
  reabrir esta decisão sem esse cenário concreto.
- 819 itens com `subcategories` preenchida. **Importante**: esse número só fica
  correto se `subcategories:sync` for a **última** coisa rodada — ele lê o
  `extractedFields` de tudo que já existe, então qualquer sync rodado depois dele
  (ex: backfill de imagem, limpeza de categoria) deixa o campo `subcategories`
  desatualizado até rodar de novo. Sempre rodar `npm run subcategories:sync` por
  último depois de qualquer outra sincronização.
- **Migração de imagem para local (2026-07-12)**: `public/images/` tem
  **3642 arquivos**. 13 itens ficaram presos em `GET /wiki-images/pending`
  (bookmarklet desistiu após 5 lotes sem sucesso) — **causa raiz encontrada e
  corrigida**, duas categorias de bug em `mwImageUrl()` (a função que replica
  o esquema de hash MD5 de path de imagem do MediaWiki, duplicada em 8 dos
  scripts `sync*.js`):
  1. **Capitalização do MediaWiki** (9 itens: Mom Heart carpet, Magical flower
     vase, Perfect Milk bottle, Pink border tapestry, Soft Decoration kit,
     Hangable Sea Buoy, Backpack/Alolan Vulpix, Swampert doll, Kommo-o doll).
     O MediaWiki sempre capitaliza a primeira letra do título de um arquivo
     (`wgCapitalLinks`), mas o wikitext de origem referenciava o arquivo com
     primeira letra minúscula (ex: `[[Arquivo:mom heart carpet.png]]` na
     página `Daily_Boss`) e `mwImageUrl()` hasheava a string exatamente como
     capturada, gerando um path/hash que não bate com o arquivo real na wiki.
     Corrigido: `mwImageUrl()` agora capitaliza a primeira letra do filename
     antes de montar a URL, em `syncBattlePassCatalog.js`,
     `syncCraftingIngredients.js`, `syncDailyBossCatalog.js`,
     `syncDungeonCatalog.js`, `syncEventCatalog.js`, `syncMinigamesCatalog.js`,
     `syncNpcShopCatalog.js`, `syncPokemonCatalog.js`. Se criar um sync novo
     que baixe imagem, replicar essa capitalização.
  2. **Prefixo de thumbnail capturado como parte do filename** (4 itens: Fire
     Gem, Grass Gem, Psychic Gem, Water Gem, categoria `held-items`). Vieram
     de um pipeline legado (não há script `sync` atual pra "held-items" —
     origem pré-existente à sessão) cujo parser leu
     `[[Arquivo:Psychic Gem Sprite.png|35px|link=Held Item]]` (página
     `Held_Item`) e guardou `35px-Psychic_Gem_Sprite.png` como se fosse o
     nome do arquivo original — mas isso é o nome do *thumbnail*
     (`NNpx-Nome.ext`), que vive num path diferente
     (`images/thumb/.../Nome.ext/NNpx-Nome.ext`), não em `images/h1/h2/...`
     como o resto do catálogo. Corrigido diretamente nas 4 linhas do banco
     (sem script de sync pra rodar de novo): removido o prefixo `NNpx-`,
     recalculado o hash sobre o nome original.
  As 13 URLs corrigidas já estão de volta em `GET /wiki-images/pending`
  (voltaram a começar com `https://wiki.otponline.com`) — falta só rodar o
  bookmarklet de novo pra baixar essas 13. Pra reconferir o estado:
  `ls public/images | wc -l` e
  `curl -s "http://localhost:3000/wiki-images/pending?limit=20"`.
- **Resolvido em 2026-07-12 (normalização de duplicatas)**: 121 linhas de
  `CatalogItem` duplicadas foram fundidas e removidas (3733 → 3612), em 2 passes.
  Causa raiz: várias syncs criavam um item já existente em categoria específica
  (`held-items`, `pokeballs`, `doll`, `carpets`, `sticker-balls`, `backpacks`,
  `pokemon`, `cherish-ball-pokemon` etc.) de novo sob uma categoria genérica de
  recompensa (`battle-pass`, `loot`, `misc`) em vez de linkar via `findFirst`
  (violação da regra de ouro, provavelmente por rodar fora de ordem ou por bug
  pontual em algum sync). Critério usado pra identificar duplicata **real** (e não
  um item diferente que só compartilha nome — ex: "Battle Pass Box" tinha 8 linhas,
  só 3 eram duplicata de verdade, as outras 5 são caixas de temporadas diferentes
  com imagem própria): comparar `wikiTitle` normalizado **e** o nome do arquivo de
  imagem original (`extractedFields.wikiImageUrl`/`imageUrl`) — só mesclou quando
  batia os dois. Regra de sobrevivência: mantém a linha da categoria mais
  específica, apaga a genérica, funde `extractedFields` (união de arrays como
  `subcategories`/`battlePassSources`/etc., mantendo o resto da sobrevivente).
  Nenhuma referência de `Listing`/`StoreItem`/`StorePokemon*` foi perdida (checado
  e reatribuído por linha antes de apagar). Backup das 241 linhas envolvidas em
  `/tmp/.../scratchpad/pre-merge-backup{,-2}.json` (efêmero, sessão específica —
  não depender disso em sessões futuras).
  **Pendente, não resolvido**: ~56 grupos de nome duplicado restantes, quase todos
  addons cosméticos com imagens diferentes entre si (ex: `Itens-addons-X.png` vs
  `X.png`/`X2.png` — pode ser upload duplicado do mesmo addon OU variantes
  legitimamente diferentes tipo "Time Traveler addon" que já sabemos ser 4 itens
  reais distintos por Pokémon). Não teve confiança suficiente pra automatizar sem
  pesquisar o wikitext de cada um ou perguntar ao usuário — pra revisitar, gerar
  de novo os grupos de `wikiTitle` duplicado excluindo pokemon/shiny/cherish-ball
  puros (mesma lógica usada nesta sessão).
- **Resolvido em 2026-07-12 (bug de nome em `mega-stones`)**: 17 dos 19 itens de
  `mega-stones` tinham `wikiTitle` = "Mega_Evolução" (nome da página wiki de
  origem, vazou pro campo errado) em vez do nome real da stone (ex:
  "Charizardite Y") — só o campo `name` estava certo. Isso escondia duplicatas da
  varredura de dedup acima, que agrupa por `wikiTitle`: 13 dessas mega stones
  tinham uma segunda linha idêntica (mesma imagem original) em
  `daily-boss-drops`, sem aparecer como duplicata porque os `wikiTitle` não
  batiam ("Aerodactylite" vs "Mega_Evolução"). Corrigido: refeita a varredura
  agrupando por `name` em vez de `wikiTitle`, mesclado as 13 (sobrevive a linha
  `mega-stones` — é a categoria correta, "o que o item é"; `daily-boss-drops` vira
  só a subcategoria `dailyBossSources` mesclada) e corrigido `wikiTitle = name`
  em todas as 17 linhas (as 13 sobreviventes + as 4 sem duplicata:
  Charizardite X, Swampertite, Garchompite, Lopunnite), pra sync futura não
  duplicar de novo. **Lição pra próxima limpeza de duplicata**: `wikiTitle` não é
  100% confiável como chave de agrupamento — sempre rodar a varredura por `name`
  também (foi só por causa desse bug pontual do `mega-stones`; não achado em
  nenhuma outra categoria ao checar `wikiTitle`s repetidos >3x no catálogo
  inteiro).
- **Resolvido em 2026-07-12**: `quest-rewards` tinha ruído de duas fontes — um bug
  real no parser (`quests.js` pegava a coluna "Level" como recompensa quando o
  valor não era numérico, ex: "Desconhecido"; e prefixos de quantidade tipo "1 " /
  "100 " não eram removidos, criando itens duplicados como "1 Fire Stone" em vez
  de linkar no "Fire Stone" já existente) e texto genuíno da wiki que não é um
  item concreto (habilidade/unlock, "dois addons" sem nome, "Mega Stone
  aleatória", Pokémon não especificado). Corrigido em
  `src/wiki-crawler/parsers/itemFilter.js` (`stripLeadingQuantity` +
  `isLikelyRewardItem`, usado por `dungeons.js`'s `parseRewardProse` — compartilhado
  com `quests.js`) + detecção de célula por índice da imagem em vez de heurística
  de texto (`quests.js`). Se essa classe de bug reaparecer em outro parser de
  prosa, reusar `itemFilter.js` em vez de duplicar a lógica.
- **Resolvido em 2026-07-13**: 367 dos 612 sprites de `pokemon-shiny` (baixados
  em `public/images/`) tinham a arte do Pokémon espremida no canto inferior
  direito de um canvas praticamente vazio (ex: desenho de 21x17px dentro de uma
  imagem 64x64 — bug do asset original na wiki, não da nossa pipeline de
  download). Corrigido com `scripts/normalizeShinySprites.js`
  (`npm run sprites:normalize-shiny`, usa `sharp`, dependência nova): detecta
  assimetria de margem via bounding box do canal alpha (assimetria X e Y > 12%
  da dimensão = sprite fora de centro), faz **crop exato até o bounding box do
  conteúdo** (zero folga — nunca corta pixel do desenho) e então adiciona
  **padding transparente real** (`sharp().extend()`) igual nos 4 lados. Isso
  preserva 100% da resolução original (crop é lossless, diferente de upscale) e
  funciona junto com `object-fit: contain` do `.thumb` no frontend
  (`frontend/src/App.css`), que escala a arte já bem enquadrada pra caber no
  card. **Correção de uma 1ª tentativa (mesmo dia)**: a versão inicial só dava
  crop com folga (`bbox ± pad`, sem `extend`) — quando o desenho original já
  tocava a borda do canvas (ex: pé do Pokémon em y=63 de uma imagem 64px), não
  havia pixel transparente sobrando pra "puxar" como margem daquele lado, e o pé
  ficava colado na nova borda, parecendo cortado. Corrigido trocando a folga do
  crop por padding de verdade via `extend`, que sempre adiciona margem igual
  nos 4 lados independente de quão perto da borda original o desenho estava.
  Backup dos 367 originais (antes de qualquer crop) em
  `public/images-backup-shiny-recenter/` (gitignored, local). Script é
  idempotente e só mexe em sprites fora de centro — pode rodar de novo com
  segurança depois de qualquer novo download de sprite shiny.
- **Resolvido em 2026-07-14 (nome de `addons` igual ao nome de um Pokémon
  real)**: **62 dos 739** itens de `addons` tinham `name` igual ao nome puro
  de uma espécie de Pokémon (ex: "Annihilape", "Metagross", "Umbreon",
  "Jynx", "Ursaluna") sem nenhum descritor do addon em si — o que os deixava
  indistinguíveis de um Pokémon de verdade em qualquer lugar que liste por
  nome (bug relatado pelo usuário: apareciam confundindo o seletor de item do
  formulário "Adicionar Item" do Anúncio de Item, mesmo com `category:
  'addons'` correta — o problema era só o `name`, não a categoria). Caso mais
  grave confirmado: "Ursaluna" e "Bloodmoon Ursaluna" tinham **2 linhas cada**
  com o mesmo nome vazio-de-descritor representando addons genuinamente
  diferentes ("Eldritch Addon" vs "Oni Addon", só distinguíveis pelo nome do
  arquivo de imagem original).
  Corrigido recuperando o nome real a partir do próprio arquivo de imagem
  original da linha — nunca inventado: prioridade
  `extractedFields.addonItemFileKey` (presente nas linhas de origem
  `addon_category_page`/box, nunca reescrito pela migração de imagem — ver
  `src/routes/wikiImages.js`) → `extractedFields.eventRewardItemFileKey`
  (linhas de origem `event-items`) → filename extraído de
  `extractedFields.wikiImageUrl`/`wikiLooktypeImageUrl` como último recurso
  (esses dois só ficam com a URL remota original quando a imagem ainda não
  foi migrada — depois de migrada, `wikiImageUrl` vira o stash da URL
  original, então continua utilizável mesmo pós-migração, ver `wikiImages.js`
  linha ~166). Algoritmo: remove extensão, remove prefixo de thumbnail
  (`Looktype-addons-`/`Itens-addons-`), normaliza `_`/`-` pra espaço, tenta
  casar o começo do nome do arquivo com o `name` atual da linha (comparação
  sem espaço/pontuação) pra descartar o segmento de espécie e manter só o
  descritor; garante que o resultado termine em "Addon" (acrescenta se
  faltar). Três resultados possíveis por linha: (1) casou e sobrou descritor
  de verdade → vira o novo nome (ex: "Annihilape" + arquivo
  "Annihilape - Inosuke addon.png" → **"Inosuke Addon"**); (2) casou mas não
  sobrou nada além do próprio "addon" (o arquivo era só `<nome>_addon.png`,
  sem descritor a mais) → mantém o nome atual e só acrescenta "Addon" (ex:
  "Black Suit" → "Black Suit Addon"); (3) não casou (nome da linha não
  aparece no arquivo — geralmente porque o nome da linha é herdado de um dos
  vários Pokémon compatíveis do addon, não do addon em si, ex: "Hollow
  Pinsir" com arquivo `Hollow_addon.png`) → usa o descritor do arquivo puro,
  sem tentar preservar o nome antigo (ex: "Hollow Pinsir" →
  **"Hollow Addon"**; "Executioner Staraptor" → "Executioner Addon"). As 6
  linhas de Ursaluna/Bloodmoon Ursaluna/Shiny Bloodmoon Ursaluna resolveram
  corretamente em 3 pares distintos ("Eldritch Addon" x3 variantes normal/
  shiny/bloodmoon, "Oni Addon" x3 idem) — confirmado que o par
  Ursaluna/Bloodmoon Ursaluna citado no bug report ficou distinguível.
  **Todas as 62 linhas foram resolvidas** (nenhuma ficou sem recurso — todas
  tinham pelo menos um dos três campos-fonte utilizável); não houve lista de
  "não resolvido" desta vez. Só o campo `name` foi alterado (confirmado por
  diff campo-a-campo contra o backup: `wikiTitle`, `category`, `slug`,
  `imageUrl`, `extractedFields` idênticos em todas as 62 linhas); contagem
  total do catálogo não mudou (3571). Backup das 62 linhas completas (todos
  os campos, pré-mudança) em
  `/tmp/.../scratchpad/pre-addon-name-fix-backup.json` (efêmero, sessão
  específica — não depender disso em sessões futuras). **Nota lateral não
  corrigida** (fora do escopo pedido): o algoritmo produz colisão de nome
  esperada/aceitável entre linhas que são genuinamente a mesma variante de
  addon em formas normal/shiny/bloodmoon (ex: "Eldritch Addon" aparece em 3
  linhas, "Flower Hat Addon" em 4 linhas de Florges de cores diferentes) —
  não é um bug novo, é reflexo de que o addon em si já era compartilhado
  entre variantes antes desta correção; não mexido sem instrução específica
  (dedup de `addons` é uma tarefa separada, os ~56 grupos de nome duplicado
  já documentados no achado de 2026-07-12 acima continuam pendentes).
- **Migração de dado real 2026-07-15 (consolidação em `decoracao`)**: a pedido
  explícito do usuário ("mude a categoria do catálogo" — depois de uma
  primeira versão só de exibição, ver `frontend/src/domain/formatCategoryLabel.js`,
  que o usuário deixou claro que não era o que queria), **23 categorias**
  cosmético/mobília foram fundidas numa categoria nova, `decoracao`: `carpets`
  (125), `misc` (116), `doll` (64), `figure` (53), `outfits` (48),
  `collectibles` (38), `tapestries` (38), `plush` (35), `costumes` (31),
  `balloons` (19), `ornaments` (18), `birthday-cakes` (17), `chairs` (16),
  `chests` (14), `beds` (13), `tables` (10), `sofas` (8), `wallpapers` (7),
  `pillows` (5), `benches` (4), `fireworks` (4), `desks` (4), `wreaths` (1) —
  **688 linhas** no total, confirmado por `groupBy` antes e depois da
  migração (contagens bateram exatamente com as esperadas, sem drift desde a
  auditoria anterior no mesmo dia). Catálogo total permanece **3571** (só
  `category` mudou, nenhuma linha criada/apagada); categorias principais
  caem de 41 para **19** (41 − 23 + 1). `daily-boss-access` (24 itens) foi
  **deliberadamente excluído** — mesma decisão já registrada acima (não são
  itens físicos, são janelas de acesso sazonal; decisão de modelagem maior,
  não mexida sem perguntar de novo). As categorias "mantém nome próprio"
  (`utility`, `tickets`, `boss-keys`, `mega-stones`, `pokeballs`,
  `held-items`, `evolution-items`, `sticker-balls`, `addons`, `materials`,
  `backpacks`, `tms`, `boxes`, `depots`, `pokemon`, `pokemon-shiny`,
  `cherish-ball-pokemon`) também não foram tocadas. Apenas o campo `category`
  foi alterado em cada uma das 688 linhas — todos os demais campos
  (`name`, `wikiTitle`, `imageUrl`, `slug`, `extractedFields`, incluindo
  `extractedFields.mainCategory`, que continua um campo denormalizado sem
  consumidor real, ver seção "Campos denormalizados" abaixo — deliberadamente
  não resincronizado) permanecem byte-idênticos, confirmado por spot-check
  campo-a-campo em 5 linhas espalhadas pelas categorias de origem. Backup
  completo das 688 linhas (todos os campos, pré-migração) em
  `/tmp/.../scratchpad/pre-decoracao-migration-backup.json` (efêmero, sessão
  específica — não depender disso em sessões futuras).
  **Seguido (para a migração não se desfazer sozinha)**: atualizado
  `src/wiki-crawler/parsers/categoryClassifier.js` — toda regra de `RULES`
  que antes resolvia para uma das 23 categorias fundidas agora resolve para
  `'decoracao'` (o padrão de nome/regex de cada regra não mudou, só a
  categoria de destino). Ex.: `classifyItemCategory('Red Royal carpet')`
  retornava `{ category: 'carpets', matchedRule: true }` antes, agora
  retorna `{ category: 'decoracao', matchedRule: true }`;
  `classifyItemCategory('Legendary Blastoise Cursed Statue')` retornava
  `{ category: 'collectibles', matchedRule: true }` antes (via regra
  `statues`), agora `{ category: 'decoracao', matchedRule: true }`. O
  fallback cego pra `materials` (nome vazio ou nenhuma regra bate, ex:
  `classifyItemCategory('Fire Stone')` → `{ category: 'materials',
  matchedRule: false }`) **não foi alterado** — é um caso separado, já
  correto, fora do escopo desta consolidação. `misc` nunca teve regra própria
  neste classificador (não era produzido por ele) — nada a mudar ali.
  Confirmado por `grep` exaustivo em `src/` e `scripts/` que nenhum dos 8
  scripts `sync*.js` que chamam `classifyItemCategory` (`syncDailyBossCatalog.js`,
  `syncDungeonCatalog.js`, `syncNpcShopCatalog.js`, `syncEventCatalog.js`,
  `syncMinigamesCatalog.js`, `syncCraftSystemCatalog.js`,
  `syncCraftingIngredients.js`, `syncQuestCatalog.js`) hardcodava nenhuma das
  23 categorias fora do classificador — a mudança no módulo compartilhado
  basta, nenhum desses 8 arquivos precisou ser tocado.
  Verificado: `node -c` no classificador; `GET /catalog-items?category=decoracao`
  retorna `total: 688` com itens reais; `GET /catalog-items?category=misc`
  (e as outras 22 categorias antigas) retornam `total: 0`; `GET
  /catalog-items/filters` confirma 19 categorias no total, `decoracao: 688`,
  `daily-boss-access: 24` inalterado.
- **Migração de dado real 2026-07-15 (split `outfit` pra fora de
  `decoracao`, mesmo dia, pedido de acompanhamento)**: a pedido explícito do
  usuário ("coloque costume e outfit na categoria outfit"), os grupos
  `outfits` (48) e `costumes` (31) — que tinham acabado de ser fundidos em
  `decoracao` na migração imediatamente acima — foram puxados de volta pra
  fora dela e para uma categoria nova própria, `outfit` (singular, string
  exata pedida pelo usuário, não "corrigida" pra plural). **79 linhas** no
  total, identificadas por `wikiPageId` a partir do backup pré-migração da
  consolidação anterior (`pre-decoracao-migration-backup.json`, que ainda
  guarda a categoria original de cada linha). Aplicado com uma proteção
  extra: só migrou uma linha se a categoria **atual** no banco ainda fosse
  `decoracao` no momento da mudança (guarda contra sobrescrever alguma
  reclassificação manual feita entre as duas migrações no mesmo dia) —
  **nenhuma das 79 precisou ser pulada**, todas ainda estavam em
  `decoracao` como esperado. `decoracao` caiu de 688 para **609** (688 − 79);
  `outfit` passou de 0 para **79**. Catálogo total permanece **3571** (só
  `category` mudou, nenhuma linha criada/apagada); categorias principais
  sobem de 19 para **20** (a nova `outfit`). Apenas o campo `category` foi
  alterado nas 79 linhas — todos os demais campos (`name`, `wikiTitle`,
  `imageUrl`, `slug`, `extractedFields`) permanecem intocados, confirmado
  por spot-check em 2 linhas de cada grupo original (ex: "Bomber King &
  Queen Outfit" e "Christmas Helper", ex-`outfits`; "Jolteon Costume" e
  "Mudkip Costume", ex-`costumes` — todas com `category: 'outfit'`
  confirmado pós-migração). Backup completo das 79 linhas (todos os campos,
  pré-mudança, capturado direto do estado live antes do update — não do
  backup de ontem) em
  `/tmp/.../scratchpad/pre-outfit-split-backup.json` (efêmero, sessão
  específica — não depender disso em sessões futuras). Nenhuma outra das 21
  categorias fundidas em `decoracao` foi tocada — `decoracao` continua
  contendo `carpets`, `misc`, `doll`, `figure`, `collectibles`,
  `tapestries`, `plush`, `balloons`, `ornaments`, `birthday-cakes`,
  `chairs`, `chests`, `beds`, `tables`, `sofas`, `wallpapers`, `pillows`,
  `benches`, `fireworks`, `desks`, `wreaths`.
  **Seguido (para o split não se desfazer sozinha)**: atualizado de novo
  `src/wiki-crawler/parsers/categoryClassifier.js` — as duas regras que
  reconhecem `outfits?`/`costumes?` (que tinham acabado de ser apontadas
  pra `decoracao` na consolidação) agora resolvem para `'outfit'`. Ex.:
  `classifyItemCategory('Fancy Outfit')` retornava `{ category: 'decoracao',
  matchedRule: true }` antes deste split, agora retorna `{ category:
  'outfit', matchedRule: true }`; `classifyItemCategory('Halloween
  Costume')` idem. Nenhuma outra regra foi tocada — confirmado que
  `classifyItemCategory('Red Royal carpet')` e
  `classifyItemCategory('Legendary Blastoise Cursed Statue')` continuam
  resolvendo para `decoracao` como antes, e o fallback cego pra `materials`
  (`classifyItemCategory('Fire Stone')`) continua inalterado.
  Verificado: `node -c` no classificador; `classifyItemCategory` testado
  ao vivo pros 4 casos acima; contagem via Prisma confirmando `outfit: 79` e
  `decoracao: 609` no banco real pós-migração; `grep` exaustivo em `src/` e
  `scripts/` confirmando que nenhum script hardcoda `'outfits'`/`'costumes'`
  fora do classificador (nada a tocar além do módulo compartilhado).
- **Deleção de dado real 2026-07-15 (remoção de `daily-boss-access`, decisão
  pendente desde 2026-07-13 finalmente resolvida a pedido explícito do
  usuário)**: as **24 linhas** de `daily-boss-access` (janelas de acesso
  sazonal a boss diário — "A Sacred Flame", "Kalos Quest", "Páscoa 2022–2026",
  "Mega Evolution", "Valentine's Day 2025", "Boost Ice", "Dia das Mães
  2022–2025", "Dia das Criancas 2024"/"Dia das Crianças 2025", "Porygon Toy
  Room"/"Porygon Toy Room 2022"/"Porygon Toy Room 2023", "Porygon Toy",
  "Christmas 2024", "Dia Dos Pais 2025", "A primeira aparição é após derrotar
  200x o Mega Rayquaza", "Halloween 2024" — nunca representaram item físico
  algum, ver a decisão em aberto registrada em 2026-07-13 acima) foram
  **apagadas do catálogo**, não só ocultadas. Confirmado antes de apagar: zero
  linhas de `StoreItem` referenciam qualquer um desses 24 `wikiPageId` como
  `catalogItemId` — deleção sem necessidade de limpeza de FK. Backup completo
  das 24 linhas (todos os campos, pré-deleção) em
  `/tmp/.../scratchpad/pre-daily-boss-access-deletion-backup.json` (efêmero,
  sessão específica — não depender disso em sessões futuras). Catálogo total
  cai de **3571 para 3547** (24 linhas a menos, não uma realocação — as
  únicas linhas desta rodada que efetivamente saem do banco); categorias
  principais caem de 20 para **19** (a categoria some por completo, não é
  fundida em nenhuma outra). Verificado: `GET
  /catalog-items?category=daily-boss-access` → `total: 0`; `GET
  /catalog-items/filters` não lista mais `daily-boss-access` entre as 19
  categorias.
  **Follow-up sinalizado, não resolvido nesta tarefa**: `src/wiki-crawler/
  parsers/syncDailyBossCatalog.js` (`syncCategory` chamada com o namespace
  `'access'`, linha ~145) ainda tem o branch de **criação** que gera essas
  linhas — ele faz `findFirst` por `wikiTitle`/`name` e, não achando (o que
  agora é sempre o caso, já que as 24 linhas foram apagadas), cria de novo
  com `category: 'daily-boss-access'`. Ou seja, **a próxima vez que alguém
  rodar `npm run dailyboss:sync`, essas 24 linhas (ou uma variação delas, se
  a wiki tiver mudado o conteúdo da página `Daily_Boss` desde então) voltam a
  existir** — a deleção de hoje não é permanente contra uma sync futura.
  Decisão deliberada de **não** desligar esse branch nesta tarefa (o pedido
  do usuário foi "apagar as 24 linhas agora", não "parar de rastrear janelas
  de acesso pra sempre" — isso envolveria decidir se esse conceito deveria
  virar outra coisa, ex: uma tabela própria fora de `CatalogItem`, questão de
  modelagem maior que não foi perguntada). Se `dailyboss:sync` rodar de novo
  antes dessa decisão de modelagem ser tomada, as 24 linhas reaparecem
  silenciosamente — quem rodar a sync deveria saber disso.
- **Backfill de sprite 2026-07-15 (44 itens reais com `imageUrl` vazio, 2
  resolvidos via página wiki dedicada)**: auditoria (feita à parte, antes
  desta tarefa) encontrou **68 linhas** com `imageUrl === ''` (nunca
  capturaram nenhuma imagem de origem — problema diferente de "pendente de
  download", que já não existe mais no catálogo: as 3503 linhas com URL local
  `http://localhost:3000/images/...` foram todas confirmadas com arquivo real
  em disco). Das 68, **24 eram as linhas de `daily-boss-access`** apagadas no
  item acima (irrelevante — não são item físico, não precisam de sprite),
  deixando **44 itens reais** sem imagem nenhuma
  (`materials`: 17, `decoracao`: 9, `addons`: 8, `backpacks`: 3, `outfit`: 3,
  `boxes`: 2, `pokemon-shiny`: 2) — a maioria criada por
  `syncQuestCatalog.js`/`parseRewardProse` (`dungeons.js`), formato de
  recompensa em prosa que nunca teve imagem disponível (limitação de parsing
  já documentada, não um bug novo).
  Pra cada uma das 44, buscado por `name` (e `wikiTitle` como alternativa,
  quando diferente) contra os 1897 títulos de `data/wiki-crawl/index.json`,
  só por **match exato** (case-insensitive), sem heurística de nome
  aproximado — **só 2 das 44 bateram**: `Ancient Stone` (`wikiPageId`
  1246799051, página real `pageid` 10538) e `Addon Box` (`wikiPageId`
  1226251352, página real `pageid` 4480). Pras 2, lido o wikitext da página
  própria e extraída a primeira referência `[[Arquivo:...]]` (mesmo padrão
  usado nos dois: é literalmente a primeira imagem do wikitext, perto da
  introdução) — `Ancient-stone.gif` e `Addon box.png` respectivamente — e
  computada a URL real via a mesma lógica de hash MD5 do MediaWiki já
  replicada em `mwImageUrl()` nos scripts de sync (incluindo a regra de
  capitalizar a primeira letra do filename, já documentada acima em
  "Migração de imagem para local" — não reintroduzido esse bug). `imageUrl`
  das 2 linhas foi atualizado pra essas URLs remotas de
  `wiki.otponline.com` (o estado "pendente" correto — não foi feito
  download, a wiki continua bloqueada por Cloudflare pra qualquer fetch
  automatizado; as 2 linhas agora aparecem em `GET /wiki-images/pending`
  como qualquer outra imagem ainda não baixada, prontas pro bookmarklet do
  usuário pegar na próxima rodada). As outras **42 linhas ficaram com
  `imageUrl: ''` intocado** — nenhuma tem página própria em
  `data/wiki-crawl/index.json` (confirmado por busca exaustiva pelas 1897
  páginas, não só pelas 4 checadas manualmente antes desta tarefa) — não há
  fonte de imagem em lugar nenhum do dado já coletado; só um novo crawl da
  wiki resolveria essas 42.
  Backup completo das 44 linhas (todos os campos, pré-mudança) em
  `/tmp/.../scratchpad/pre-sprite-backfill-backup.json` (efêmero, sessão
  específica — não depender disso em sessões futuras). Catálogo total
  permanece **3547** (só `imageUrl` mudou em 2 linhas, nenhuma linha
  criada/apagada/reclassificada). Verificado: `GET /wiki-images/pending`
  lista as 2 URLs novas com o `wikiPageId` e `imageUrl` computados
  corretamente; contagem de `imageUrl === ''` no banco caiu de 44 (as reais,
  pós-deleção de `daily-boss-access`) para **42**.
- **Resolvido em 2026-07-15 (dedup de `tickets`)**: dos 9 itens de `tickets`,
  6 eram duplicata real de 3 tickets de evento (`Catch`/`Experience`/
  `Fishing Bonus Ticket`, todos originados da mesma página de evento
  `Gincanas de Aniversario - 12 Anos`) com sua contraparte já existente vinda
  do Battle Pass (`Ticket - Catch`/`Ticket - Experience`/`Ticket - Fishing`) —
  mesmo padrão de "mesmo item, duas origens diferentes" já resolvido em
  outras categorias nesta sessão. Identificado (não por `wikiTitle`, que não
  tem overlap nenhum entre esses nomes) comparando
  `extractedFields.wikiImageUrl` (o nome de arquivo de imagem original da
  wiki) — mesmo critério já registrado acima na "normalização de duplicatas"
  de 2026-07-12. O grupo `Experience` tinha uma 3ª linha (`Ticket - EXP`),
  ela mesma uma duplicata interna do Battle Pass da própria `Ticket -
  Experience` (duas grafias do mesmo ticket, cobrindo temporadas diferentes:
  `EXP` tinha só temporadas 2–6, `Experience` só temporada 1) — mesclada
  junto. Sobrevivente escolhida em cada grupo: a linha já nomeada `Ticket -
  <Palavra>` (convenção que `Ticket - Boss`/`Ticket - Dungeon`, intocados,
  já usavam), preferindo a forma por extenso (`Experience`) sobre a
  abreviada (`EXP`). `extractedFields` mesclado por união, nunca
  sobrescrito: `subcategories`/`appearances` (união com dedupe por
  entrada idêntica — no grupo `Experience` as duas faixas de temporada do
  Battle Pass não tinham overlap, virou uma lista só com as 14 aparições);
  `eventSourceWikiUrl`/`eventSourceWikiTitle`/`eventRewardItemFileKey`/
  `sections` das linhas de origem evento preservados na sobrevivente (que
  antes só carregava proveniência de Battle Pass, agora carrega as duas).
  `wikiImageUrl`/`imageUrl`/`mainCategory`/`classificationReason` da
  sobrevivente mantidos como estavam, não mesclados. Nenhum
  `StoreItem.catalogItemId` (nem `StorePokemon`/`StorePokemonAddon`/
  `StorePokemonSticker`, conferido por completude) referenciava as 4 linhas
  apagadas — confirmado antes de apagar, nenhuma reatribuição de FK
  necessária. Nenhum arquivo de `public/images/` foi tocado/apagado — só
  linhas de `CatalogItem`. `tickets`: 9 → **5** (`Ticket - Boss`, `Ticket -
  Catch`, `Ticket - Dungeon`, `Ticket - Experience`, `Ticket - Fishing`).
  Catálogo total: 3547 → **3543** (só as 4 linhas apagadas, nenhuma criada).
  Backup completo das 9 linhas (todos os campos, pré-merge) em
  `/tmp/.../scratchpad/pre-ticket-dedup-backup.json` (efêmero, sessão
  específica — não depender disso em sessões futuras). Verificado: `GET
  /catalog-items?category=tickets` devolve exatamente 5 itens com os nomes
  certos; `GET /health` limpo depois das escritas.
- **Resolvido em 2026-07-15 (auditoria de `materials`)**: reportado pelo
  usuário "em materials temos alguns itens duplicados, outros que são
  decoração". Uma primeira tentativa de auditoria automatizada (subagente
  `backend-catalog` com escopo grande e aberto) foi interrompida pelo
  classificador de segurança do modo automático por ter começado a tomar
  decisões de mais alto risco além do que foi pedido explicitamente — nenhuma
  escrita chegou a ser commitada (conferido: contagens de `materials`/
  `decoracao`/`addons`/total antes e depois da interrupção eram idênticas).
  Refeito de forma direta e conservadora, só com os casos verificados caso a
  caso contra `extractedFields`/wikitext real, sem inferência especulativa:
  - **6 pares de duplicata real** (mesmo critério de sempre —
    `extractedFields.wikiImageUrl` idêntico — mais confirmação manual de que
    as duas linhas eram genuinamente o mesmo item, não uma "versão
    aprimorada" reaproveitando o sprite): `Cooper Coin Relic`/`Cooper Relic
    Coin`, `Piece of Crystal`/`Crystal Slice`, `Gold Coin Relic`/`Gold Relic
    Coin`, `Lovely ingots`/`Lovely ingot`, `Screws`/`Screw`, `Silver Coin
    Relic`/`Silver Relic Coin`. Sobrevivente escolhido pelo `wikiTitle` da
    página própria da wiki quando existia (`Cooper/Gold/Silver Coin Relic`,
    `Screws` — todas com `wikiPageId` real, não sintético); pro par sem
    página própria (`Piece of Crystal`/`Crystal Slice`, `Lovely
    ingots`/`Lovely ingot`), o nome que bate literalmente com o arquivo de
    imagem original venceu. `extractedFields` mesclado por união (mesmo
    princípio dos merges anteriores) — `subcategories` e cada array de
    origem (`dailyBossSources`/`questSources`/`npcShopSources`/
    `craftIngredient`/etc.) combinados com dedupe, nunca sobrescritos.
    **Deliberadamente NÃO mesclado** (mesma imagem, mas item diferente por
    tier): `Enchanted Ho-oh Plume`/`Ho-Oh Plume` e `Enchanted Silver
    Wing`/`Silver Wing` — padrão recorrente de "versão Enchanted reaproveita
    o sprite da versão base", não uma duplicata de cadastro.
  - **17 itens reclassificados de `materials` pra `decoracao`** (eram
    decoração/mobília com origem de drop/loot, não materiais de crafting —
    mesma classe de erro categoria-vs-origem já corrigida em `misc`/nas 23
    categorias fundidas): `Magical flower vase`, `Perfect Milk bottle`,
    `Wooden Secretaire`, `Mini Squirtle` (arquivo `..._figure.png`), `Mummy
    Leafeon` (idem), `Mother Neon` (placa neon — linha diferente da "Mother
    decoration neon" já movida na Fase 1 de 2026-07-13, essa vivia em
    `materials` e escapou daquela varredura por não estar em `misc`),
    `Mother Vespiqueen` (arquivo `..._legendary.png`, estátua), `Serpentarium
    - Baby Ekans`, `Painting of an Eevee`, `Stuffed Dragon`, `Tentacle Eye
    Lamp`, `Tentacle Lamp`, `Phanpy slide`, `Purple Baloon`, `Green Square
    capert` (carpete com erro de digitação no nome — "capert" em vez de
    "carpet", por isso nunca bateu na regra de nome `carpet` e ficou preso em
    `materials` desde a consolidação de ontem), `Medal of Honour`, `Emblema
    antigo`. Cada um confirmado individualmente via `extractedFields`/origem
    (boss "Mother Boss X" de Dia das Mães, arquivo de imagem, contexto da
    quest) antes de mover — nenhum movido só pelo nome sozinho.
  - **1 item reclassificado de `materials` pra `addons`**: `Time Magician`
    (wikiPageId 1558657769, drop do "Kaido Boss"). O nome do arquivo de
    imagem (`Time_Magician_addon.png`) já sugeria isso, e o wikitext da
    página `Daily_Boss` confirma: `'''Time Magician''': Addon para
    Poliwrath.` — é um addon de Pokémon de verdade, miscategorizado.
    `extractedFields.addonCompatibilities` preenchido com
    `[{pokemonWikiTitle: 'Poliwrath'}]` (dado real extraído do wikitext, não
    inventado) — sem `looktypeImageUrl`/`looktypeShinyImageUrl` (não existe
    esse asset separado pra esse item, mesmo gap já aceito pros ~173 addons
    que só batem no fallback regex, documentado na seção "Anunciar Pokémon —
    frontend").
  - **Deixados como `materials`, verificados e confirmados genuínos** (nomes
    ambíguos que pareciam candidatos, mas checados individualmente contra
    `extractedFields`/wikitext antes de decidir não mover): `Ice Bra`
    (`craftIngredient` real, usado em receita de TM102/TM108 — é loot/
    material, não vestimenta, apesar do nome), `Cursed Souls`, `Green Ambar`,
    `Purple Royal` (recompensas de quest genuínas, sem sinal de decoração),
    `Wise Glasses`, `Prison Treasure`, `Punching Gloves` (drops de
    dungeon/boss, equipamento/loot, não decoração), `Hexagonal Ruby`,
    `Rainbow Opal` (gemas — materiais de crafting de verdade, mesma família
    de `Blue Diamond`/`Giant Amethyst`/`Giant Topaz` que já ficam em
    `materials`).
  - `src/wiki-crawler/parsers/categoryClassifier.js`: adicionadas 5 regras
    novas resolvendo pra `'decoracao'` (`vases?`, `lamps?`, `paintings?`,
    `stuffed`, `medals?`) — substantivos genéricos de decoração que
    apareceram repetidas vezes nesta auditoria; evita que um item novo
    futuro com uma dessas palavras caia em `materials` de novo pelo mesmo
    motivo. Erro de digitação pontual ("capert") e nomes muito específicos
    (Secretaire, Serpentarium) não viraram regra — não vale generalizar por
    um caso só.
  - Contagens: `materials` 169 → **145** (24 saíram: 12 removidas por merge
    + 17 movidas pra `decoracao` + 1 pra `addons`, contando cada par de merge
    como perda de 1 linha — 6 pares = 6 linhas a menos). `decoracao` 609 →
    **626** (+17). `addons` 739 → **740** (+1). Catálogo total: 3543 →
    **3537** (só as 6 linhas de merge saíram de verdade, as demais só
    trocaram `category`). Backup completo das 30 linhas tocadas (pré-mudança,
    todos os campos) em `/tmp/.../scratchpad/pre-materials-fix-backup.json`
    (efêmero, sessão específica). Nenhum `StoreItem`/`StorePokemon*`
    referenciava as 6 linhas perdedoras do merge — confirmado antes de
    apagar. `GET /health` limpo depois das escritas.
  - **Ancient Stone** (reportado pelo usuário como "sem sprite" de novo):
    já tinha sido corrigido antes nesta mesma sessão — `imageUrl` aponta pra
    `https://wiki.otponline.com/images/3/32/Ancient-stone.gif`, já aparecendo
    corretamente em `GET /wiki-images/pending`. Falta só o usuário rodar o
    bookmarklet de novo pra baixar (não é um bug novo, é o mesmo item já na
    fila — ver "Backfill de sprite 2026-07-15" acima).

## Frontend (`frontend/`)

React + Vite, sem TypeScript. Rebrand pra **PokeShopping** em 2026-07-13 (ver
topo deste arquivo) — deixou de ser um marketplace único e virou plataforma
de "cada usuário cria sua própria loja".

**Rotas atuais**:
- `/` → `Landing.jsx` — página de marketing, header próprio (wordmark
  "PokeShopping" + botões Entrar/Cadastrar), hero explicando o conceito,
  colagem de sprites reais do catálogo, seção de features, footer. **Não**
  usa o `AppLayout`/nav interno (`Catálogo`/`Mapa de Dados`) — tem CSS próprio
  em `Landing.css` (paleta azul/amarelo temática Pokémon, fonte "Baloo 2" via
  Google Fonts pros títulos), deliberadamente separado de `App.css`.
- `/login`, `/cadastro` → `Login.jsx`/`Register.jsx` — **placeholders
  honestos** (na sessão em que foram criadas): cartão centralizado, aviso
  amarelo deixando claro que "ainda não existe de verdade", campos
  desabilitados, não chamam `api.js`. **Atualização (2026-07-13, ver seção
  "Autenticação" abaixo)**: o backend agora tem `POST /auth/google` de verdade
  (Firebase Admin SDK); essas telas ainda podem não ter sido atualizadas para
  consumir a rota — checar o arquivo antes de assumir o estado, isso é tarefa
  do papel Interface, não coberta aqui.
- `/catalog`, `/mapa-de-dados` → `Catalog.jsx`/`DataMap.jsx`, dentro de
  `AppLayout` (nav compartilhada `Catálogo`/`Mapa de Dados`), como antes.
  `Catalog.jsx` continua a tela de referência de padrão (debounce de busca,
  paginação, badges de categoria/subcategoria).

**Regra permanente (ver `ARCHITECTURE_RULES.md` regra 6): toda tela nova do
frontend é pensada mobile-first desde a primeira versão** — base sem
`@media` alveja mobile, `min-width` amplia pra telas maiores; nunca o
caminho inverso (`max-width` a partir de desktop), e isso vale mesmo pra
mudança pequena/cosmética (ex: mover um botão de posição). Histórico de como
isso foi aplicado retroativamente ao código já existente antes da regra
existir, abaixo:

**Mobile-first (2026-07-13)**: `App.css` não tinha nenhum `@media` query
antes desta data (não era responsivo em nenhuma direção) — adicionado nav/
filtros/paginação/DataMap com base mobile + `min-width` pra ampliar.
`Landing.css` foi invertida de desktop-first (`max-width`) pra mobile-first
(base sem query + `min-width: 860px`). A colagem de sprites do hero usa uma
única variável CSS (`--sprite-scale`, `0.6` mobile → `1` no `min-width:860px`)
em vez de duplicar a geometria — todo width/height/top/left/etc de cada
sprite é `calc(<valor-desktop> * var(--sprite-scale))`, então mobile e
desktop nunca saem de sincronia.

**Piso mínimo de largura**: `body { min-width: 320px }` em `index.css` —
abaixo disso a página ganha rolagem horizontal em vez de continuar
espremendo o conteúdo. `.landing-auth-card` precisou de `box-sizing:
border-box` (tinha `width:100%` + `padding` sem isso, estourava ~5px em
320px).

**Bug corrigido (2026-07-13)**: `#root` em `index.css` (leftover do template
padrão do Vite, nunca limpo) tinha `width: 1126px; max-width: 100%; margin: 0
auto; border-inline: 1px solid var(--border)` — em qualquer tela mais larga
que 1126px isso deixava uma borda/faixa branca dos dois lados (o app inteiro
ficava confinado a 1126px centralizado). Removido; `#root` agora é só
`width: 100%` + o flex/min-height que já era necessário. `index.css` no geral
ainda tem bastante sobra do template original do Vite (variáveis `--accent`
roxo, `--sans`, etc. — nenhuma usada fora do próprio arquivo) — não limpo por
inteiro, só o que causava o bug relatado.

**Removido em 2026-07-13**: página `Listings` ("Anúncios") e as páginas
`Stores`/`StoreDetail` ("Lojas") — removidas a pedido, sem substituto na
mesma sessão do rebrand. `api.js` não tem mais `getListings`/`getStores`/
`getStore` (sem outro consumidor). Os modelos `Listing`/`Store`/`StorePokemon`
no schema Prisma continuam existindo (não foram tocados, são dado de
backend) — só as telas de frontend que os exibiam foram removidas.

**Removido em 2026-07-13**: páginas `Stores` e `StoreDetail` ("Lojas") e as
rotas `/stores` e `/stores/:slug` — removidas a pedido, sem substituto.
`api.js` não tem mais `getStores`/`getStore` (sem outro consumidor). A rota
`/`, que antes renderizava `Stores`, agora renderiza `Catalog` (já que
`Catalog.jsx` é a tela mais completa do frontend). CSS `.back-link`
(exclusivo de `StoreDetail`) removido de `App.css`; `.grid`/`.card`/`.muted`/
`.error` foram mantidos por serem compartilhados com `Catalog.jsx`/
`DataMap.jsx`. Os modelos `Store`/`StorePokemon`/`StoreItem`/etc. no schema
Prisma continuam existindo (não foram tocados, são dado de backend) — só as
telas de frontend que os exibiam foram removidas.

Backend de filtros: `src/routes/catalogItems.js` — `GET /catalog-items` (query
params: `search`, `category`, `subcategory`, `generation`, `regionalForm`,
`hasImage`, `page`, `pageSize`) e `GET /catalog-items/filters` (opções disponíveis
com contagem, pra popular os `<select>`).

Backend de imagens: `src/routes/wikiImages.js` — `GET /wiki-images/pending`,
`POST /wiki-images/upload`, estático em `GET /images/:filename` (ver seção "Wiki
crawler" acima).

## Autenticação (2026-07-13)

**Backend agora tem uma rota de autenticação real** — a nota em "Frontend" sobre
`Login.jsx`/`Register.jsx` serem "placeholders sem rota de backend" ficou
desatualizada nesse ponto específico (a tela ainda pode não estar consumindo isso;
checar `frontend/src/pages/Login.jsx` antes de assumir).

- `src/firebaseAdmin.js`: singleton do Firebase Admin SDK (mesmo padrão do
  singleton do Prisma em `src/db.js` — inicializa uma vez por processo, `require()`
  repetido não reinicializa). Lê o service account de
  `process.env.FIREBASE_SERVICE_ACCOUNT_PATH`, resolvido relativo à raiz do repo
  (`path.resolve(__dirname, '..', ...)`), via `admin.credential.cert(...)`. Exporta
  `{ admin }` — quem precisa do auth chama `admin.auth()`.
- `POST /auth/google` (`src/routes/auth.js`, montada em `/auth` em `src/index.js`,
  passa por `asyncHandler` como toda rota do projeto): recebe `{ idToken }` (ID
  token do Firebase que o frontend obtém depois do popup de login Google
  client-side), verifica com `admin.auth().verifyIdToken(idToken)`. Token
  inválido/expirado → `401` com JSON de erro limpo (nunca deixa a exceção do SDK
  vazar stack trace pro cliente). Em caso de sucesso, extrai `uid`/`email`/`name`/
  `picture` do `DecodedIdToken` (esse é o formato do retorno de `verifyIdToken` —
  `name`/`picture`, não `displayName`/`photoURL`, que é o formato do objeto
  client-side `User` do Firebase Auth) e faz upsert em `User` chaveado por
  `firebaseUid`: se não achar por `firebaseUid`, tenta achar por `email` antes de
  criar (pra não estourar a constraint `@unique` de `email` caso já exista uma
  linha com esse email e `firebaseUid` nulo/diferente — nesse caso de
  conflito real, `409` explícito em vez de deixar o Prisma jogar erro de
  constraint sem tratamento). Resposta: `{ id, email, name, image }` — sem
  sessão/JWT/cookie, esse projeto não tem mecanismo de sessão ainda e não foi
  pedido um; a decisão de o que fazer com o objeto retornado é do frontend.
  Verificado com token inválido (`{"error":"Token de autenticação inválido ou
  expirado."}`, `401`) — o fluxo feliz (login Google real) depende da peça de
  frontend, fora do escopo desta mudança.

## Setup de loja pós-login e edição (2026-07-14)

Depois do primeiro login, o usuário precisa criar sua loja (nome → vira o slug
da URL pública, mais contato). O modelo `Store` já existia (ver seção "Frontend"
acima — as *telas* `Stores`/`StoreDetail` foram removidas no rebrand
2026-07-13, mas as rotas de backend `GET /stores`/`GET /stores/:slug` e o
schema `Store` nunca saíram; esta mudança adiciona só a parte protegida de
criação/consulta da própria loja).

- **Schema**: campo novo `telegram String?` em `Store` (aditivo, `npx prisma
  db push` — mesmo fluxo já usado neste projeto, confirmado rodando e
  regenerando o Prisma Client). Nenhum outro model tocado.
- **`src/authMiddleware.js`** (`requireAuth`, exportado já envolvido em
  `asyncHandler`): lê `Authorization: Bearer <idToken>`, verifica com
  `admin.auth().verifyIdToken()` (mesmo `firebaseAdmin.js` de `POST
  /auth/google`), busca `User` por `firebaseUid` decodificado e anexa em
  `req.currentUser`. `401` limpo (mesmo formato `{ error }` de `auth.js`) se
  faltar header, token inválido/expirado, ou não achar `User` correspondente.
  Reutilizado pelas duas rotas abaixo.
- **`src/routes/stores.js`** (montada em `/stores` em `src/index.js`, **depois**
  das rotas antigas de `/auth` mas **antes** dos handlers inline `GET
  /stores`/`GET /stores/:slug` que continuam em `src/index.js`, sem mudança de
  comportamento — a ordem importa: como o router só registra `GET /me` e `POST
  /`, qualquer outra rota sob `/stores` cai (`next()`) pros handlers inline
  registrados depois):
  - `GET /stores/me` (protegida): busca `Store` por `userId: req.currentUser.id`.
    `200` com a loja se existir, `404 { hasStore: false }` se o usuário ainda
    não configurou (frontend decide onde rotear com base nisso).
  - `POST /stores` (protegida): body `{ name, gameNickname, whatsapp, discord,
    telegram }` — só `name` obrigatório. Se `req.currentUser` já tem `Store`,
    `409 { error }` (uma loja por usuário, nunca sobrescreve silenciosamente).
    Gera `slug` com a mesma função `slugify` usada nos scripts de sync do
    wiki-crawler (minúsculo, remove acento via NFD, não-alfanumérico vira
    hífen). Rejeita com `400` se o slug gerado bater com uma rota reservada do
    frontend (`RESERVED_SLUGS` em `src/routes/stores.js`, hoje: `login`,
    `catalog`, `mapa-de-dados`, `cadastro`, `stores`, `auth`, `api`, **`me`**
    — conflito técnico real descoberto ao implementar: `GET /stores/me` é
    montada no mesmo path que `GET /stores/:slug`, então uma loja com slug
    `"me"` ficaria permanentemente inacessível pela rota pública, escondida
    atrás do handler `/me` —, `configurar-loja` — adicionada quando o fluxo
    de frontend do Setup Shop foi construído, mesma sessão — e
    `configuracoes` — adicionada junto com `PATCH /stores/me` abaixo, pra uma
    futura página de configurações em `/configuracoes` não ser sombreada da
    mesma forma). Se o slug já existir em outra loja, tenta
    `-2`, `-3`, ... contra a constraint `@unique` real do banco (via
    `prisma.store.findUnique`, não um Set em memória — roda uma vez por
    request, não em lote). Antes de criar, também checa unicidade de
    `whatsapp`/`discord`/`telegram` (ver `findConflictingContactField` logo
    abaixo) — `409` se algum já pertencer a outra loja. Cria a `Store`
    vinculada a `req.currentUser.id`, retorna `201` com a loja criada
    (incluindo o `slug` final, pro frontend redirecionar).
  - `PATCH /stores/me` (protegida, 2026-07-14): edição da loja já existente.
    `404 { error }` se `req.currentUser` ainda não tem `Store` (nada pra
    editar — só faz sentido depois do `POST`). Body `{ name, slug,
    gameNickname, whatsapp, discord, telegram }`, **todos opcionais** — só os
    campos presentes no body são atualizados (checagem por `!== undefined`,
    não por truthiness, pra permitir campos que só ficaram de fora do
    payload vs. campos deliberadamente enviados vazios). `slug`, quando
    presente, passa pelo mesmo `slugify()` da criação antes de comparar —
    normaliza o valor digitado, não assume que o cliente já mandou o formato
    final. Se o slug normalizado for igual ao atual, é tratado como no-op
    (sem checagem de reservado/colisão redundante). Se for diferente: mesma
    lista `RESERVED_SLUGS` → `400`; se já pertencer a **outra** loja → `409`
    — **decisão deliberada de não seguir o padrão de auto-sufixo
    (`-2`/`-3`...) da criação aqui**: na criação o slug vem derivado do nome
    (o usuário não está pensando em URL, um sufixo automático é razoável); na
    edição o usuário está digitando o slug diretamente num campo de
    configurações — uma substituição silenciosa por outro valor seria
    surpreendente, então o certo é um `409` claro que ele possa reagir, não
    um valor diferente escolhido por baixo dos panos.
- **Regra de unicidade de contato (2026-07-14), aplicada tanto na criação
  quanto na edição**: `whatsapp`/`discord`/`telegram` não têm constraint
  `@unique` no schema (`prisma/schema.prisma`'s `Store` model) — é uma
  invariante de nível de aplicação, em `findConflictingContactField`
  (`src/routes/stores.js`). Se um valor não-vazio (depois de `trim()`) for
  fornecido e **diferir do valor atual daquele campo na própria loja**,
  verifica via `findFirst` (case-insensitive, `trim()`) se **outra** loja já
  usa esse mesmo valor nesse mesmo campo — `409 { error, field }` nomeando o
  campo em conflito, sem sobrescrever silenciosamente. `excludeStoreId`
  exclui a própria loja da checagem (obrigatório na edição, ausente/falsy na
  criação — não existe loja própria ainda pra excluir). Aplicada
  retroativamente em `POST /stores` (que originalmente não checava isso) pra
  não deixar a invariante valer só na edição — a mesma regra deve valer em
  qualquer lugar por onde dado de contato entra no sistema.
- **Verificado**: `node -c` nos 3 arquivos; backend reiniciado e subiu limpo
  depois do `db push` (regenerou o Prisma Client automaticamente); `GET
  /stores/me` e `POST /stores` sem header → `401` limpo; token Bearer
  sintaticamente válido mas inválido pro Firebase → `401` limpo, sem derrubar
  o processo (`GET /health` respondeu `200` logo depois); `GET
  /stores`/`GET /stores/:slug` existentes continuam respondendo igual (campo
  `telegram: null` aparece na loja existente, resto do shape inalterado);
  lógica de slug (`slugify` + reservado + colisão) testada isoladamente — ex:
  gerar slug pra um nome igual a uma loja já existente (`"Loja"` → `loja`)
  resolve corretamente pra `loja-2` contra o banco real. **Não verificado**:
  o fluxo feliz completo de `POST /stores` criando uma linha de verdade
  (precisa de um usuário logado de verdade via Firebase — não deu pra forjar
  um idToken válido sem credenciais reais); a rejeição de slug reservado só
  foi testada na função pura, não via HTTP autenticado end-to-end pelo mesmo
  motivo.
- **Verificado (`PATCH /stores/me`, 2026-07-14)**: `node -c`; backend
  reiniciado, `GET /health` → `200` logo depois; `PATCH /stores/me` sem
  header → `401 { error: "Token de autenticação ausente." }`; com Bearer
  sintaticamente válido mas inválido pro Firebase → `401` limpo, processo
  seguiu de pé (`GET /health` `200` depois). `findConflictingContactField` e
  a checagem de `RESERVED_SLUGS` testadas isoladamente contra o banco real
  (mesma técnica usada pra validar a lógica de `POST /stores` acima, sem
  precisar de token Firebase de verdade): `'configuracoes'` confirmado na
  lista de reservados; uma loja tentando assumir o `whatsapp` já usado por
  outra → conflito retornado corretamente no campo certo; a própria loja
  re-enviando seu próprio `whatsapp` (excluindo a si mesma via
  `excludeStoreId`) → sem conflito, como esperado; comparação
  case-insensitive/trimmed confirmada (`"  TestUser#1234  "` bateu contra
  `"TestUser#1234"` já salvo). **Não verificado**: o fluxo feliz completo de
  `PATCH /stores/me` via HTTP autenticado de ponta a ponta (mesma limitação
  de sempre — sem um idToken Firebase real pra forjar a sessão); a rejeição
  de slug reservado e o `409` de colisão de slug/contato só foram testados
  na lógica isolada contra o banco, não via requisição HTTP autenticada real.

## Criação de anúncio de Pokémon (2026-07-14, revisado 2026-07-14)

Backend do formulário "criar anúncio de Pokémon" (`POST /stores/me/pokemon` +
rotas de apoio de catálogo em `/store-pokemon-options/*`). Plano de domínio
(regra do Cherish Ball, resolução de shiny, derivação de gênero, matching de
mega-stone/addon) já aprovado antes desta implementação — documentado aqui só
o que foi efetivamente construído e o que a verificação contra dado real
confirmou ou refutou.

**Revisão do mesmo dia (plano aprovado à parte) removeu o toggle de Shiny,
trocou addon de contagem pra multi-seleção real, e adicionou um endpoint de
cap de movimentos extras** — ver bloco "Revisão 2026-07-14" ao final desta
seção pro que mudou de fato; o restante abaixo descreve o desenho original,
mantido onde ainda vale.

- **Schema**: campo novo `equippedAddonCatalogItemId Int?` em `StorePokemon`
  (aditivo, `npx prisma db push`), FK opcional pra `CatalogItem`, seguindo
  exatamente a convenção de nome de relação das 3 FKs irmãs já existentes
  (`heldItemCatalogItemId`, `megaStoneCatalogItemId`, `pokeballCatalogItemId`)
  — relação nomeada
  `StorePokemon_equippedAddonCatalogItemIdToCatalogItem`, com a linha de
  back-relation espelhada em `CatalogItem` (agora a 5ª linha
  `StorePokemon_StorePokemon_*CatalogItemIdToCatalogItem`). **Sem índice**
  `@@index` novo em `StorePokemon` pra esse campo — checado antes: nem
  `heldItemCatalogItemId` nem `pokeballCatalogItemId` têm índice hoje (só
  `megaStoneCatalogItemId`/`pokemonCatalogItemId` têm), então não adicionar
  um só pro campo novo manteria a convenção real já em uso, não a
  documentada-mas-não-seguida.
  **`StorePokemonAddon` deliberadamente não foi tocado** — "Addons" nesta
  feature é só a contagem `addonCount` (campo já existente) mais, no máximo,
  um addon *equipado/visível* (`equippedAddonCatalogItemId`, o que aparece
  no sprite do Pokémon à venda); não há necessidade de registrar identidade
  de cada addon individual possuído, que é o que `StorePokemonAddon`
  modelaria — decisão de escopo do plano aprovado, não uma omissão.
  `StorePokemonSticker` (já existia, zero consumidores antes) agora tem
  consumidor real: `POST /stores/me/pokemon` aceita
  `stickerCatalogItemIds: number[]` e cria as linhas via `create` aninhado.

- **`src/routes/storePokemonOptions.js`** (montada em
  `/store-pokemon-options` em `src/index.js`), todas as rotas `GET`,
  públicas (leitura de catálogo, sem `requireAuth`), todas em
  `asyncHandler`:
  - `GET /store-pokemon-options/pokemon?search=&restrictToCherishBall=&page=&pageSize=`
    — lista de Pokémon pra escolher no formulário. Convenção de paginação
    idêntica a `GET /catalog-items` (`page`/`pageSize`, `pageSize` capado em
    200). **Mudou na revisão 2026-07-14**: o modo sem
    `restrictToCherishBall` agora busca `category IN ('pokemon',
    'pokemon-shiny')` diretamente (antes só `'pokemon'`, com shiny resolvido
    à parte por um toggle de frontend) — ver bloco "Revisão 2026-07-14" ao
    final desta seção pro porquê e o que foi removido.
    - **Regra do Cherish Ball**: quando `restrictToCherishBall=true`, usa
      `$queryRaw` (o filtro estruturado `equals` do Prisma pra JSON não bate
      de forma confiável nesses registros — confirmado durante o
      planejamento; mesmo padrão de SQL cru que `src/routes/catalogItems.js`
      já usa pro filtro de `subcategories`/`generation`) pra fazer a união:
      `(category IN ('pokemon','pokemon-shiny') AND
      extractedFields->>'cherishBallPokemon' = 'true') OR category =
      'cherish-ball-pokemon'`. **Confirmado contra o banco real**: 118 linhas
      de `cherish-ball-pokemon` + 89 linhas `pokemon`/`pokemon-shiny` com a
      flag = 207 no total, batendo com o ~207 esperado do planejamento.
      `search`, nesse modo, filtra em JS sobre esse resultado pequeno (não
      empurrado pro SQL cru).
    - `hasShinyVariant` e a rota `GET
      /store-pokemon-options/pokemon/:wikiPageId/shiny` **foram removidos na
      revisão 2026-07-14** — não existem mais no código nem na resposta.
      Ver bloco "Revisão 2026-07-14" ao final desta seção.
    - `genderOptions`: ver helper de derivação de gênero abaixo.
  - `GET /store-pokemon-options/mega-stones?pokemonWikiTitle=` — só 19 linhas
    de `mega-stones` no total, busca tudo e filtra em JS. Match primário:
    `extractedFields.megaStonePokemonWikiTitle` (17/19 linhas têm)
    comparado case-insensitive. Fallback pras 2 linhas sem o campo
    (`Kangaskhanite`, `Blastoisinite`, confirmadas via query real): tira o
    sufixo `ite` do próprio `name` (`name.replace(/ite$/i, '')`) e compara.
    **Achado na verificação, não estava previsto no plano**: o fallback
    funciona pra `Kangaskhanite` (`"Kangaskhanite".replace(/ite$/i,'') ===
    "Kangaskhan"`, bate exato com o Pokémon real) mas **não funciona** pra
    `Blastoisinite` — a wiki grafa esse item como "Blastoisinite" (com um
    "in" extra antes do "ite" final), então tirar o sufixo dá
    `"Blastoisin"`, que não bate com `"Blastoise"` (confirmado via
    `curl "/mega-stones?pokemonWikiTitle=Blastoise"` → `[]`, e também via
    `curl "?pokemonWikiTitle=Kangaskhan"` → devolve a linha certa). Isso é
    provavelmente um erro de grafia genuíno da wiki de origem
    (`Blastoisenite` seria a forma que o sufixo-strip esperaria), não um bug
    da nossa lógica — implementado exatamente como especificado no plano
    aprovado (não me cabia inventar uma heurística nova de matching não
    aprovada), mas **flagueado aqui**: hoje, criar um anúncio de Blastoise
    não vai mostrar "Blastoisinite" como opção de mega-stone no formulário,
    mesmo a stone existindo no catálogo — pendente de decisão (ex: um mapa
    de exceções nomeadas por wikiPageId, cobrindo só esse caso) numa sessão
    futura, não corrigido aqui sem aprovação por estar fora do escopo do
    plano já fechado.
  - `GET /store-pokemon-options/addons?pokemonWikiTitle=&search=` — 739
    linhas de `addons` no total, busca tudo e filtra em JS. Match
    estruturado: algum item de `extractedFields.addonCompatibilities[]`
    (566/739 linhas têm, confirmado) com `.pokemonWikiTitle` batendo
    case-insensitive. Fallback regex só pras ~173 linhas sem esse campo
    (confirmado: 173 exato), duas formas: `^<nome>\s*-\s*.*Addon$` (ex:
    "Leafeon - Zombie Makeup Addon") e `addon para\s+<nome>$` em português
    (ex: "Ciborgue addon para Stantler") — ambas testadas contra exemplos
    reais do banco (`Leafeon`, `Stantler`) e confirmadas batendo só nas
    linhas esperadas. Linhas que não batem em nenhum padrão (nomes
    genéricos tipo "Purple Band Addon" sem `addonCompatibilities`) nunca
    aparecem pra nenhuma espécie — esperado, não é bug.
    **Revisão 2026-07-14**: resposta ganhou `looktypeImageUrl`/
    `looktypeShinyImageUrl`. Pro match estruturado, vêm direto da entrada de
    `addonCompatibilities` que bateu (confirmado shape real:
    `{ pokemonWikiTitle, looktypeImageUrl, looktypeShinyImageUrl,
    looktypeImageAlt, looktypeShinyImageAlt, pokemonWikiUrl }`). Pros ~173
    matches só via fallback regex, ambos vêm `null` — não existe esse dado
    estruturado pra esses; o frontend cai pro sprite normal do Pokémon
    nesse caso.

- **Helper de derivação de gênero** (dentro do próprio
  `storePokemonOptions.js` — este projeto não tem `src/lib/`, não criado só
  pra isso): lê `extractedFields.infoboxFields` (presente em `pokemon`,
  `pokemon-shiny` e `cherish-ball-pokemon`, confirmado nas 3 categorias) e
  escaneia os valores brutos por substring de nome de arquivo de ícone de
  gênero da wiki (`Male-otp.png`/`Female-otp.png`/`Undefined.png`).
  **Cuidado crítico preservado do plano**: a checagem tem que ser pela
  substring `'Male-otp.png'`, nunca por `'Male'` cru —
  `"Female-otp.png".includes("Male")` dá `true` (a palavra "Male" é
  substring de "Female"), o que marcaria espécies só-fêmea como
  também-macho por engano. **Confirmado contra as 735 linhas reais de
  `pokemon`**: 44 sem gênero (`Undefined.png`), 549 com os dois ícones, 14
  só macho, 12 só fêmea, 116 sem nenhum ícone reconhecido (caem no fallback
  `['sem_genero']`) — distribuição plausível, sem sinal de falso-positivo
  em massa.
  **Revisão 2026-07-14**: agora que a lista de Pokémon (endpoint acima)
  devolve `pokemon-shiny` diretamente, 23 dessas linhas (confirmado via
  query real) não têm `infoboxFields` — todas oriundas do merge de Cherish
  Ball. O helper virou assíncrono e ganhou um fallback: sem
  `infoboxFields` utilizável na própria linha, mas com
  `extractedFields.sourceWikiPageId`, busca a linha `pokemon` base por
  `wikiPageId` e deriva do `infoboxFields` dela. **Confirmado contra as 23
  linhas reais**: nenhuma das bases encontradas tinha `infoboxFields`
  preenchido tampouco (e algumas nem têm base alguma, ex: "Shiny Rotom
  Fan"/"Shiny Pidgeot" sem `sourceWikiPageId`) — então na prática todas as
  23 caem no default. O fallback em si funciona (confirmado
  separadamente: Bulbasaur/linha base tem `infoboxFields` real, o lookup
  encontra e usaria corretamente se uma shiny órfã algum dia apontasse pra
  uma base com dado), só não havia nenhum caso real pra recuperar hoje.
  **Também mudou**: quando nem a própria linha nem a base resolvem, o
  fallback final agora é `['macho', 'femea']` (permissivo), não mais
  `['sem_genero']` — decisão confirmada pra não bloquear o formulário por
  falta de dado de origem.

- **`POST /stores/me/pokemon`** (`src/routes/stores.js`, mesmo padrão de
  `POST /`/`PATCH /me` já existentes: `requireAuth` + `asyncHandler`, opera
  na `Store` do `req.currentUser`, `404` se ainda não tiver loja).
  Obrigatórios: `pokeballCatalogItemId`, `pokemonCatalogItemId`, `level`,
  `gender`, `nature` (`400` nomeando o primeiro campo faltante). Opcionais:
  `nickname`, `equippedAddonCatalogItemId`, `boost`, `capturedAt`,
  `heldItemCatalogItemId`, `megaStoneCatalogItemId`, `stickerCatalogItemIds`
  (array de wikiPageId — vira `create` aninhado de `StorePokemonSticker`).
  **Campos `addonCount`/`extraMovesText`/`presetSlotsText` como entrada
  direta foram substituídos na revisão 2026-07-14** — ver bloco "Revisão
  2026-07-14" abaixo. **`world: 'BLUE'` é hardcoded/placeholder** — marcado
  com `// TODO` no código apontando pra esta seção. Este formulário ainda
  não tem UI de seleção de mundo/servidor (decisão de escopo confirmada, não
  um descuido) e o schema exige um `GameWorld` não-nulo, então `'BLUE'`
  (primeiro valor do enum) foi escolhido só pra satisfazer a constraint.
  **Nenhuma lógica de filtro/negócio deve assumir que esse valor reflete o
  mundo real do Pokémon anunciado** até esse campo virar de fato
  selecionável — todo `StorePokemon` criado por esta rota hoje tem
  `world: 'BLUE'` independentemente de onde o Pokémon realmente está.
  `priceReal`/`priceHd` ficam `null` (preço fora de escopo desta iteração,
  decisão confirmada no plano).

- **Verificado (implementação original, 2026-07-14)**: `node -c` nos 3
  arquivos (`storePokemonOptions.js`, `stores.js`, `index.js`); backend
  reiniciado, `GET /health` limpo; queries de confirmação contra o banco
  real (união Cherish Ball = 207, tipo de `sourceWikiPageId` = number,
  contagens de `addonCompatibilities` presente/ausente = 566/173,
  Kangaskhanite/Blastoisinite) — resultados documentados acima; todos os 4
  endpoints `GET` exercitados via `curl` com valores reais (`Charizard` pro
  fluxo normal + shiny, `Buneary` pro modo Cherish Ball,
  `Gardevoir`/`Kangaskhan`/`Blastoise`/`Bulbasaur` pras mega-stones,
  `Pinsir`/`Leafeon`/`Stantler` pros addons, com e sem `search`); `POST
  /stores/me/pokemon` sem header → `401` limpo; com Bearer sintaticamente
  válido mas falso → `401` limpo, processo seguiu de pé (`GET /health`
  `200` logo depois); `GET /catalog-items` testado de novo pra garantir que
  nada regrediu. **Não verificado nesta rodada**: o fluxo feliz completo de
  `POST /stores/me/pokemon` criando uma linha de verdade (mesma limitação de
  sempre neste projeto — precisa de um usuário logado via Firebase de
  verdade, não deu pra forjar um idToken válido sem credenciais reais).

### Revisão 2026-07-14 (remoção do toggle Shiny, addons multi-seleção, cap de movimentos extras)

Plano de revisão aprovado à parte, arquivos alterados:
`src/routes/storePokemonOptions.js`, `src/routes/stores.js`.

- **Toggle de Shiny removido por completo**: `GET
  /store-pokemon-options/pokemon` sem `restrictToCherishBall=true` agora
  busca `category IN ('pokemon', 'pokemon-shiny')` diretamente (o caminho
  `restrictToCherishBall=true`, que já unia `pokemon-shiny` via SQL cru pro
  Cherish Ball, não mudou). `hasShinyVariant` some da resposta. A rota `GET
  /store-pokemon-options/pokemon/:wikiPageId/shiny` foi **apagada** — código
  morto, já que não há mais toggle pra resolver uma contraparte shiny; o
  frontend agora manda direto o `pokemonCatalogItemId` (linha base ou shiny)
  que o usuário escolheu na lista unificada. Motivo: o catálogo já carrega
  linhas shiny independentes, não havia necessidade de indireção.
- **Derivação de gênero ganhou fallback pra linha base**: ver bloco do
  helper de gênero acima — 23 linhas `pokemon-shiny` (oriundas do merge de
  Cherish Ball) não têm `infoboxFields`; o helper agora tenta a linha
  `pokemon` base via `extractedFields.sourceWikiPageId` antes de cair no
  default, que também mudou de `['sem_genero']` pra `['macho', 'femea']`
  (permissivo — não bloquear o formulário por falta de dado de origem).
- **Addons ganharam `looktypeImageUrl`/`looktypeShinyImageUrl`** — ver
  bloco do endpoint de addons acima pro shape exato e a distinção
  match-estruturado vs. fallback-regex (sempre `null` nesse último).
- **Novo endpoint `GET
  /store-pokemon-options/pokemon/:wikiPageId/extra-moves-cap`**: lê
  `data/wiki-crawl/index.json` (mapa reverso `pageid → file` construído uma
  vez, cacheado em `Map` de módulo — dado estático local, nunca muda em
  runtime) pra achar a página wiki correspondente ao `wikiPageId`, lê o
  `wikitext` de `data/wiki-crawl/pages/<file>`, extrai a seção
  `/==\s*Moveset Padrão\s*==([\s\S]*?)\n==/i` e conta
  `(secao.match(/-move-otp\.png/g) || []).length` como `naturalMoveCount`.
  Resposta: `{ naturalMoveCount, maxExtraMoves: Math.max(0, 10 -
  Math.min(naturalMoveCount, 8)) }`. Resultado cacheado em `Map` de módulo
  por `wikiPageId` (mesma justificativa de dado estático). Fallback
  (`wikiPageId` sem página real na wiki — ex: linha sintética de
  Cherish-Ball/evento, seção "Moveset Padrão" ausente, ou qualquer falha de
  parse): `{ naturalMoveCount: null, maxExtraMoves: 10 }` — permissivo, não
  bloqueia o formulário quando falta dado de origem.
  **Confirmado contra dado real**: Bulbasaur (10985) → 5/5, Charizard
  (10990) → 8/2, Milotic (1753) → 8/2 (batendo os 3 já checados na sessão de
  planejamento), mais Barboach (11269) → 5/5 e Bastiodon (11368) → 8/2 —
  ampliando a confiança além dos 3 originais. `wikiPageId` sintético (ex:
  `1000015940`, Shiny Rotom Fan) → fallback correto (`null`/`10`).
  **Limitação de dado documentada, não é bug**: a tabela wikitext "Moveset
  Padrão" é um template de grade fixa de **8 slots**. Confirmado nesta
  sessão: ~48% das espécies têm os 8 slots preenchidos, o que significa que
  o movepool real pode exceder 8 pra essas espécies — o cap computado vira
  um **piso conservador**, não necessariamente o número exato que a regra de
  domínio original (10 slots totais, "natural + extra") pretende. Aceito
  como lacuna do dado de origem (a wiki não expõe o movepool completo em
  lugar algum estruturado que este pipeline já leia), não corrigido — não
  havia forma de saber o movepool real além do que a tabela mostra sem uma
  fonte de dado nova.
- **`POST /stores/me/pokemon` — mudanças no contrato**:
  - `addonCount` (número livre) → `addonCatalogItemIds: number[]`
    (opcional). Na criação, vira `StorePokemonAddon: { create:
    addonCatalogItemIds.map(id => ({ addonCatalogItemId: id })) }` — mesmo
    padrão de `create` aninhado já usado por `StorePokemonSticker`.
    `StorePokemonAddon` (schema já existia, zero consumidores antes) agora
    tem consumidor real. `addonCount` continua existindo como campo
    denormalizado (`addonCatalogItemIds?.length ?? null`) — conveniência
    pra não precisar de `join` só pra mostrar "Addons: N" em algum preview
    futuro, não é uma segunda fonte de verdade.
  - **Validação nova**: `equippedAddonCatalogItemId`, se enviado, precisa
    estar em `addonCatalogItemIds` — `400 { error: 'O addon equipado
    precisa estar entre os addons selecionados.' }` senão (o frontend já
    aplica essa regra, mas o backend não pode confiar só nele).
  - **Validação nova pra `boost`**: só rejeita negativo (`< 0` → `400`).
    **Decisão confirmada com o usuário**: sem teto máximo por enquanto.
  - **`extraMovesText` (texto livre) → `extraMoveCount` (número) como
    entrada primária**: `400` se negativo, e `400` se exceder o
    `maxExtraMoves` real do `pokemonCatalogItemId` enviado — recomputado no
    servidor com a mesma lógica do endpoint de cap acima (nunca confia num
    cap vindo do cliente). `extraMovesText` continua existindo, mas agora é
    **derivado**: `extraMoveCount > 0 ? '+' + extraMoveCount : null` — o
    padrão de dois campos (numérico pra lógica/validação, texto pronto pra
    exibição) já usado no resto da feature.
  - **`presetSlotsText` (texto livre) → `presetSlotCount` (número) como
    entrada primária**, mesmo padrão de dois campos: `400` se fora de `[0,
    3]`; `presetSlotsText` derivado como `presetSlotCount > 0 ?
    String(presetSlotCount) : null`.
- **Verificado (revisão 2026-07-14)**: `node -c` nos 2 arquivos alterados;
  backend reiniciado, `GET /health` limpo logo depois. Endpoint de cap
  testado com 5 espécies reais (acima) + `wikiPageId` inválido (`400`
  limpo) + sintético (fallback correto). `GET /pokemon` sem restrição
  confirmado devolvendo linhas `pokemon-shiny` (`Shiny Abomasnow`, `Shiny
  Abra`, etc., sem `hasShinyVariant` no shape) e `GET
  /pokemon/:id/shiny` confirmado removido (`404` de rota inexistente, não
  mais um handler). Addon `Hollow Pinsir` (tem `addonCompatibilities`)
  confirmado devolvendo `looktypeImageUrl`/`looktypeShinyImageUrl` reais;
  `Pinsir - Hollow Addon` (fallback regex, sem `addonCompatibilities`)
  confirmado devolvendo ambos `null`. Validações de `POST
  /stores/me/pokemon` (`boost < 0`, `extraMoveCount` acima do cap real de
  Bulbasaur, `equippedAddonCatalogItemId` fora de `addonCatalogItemIds`,
  `presetSlotCount` fora de `[0,3]`) confirmadas retornando `400` limpo —
  testado invocando a função handler da rota diretamente com um
  `req.currentUser`/`Store` reais do banco (mesma limitação de sempre: sem
  Firebase real não dá pra forjar o `idToken` e passar pelo `requireAuth`
  via HTTP; essa é a mesma técnica já usada nesta sessão do projeto pra
  validar lógica de slug/contato sem token real). O caso de sucesso
  (`extraMoveCount` dentro do cap) foi confirmado chegando até `201` com
  `StorePokemonAddon`/`StorePokemonSticker` incluídos na resposta — a linha
  de teste foi apagada depois, não ficou lixo no banco. Processo do backend
  seguiu de pé (`GET /health` `200`) durante e depois de todos os testes,
  inclusive depois de um erro transitório real de conexão Neon
  (`PrismaClientUnknownRequestError: Response from the Engine was empty`)
  capturado pelo `asyncHandler` sem derrubar o processo — reforça
  (não é regressão) a mitigação já documentada em "Rodando localmente".
  **Não verificado**: o fluxo feliz completo via HTTP autenticado de ponta a
  ponta (mesma limitação de sempre, sem Firebase real).
- **Cruzando pra `frontend/**` — não feito aqui**: esta revisão só tocou
  `src/routes/storePokemonOptions.js` e `src/routes/stores.js` (escopo do
  plano aprovado). A seção "Anunciar Pokémon — frontend" logo abaixo
  documenta o consumo do contrato **antigo** (toggle de Shiny,
  `addonCount`, `extraMovesText`/`presetSlotsText` como entrada primária) —
  ficou desatualizada em relação ao contrato novo descrito aqui. Atualizar
  o frontend pra consumir o contrato novo (lista unificada sem toggle,
  `addonCatalogItemIds`, `extraMoveCount`/`presetSlotCount`, endpoint de
  cap) é trabalho do papel Interface, fora do meu domínio — sinalizado
  aqui pra não ser confundido com trabalho já feito.

## Criação de anúncio de Item (2026-07-14)

Backend do formulário "criar anúncio de Item" (`POST /stores/me/items` +
rota de apoio de catálogo `GET /store-item-options/:wikiPageId/template`),
paralelo à feature de anúncio de Pokémon documentada acima. Plano de domínio
(regra de prioridade do template, os 3 campos novos de `StoreItem`) já
aprovado antes desta implementação, com toda a pesquisa de domínio
confirmada contra banco/wiki-crawl reais — documentado aqui só o que foi
efetivamente construído e o que a verificação confirmou.

- **Schema**: 3 campos novos em `StoreItem` (aditivo, `npx prisma db push`):
  `serialNumber String?`, `acquiredAt String?` (texto livre, mesmo espírito
  de `StorePokemon.capturedAt`), `originWorld GameWorld?` (nullable mesmo
  sendo um enum real — só é preenchido em anúncios de template `legendary`).
  `StoreItem.quantity` (`Int @default(1)`) já existia e foi reaproveitado
  diretamente pro template `stackable` — nenhum campo novo precisou ser
  criado pra isso.

- **Resolução de template — `resolveItemTemplate(item)`, em
  `src/routes/storeItemOptions.js`, exportada e reusada por `POST
  /stores/me/items`** (nunca confiar num template mandado pelo cliente —
  mesmo princípio de "recomputar no servidor" já usado pro cap de
  `extraMoveCount` do formulário de Pokémon). Resolvido só a partir de
  metadado do `CatalogItem` (`category`/`extractedFields`), nunca por
  nome/aparência do item, nesta ordem de prioridade:
  1. `extractedFields.classificationReason === 'legendary_item_index_table'`
     → `legendary`. **Confirmado contra o banco real: só 13 linhas** têm essa
     flag hoje — lacuna de dado conhecida e documentada (alguns itens
     literalmente chamados "Legendary X" não têm a flag; ex: "Legendary
     Grandfather Statue" tem `classificationReason:
     'collectible_coverage_gap_sync'` em vez disso). **Não compensar isso com
     matching de nome** numa sessão futura — a flag vale como está, a lacuna
     é um gap de cobertura de dado, não um bug de lógica.
  2. `category === 'backpacks'` → `backpack`. Lê
     `extractedFields.backpackSlotCapacity` — **confirmado: presente em
     78/142 linhas, ausente no resto** — retorna `null` quando ausente,
     nunca um valor chutado. **Não existe campo de peso ("weight"/"peso")
     em nenhuma linha de `backpacks`** (confirmado) — o shape de resposta
     não inclui esse campo de propósito, não é uma omissão.
  3. `category === 'addons'` → `addon`. Lê
     `extractedFields.addonCompatibilities` (array de `{ pokemonWikiTitle,
     ... }`, mesmo campo já consumido por `GET
     /store-pokemon-options/addons`) e devolve só a lista de
     `pokemonWikiTitle`.
  4. `category === 'materials'` → `stackable`. **Aproximação documentada,
     não um flag real** — não existe nenhum campo genuíno de "isso é
     empilhável" no catálogo; `category === 'materials'` é só o melhor proxy
     disponível com dado real hoje. Não tratar como sinônimo perfeito de
     "todo item empilhável é `materials`" nem o inverso.
  5. Nenhuma das anteriores → `default` (sem campos extras).

- **`GET /store-item-options/:wikiPageId/template`** (pública, `GET`,
  `asyncHandler`, sem `requireAuth` — mesmo padrão de
  `storePokemonOptions.js`, leitura de catálogo sem nada user-specific): 404
  se o `wikiPageId` não existir no catálogo; senão devolve
  `{ template, slots, compatiblePokemon }` — `slots` só tem sentido em
  `template: "backpack"` (`null` nos demais), `compatiblePokemon` só tem
  sentido em `template: "addon"` (array vazio nos demais).

- **`POST /stores/me/items`** (em `src/routes/stores.js`, mesmo padrão
  exato de `POST /me/pokemon`: `requireAuth` + `asyncHandler`, opera sobre a
  `Store` do `req.currentUser`, `404` se ainda não tiver loja). Único campo
  obrigatório: `catalogItemId` (precisa resolver pra um `CatalogItem` real,
  `400` senão). Opcionais, sem exigência cruzada de template — **"não
  sobre-validar" por instrução explícita do plano**: `serialNumber`,
  `acquiredAt`, `originWorld` presentes num item não-`legendary` (ou
  `quantity` num item não-`stackable`) não são rejeitados, só não são
  exigidos fora do seu template associado:
  - `originWorld`: se informado, precisa ser um dos 7 valores do enum
    `GameWorld` (`BLUE/GREEN/RED/BLACK/PURPLE/SILVER/GOLD`) — `400` com a
    lista de valores válidos se não bater.
  - `quantity`: default `1` (mesmo default do schema); se informado, precisa
    ser inteiro `>= 1`.
  - Preço: mesma regra já estabelecida em `POST /me/pokemon` —
    `priceReal`/`priceHd` são independentes (pode ter só um, o outro, ou os
    dois) mas **pelo menos um é obrigatório**, e cada um precisa ser
    positivo (`> 0`, não apenas não-negativo) se informado — `400` com a
    mesma forma de mensagem do fluxo de Pokémon.
  - Retorna `201` com a linha `StoreItem` criada.

- **Verificado**: `node -c` nos 3 arquivos alterados/criados
  (`prisma/schema.prisma` via `npx prisma db push` bem-sucedido,
  `src/routes/storeItemOptions.js`, `src/routes/stores.js`, `src/index.js`);
  backend reiniciado (matou um processo antigo que já estava rodando na
  porta 3000 desde antes desta tarefa — `EADDRINUSE` confirmado o motivo),
  `GET /health` limpo depois. `GET
  /store-item-options/:wikiPageId/template` testado contra 5 linhas reais
  do banco, uma pra cada template: `1315064970` (Pink Essence of Space,
  `classificationReason: legendary_item_index_table`) → `legendary`;
  `1612370120` (Shiny Porygon backpack, `backpackSlotCapacity: 24`) →
  `backpack` com `slots: 24`; `1247407610` (Lily Backpack, sem
  `backpackSlotCapacity`) → `backpack` com `slots: null` (confirma o "nunca
  chutar"); `2078347799` (Snorlax The Grey Addon) → `addon` com
  `compatiblePokemon: ["Snorlax"]`; `1531639053` (Trace Of Darkness,
  `materials`) → `stackable`; `1190611203` (Ultra Ball, `pokeballs`, sem
  mapeamento) → `default`, confirmando o fallthrough. `wikiPageId`
  inexistente mas dentro da faixa de `Int` → `404` limpo; fora da faixa de
  `Int` (overflow de 32 bits) → erro do Prisma capturado pelo `asyncHandler`
  global (`503`, mesma rede de segurança documentada em "Rodando
  localmente"), processo confirmado de pé depois (`GET /health` `200`).
  `POST /stores/me/items` sem header `Authorization` → `401` limpo; com
  Bearer sintaticamente válido mas falso pro Firebase → `401` limpo,
  processo de pé depois. Validações de corpo (preço vazio, `originWorld`
  inválido, `priceReal` negativo, `catalogItemId` ausente/inexistente)
  testadas invocando os handlers da rota diretamente com um `req.currentUser`/
  `Store` temporários criados no banco real e um `admin.auth().verifyIdToken`
  monkey-patchado no processo do script de teste isolado (nunca no processo
  do servidor real) — mesma limitação de sempre (sem Firebase real não dá
  pra forjar um `idToken` via HTTP), mesma técnica já usada nesta sessão pra
  validar lógica de slug/contato/cap de movimentos sem token real. Todas as
  4 validações confirmadas devolvendo `400` com a mensagem esperada; o
  caminho de sucesso confirmado chegando a `201` tanto pro template
  `legendary` (com `serialNumber`/`acquiredAt`/`originWorld` preenchidos)
  quanto pro `stackable` (com `quantity: 5`) — as 2 linhas de teste e o
  `User`/`Store` temporários foram apagados depois, confirmado sem sobra no
  banco. **Não verificado**: o fluxo feliz completo via HTTP autenticado de
  ponta a ponta (mesma limitação de sempre, sem Firebase real).

- **Lacunas de dado conhecidas, carregadas do plano — não são bugs pra
  "corrigir" numa sessão futura com matching de nome**:
  1. Cobertura incompleta da flag `legendary_item_index_table` (só 13
     linhas, itens genuinamente "Legendary X" fora dessas 13 caem em
     `default` ou em qualquer outro template que sua `category` real
     resolva).
  2. Ausência total de campo de peso/"weight" em `backpacks` — não existe
     no catálogo, o shape de `template: "backpack"` não tenta inventar um.

**Revisão de UX (2026-07-14, mesmo dia)**: Número de Série/Data/Mundo de
Origem deixaram de depender do template `legendary` resolvido pelo
catálogo — ficam **sempre disponíveis e opcionais**, em qualquer item,
independente do `template` retornado por `GET /store-item-options/:id/
template`. Motivo explícito do usuário: dado o gap 1 acima (só 13 linhas
tagueadas), esconder esses campos atrás do sinal incompleto impediria o
vendedor de registrar um item genuinamente legendary que o catálogo ainda
não sabe que é — o vendedor sabe pelo próprio jogo, mesmo quando o
catálogo não sabe. Único campo obrigatório além de Item continua sendo
Preço (pelo menos um dos dois). `Slots`/`Pode ser usado em`/`Quantidade`
**continuam** condicionados ao template resolvido (`backpack`/`addon`/
`stackable` respectivamente) — são dado real do catálogo pra aquele tipo
específico, não sofrem do mesmo problema de cobertura incompleta que
`legendary` tem. Mudança só em `frontend/src/pages/AddItemListing.jsx` e
`frontend/src/domain/buildItemLookText.js` — o backend (`POST
/stores/me/items`) já aceitava esses 3 campos sem exigir um template
específico, não precisou de nenhuma mudança.

**Bug real encontrado e corrigido no mesmo dia**: o seletor de item de
`AddItemListing.jsx` buscava em `GET /catalog-items` sem nenhuma restrição
de categoria — deixava aparecer linhas de `pokemon`/`pokemon-shiny`/
`cherish-ball-pokemon` (Pokémon não são itens, têm o próprio fluxo de
anúncio) **e** de `daily-boss-access` (não são itens físicos — são
registros de janela de acesso a boss, com nomes tipo frase inteira, ex: "A
primeira aparição é após derrotar 200x o Mega Rayquaza", "A Sacred Flame" —
mesma categoria já sinalizada como decisão de modelagem em aberto na seção
"Estado atual do catálogo"). Corrigido adicionando um param genérico
`excludeCategories` (lista separada por vírgula) em `GET /catalog-items`
(`src/routes/catalogItems.js`) — mutuamente exclusivo com `category`, já
que nenhum consumidor precisa dos dois ao mesmo tempo hoje. O frontend
(`AddItemListing.jsx`) passa `excludeCategories=pokemon,pokemon-shiny,
cherish-ball-pokemon,daily-boss-access` — a lista de "o que não é item de
verdade" fica centralizada como conhecimento de catálogo (o backend decide
o que é filtrado), não uma regra duplicada só no frontend. Verificado
contra o banco real: busca por "Rayquaza" sem o filtro traz a linha de
`daily-boss-access` e a de `pokemon`; com o filtro, só as 2 linhas reais de
`backpacks` sobram.

## Anunciar Pokémon — frontend (2026-07-14)

Metade de frontend do fluxo de criação de anúncio de Pokémon, consumindo os
endpoints de `src/routes/storePokemonOptions.js` e `POST /stores/me/pokemon`
documentados na seção anterior. Rota nova: `/:slug/anuncios/pokemon/novo`
(`frontend/src/App.jsx`, registrada **antes** do catch-all `/:slug` — mesmo
raciocínio já documentado para `/configurar-loja`/`/configuracoes`).

- **Componentes genéricos novos, sem conhecimento de Pokémon** (pensados pra
  uma futura tela "Adicionar Item" reusar sem alteração):
  `frontend/src/components/FabSpeedDial.jsx` (FAB fixo + speed-dial, ações
  vêm de um array de config do chamador), `NewListingPageShell.jsx` (chrome
  de página com wordmark + duas colunas — conteúdo principal e slot de
  preview — a partir de `min-width: 860px`, o breakpoint já usado no
  projeto), `Autocomplete.jsx` (busca com debounce + dropdown, usado em 5
  pickers desta tela: Pokébola, Pokémon, Held Item, Mega Stone, Addon) e
  `LookPreviewCard.jsx` (card de preview de texto, só renderiza `text`/
  `lines`, não decide nada). `frontend/src/hooks/useDebounced.js` foi
  promovido a partir do que antes era só uma função inline duplicada em
  `Catalog.jsx` (`DataMap.jsx`, ao contrário do que se assumia antes desta
  sessão, nunca teve essa duplicação — não usa busca — então só
  `Catalog.jsx` foi migrado pra importar do hook).
- **Lógica específica de Pokémon fica isolada** em
  `frontend/src/domain/buildPokemonLookText.js` — função pura
  `buildPokemonLookText(state)` que monta o texto de preview ("Você vê uma
  X com um Y.\n\nNível: ...") a partir de valores já resolvidos (nomes, não
  ids). **A ordem das linhas do preview é deliberadamente diferente da
  ordem de preenchimento do formulário** (Nature aparece logo após Gênero no
  formulário, mas só depois de BOOST no preview) — confirmado
  explicitamente, não "consertar" essa aparente inconsistência. Também
  exporta `GENDER_LABELS` (mapa fixo `macho`/`femea`/`sem_genero` → label,
  não é dado de catálogo) e `toSealName()` (`Capsule` → `Seal` via regex,
  aplicado só na seleção de stickers desta tela — **nunca** no
  `GET /catalog-items` genérico usado por `Catalog.jsx`, que continua
  mostrando o nome real "Capsule").
- **`frontend/src/pages/AddPokemonListing.jsx`**: os 16 campos, na ordem de
  preenchimento do plano (não a ordem do preview — ver acima). Regras de
  limpeza reativa via `useEffect` chaveado no campo pai (mesmo padrão de
  fetch já usado no projeto, sem inventar um segundo): trocar Pokébola limpa
  Pokémon/Shiny/Usando/Mega Stone; trocar Pokémon limpa Shiny/Gênero/Usando/
  Mega Stone e refaz as buscas de compatibilidade de addon/mega-stone pra
  nova espécie. O campo Shiny é só um toggle de UI — nunca é enviado como
  booleano; quando ligado, resolve `GET
  /store-pokemon-options/pokemon/:wikiPageId/shiny` pra saber o
  `wikiPageId` real a submeter como `pokemonCatalogItemId`. Campos "Usando"
  e "Mega Stone" só renderizam se a busca de compatibilidade
  (`/store-pokemon-options/addons`/`/mega-stones`) devolver algo não-vazio
  pra espécie atual — nunca um `if` fixo por espécie. Reverifica dono da
  loja no mount (mesmo padrão `onAuthStateChanged` → `getMyStore` → compara
  slug já usado em `StoreProfile.jsx`/`StoreSettings.jsx`) — não confia que
  chegar pela URL implica ser dono.
- **`frontend/src/pages/StoreProfile.jsx`**: monta `FabSpeedDial` dentro do
  mesmo bloco `{isOwner && (...)}` que já existia pro menu hambúrguer
  (reaproveita o `isOwner` já computado, nenhuma checagem de auth nova). Ação
  "Adicionar Pokémon" navega pra `/${slug}/anuncios/pokemon/novo`; "Adicionar
  Item" aparece desabilitada com badge "em breve" (sem handler) — próxima
  feature, ainda não implementada.
- **`frontend/src/api.js`**: `getPokemonOptions`, `getShinyVariant`,
  `getMegaStonesFor`, `getAddonsFor`, `createStorePokemon` — os 3 primeiros
  GETs reaproveitam o helper `request`/`buildQuery` já existente (mesmo
  padrão de `getCatalogItems`); `getShinyVariant`/`createStorePokemon` usam o
  padrão manual de fetch com `.status` anexado no throw (mesmo de
  `createStore`/`updateStore`), já que ambos têm um caso de erro
  (404/400/401/409) que a tela precisa distinguir. Pokébola/Held Item/
  Sticker reusam `getCatalogItems` direto (`category=pokeballs|held-items|
  sticker-balls`), sem função nova.
- **`frontend/src/AddPokemonListing.css`** (novo arquivo, não misturado em
  `Landing.css`): mobile-first de verdade — base sem `@media`, only
  `@media (min-width: 860px)` habilita o layout de duas colunas. Reusa as
  variáveis `--ps-blue`/`--ps-yellow`/`--ps-ink`/`--ps-bg` de `Landing.css`.
  **Armadilha de CSS encontrada e corrigida durante a verificação**: a regra
  de label (baseada visualmente em `.landing-auth-form label`, que usa
  `opacity: 0.85` pro texto meio-apagado) originalmente usava `opacity: 0.9`
  no próprio `<label>` inteiro — isso cria um novo *stacking context* nesse
  elemento (qualquer `opacity < 1` faz isso), o que prende o `z-index` do
  dropdown do `Autocomplete` dentro do stacking context do seu próprio
  `<label>` pai. Resultado: o `<label>` **seguinte** no formulário (com seu
  próprio stacking context, mais tarde na ordem do DOM) pintava por cima do
  dropdown inteiro, não importa o `z-index` do dropdown — confirmado via
  Playwright (`elementFromPoint` apontando pro label seguinte, não pro botão
  de opção) antes de identificar a causa. Corrigido trocando `opacity` por
  `color: rgba(26, 31, 61, 0.9)` no `<label>` — mesmo efeito visual, sem
  criar stacking context. Se copiar o padrão `opacity` de `Landing.css` de
  novo em qualquer lugar que tenha um dropdown/popover como filho, watch out
  para essa armadilha.
- **Verificado com Playwright** (Chrome real via
  `executablePath: '/usr/bin/google-chrome'`, contra os dois dev servers
  rodando local): FAB visível/funcional em `StoreProfile.jsx` (forçando
  `isOwner = true` temporariamente, revertido antes de terminar — confirmado
  via grep que não sobrou nenhum código de debug), speed-dial abre com
  "Adicionar Item" desabilitado/com badge, "Adicionar Pokémon" navega pra
  rota nova. Na tela nova (mesma técnica de bypass temporário, revertida):
  escolher pokébola que não é "Cherish Ball" deixa o campo Pokémon
  irrestrito; espécie sem shiny (`Aggron`, confirmado via
  `GET /store-pokemon-options/pokemon`) deixa o toggle Shiny desabilitado;
  espécie sem mega stone (`Aggron`) esconde o campo Mega Stone por completo;
  espécie com shiny + mega stone + addon (`Pinsir`, cruzado contra
  `GET /catalog-items?category=mega-stones` e `GET
  /store-pokemon-options/addons`) libera os três; preview mínimo (só os 5
  campos obrigatórios) bate exatamente com o formato do exemplo do plano;
  preview completo (todos os 16 campos preenchidos, incluindo toggle Shiny e
  2 stickers) reproduz a ordem de linha exata do exemplo completo do plano,
  inclusive `Stickers: Acid Seal, Bubble Ball Seal` (nome já transformado de
  "Capsule" pra "Seal"). Layout de duas colunas confirmado em viewport
  1280px. `npm run build` e `npm run lint` (`oxlint`) limpos (só os
  warnings pré-existentes de `useFetch.js`/`StoreSettings.jsx`, não
  relacionados a esta mudança). **Não verificado**: o fluxo feliz completo
  de submissão (`POST /stores/me/pokemon` criando uma linha de verdade) —
  mesma limitação de sempre neste projeto, precisa de um usuário logado via
  Firebase de verdade para obter um idToken válido.

## Listagens da loja: status (ACTIVE/HIDDEN/SOLD) e edição (2026-07-14)

Metade de backend do redesign de "vitrine unificada" (editar/apagar/ocultar/
marcar-como-vendido um anúncio já criado). Segue exatamente o padrão já
estabelecido em `POST /stores/me/items`/`POST /stores/me/pokemon` — plano de
domínio já aprovado antes desta implementação, documentado aqui só o que foi
efetivamente construído.

- **Schema (`prisma/schema.prisma`)**: enum novo `StoreListingStatus`
  (`ACTIVE`/`HIDDEN`/`SOLD`), campo `status StoreListingStatus @default(ACTIVE)`
  adicionado tanto em `StoreItem` quanto em `StorePokemon` (aditiva, regra 4
  de `ARCHITECTURE_RULES.md`). Aplicado com `npx prisma db push` (mesmo fluxo
  já usado neste projeto — sem pasta de migrations) e confirmado limpo,
  Prisma Client regenerado.
- **`GET /stores/:slug` corrigido (`src/index.js`)**: essa rota nunca incluía
  a relação `CatalogItem` aninhada — gap já documentado nesta mesma seção do
  CLAUDE.md logo depois que a feature de anúncio de Pokémon subiu (o
  frontend nunca conseguia mostrar nome/foto real de item ou Pokémon, só o
  `catalogItemId`/`pokemonCatalogItemId` cru). Corrigido em duas passadas no
  mesmo dia:
  1. Primeira passada: só a relação principal (`StoreItem.CatalogItem`,
     `StorePokemon.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem`)
     — suficiente só pro card de vitrine (nome+foto).
  2. **Revisão (mesmo dia, decisão explícita do usuário)**: essa rota deve
     ser uma representação **completa** de cada anúncio, não o mínimo pro
     card — porque o formulário de edição ("Editar") consome exatamente
     esse mesmo payload pra se pré-preencher, em vez de existir uma segunda
     rota só pra edição. Estendido o `include` de `StorePokemon` pra trazer
     também: `CatalogItem_StorePokemon_pokeballCatalogItemIdToCatalogItem`,
     `CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem`,
     `CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem`,
     `CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem`, e os
     dois joins completos com `CatalogItem` aninhado:
     `StorePokemonAddon: { include: { CatalogItem: true } }`,
     `StorePokemonSticker: { include: { CatalogItem: true } }` — esses dois
     joins (que já existiam no schema, zero consumidor até então) ganharam
     aqui seu primeiro consumidor real de leitura. Também adicionado
     `orderBy: { createdAt: 'desc' }` em ambos `StoreItem`/`StorePokemon`
     (a ordem dos cards na vitrine é definida pelo backend, não inventada
     pelo frontend). Todos os nomes de relação confirmados lendo o schema
     antes de escrever, não adivinhados. Verificado contra a loja real
     `teste` (1 `StoreItem`, 4 `StorePokemon`): resposta agora traz
     Pokébola/Held Item/Mega Stone/Addon equipado como objetos
     `CatalogItem` completos, e os arrays de Addons/Stickers selecionados
     com `CatalogItem` aninhado em cada entrada.
- **Decisão deliberada: sem filtro de status nessa rota** — `GET
  /stores/:slug` continua totalmente pública/sem autenticação e devolve
  anúncios de qualquer status (`ACTIVE`/`HIDDEN`/`SOLD`) pra qualquer
  chamador. Essa rota não tem conceito de "quem está perguntando" (não passa
  por `requireAuth`), então não há como decidir ali "esconder de visitante,
  mostrar pro dono" sem inventar uma noção de identidade que essa rota nunca
  teve. A responsabilidade de decidir o que exibir pro visitante vs. pro dono
  é do frontend (fora deste domínio) — na prática, o dado de um anúncio
  oculto/vendido continua tecnicamente obtível inspecionando a resposta de
  rede, só fica suprimido na UI. Simplificação deliberada, não um
  descuido — se um requisito futuro precisar esconder de verdade (não só na
  UI), isso exige uma revisão de arquitetura (rota autenticada opcional, ou
  uma segunda rota "visão do dono" separada da pública).
- **4 rotas novas em `src/routes/stores.js`**, todas `requireAuth` +
  `asyncHandler`, seguindo o mesmo padrão de checagem de posse já usado no
  restante do arquivo — busca a `Store` do chamador (`findUnique` por
  `userId`), busca a linha pelo `:id`, e só prossegue se a linha existir **e**
  pertencer a essa `Store`; se qualquer uma das duas condições falhar
  (linha não existe, OU existe mas é de outra loja), devolve **o mesmo**
  `404` genérico — nunca vaza pra outra loja que aquele id existe através de
  um código de status diferente. `id` de path malformado (não-inteiro) também
  cai no mesmo `404` (nunca gera erro 500/503 por tentar consultar o Prisma
  com um valor inválido).
  - **`PATCH /stores/me/items/:id`**: mesmo corpo opcional de
    `POST /me/items` (`serialNumber`, `acquiredAt`, `originWorld`,
    `quantity`, `notes`, `priceReal`, `priceHd`) + `status` (400 se não for
    `ACTIVE`/`HIDDEN`/`SOLD`). `catalogItemId` **não** é aceito no corpo —
    lido da linha existente, imutável após a criação. Diferente de
    `POST /me/items`, o PATCH **não** exige "pelo menos um preço" — só
    valida presença-e-positividade de qual campo de preço estiver de fato
    no corpo desta requisição específica (uma requisição só com
    `{ status: 'HIDDEN' }` não é rejeitada por falta de preço). Um
    `priceReal`/`priceHd` explicitamente vazio/nulo no corpo limpa aquele
    preço.
  - **`DELETE /stores/me/items/:id`**: mesma checagem de posse, delete real,
    `204` sem corpo.
  - **`PATCH /stores/me/pokemon/:id`**: mesmo corpo opcional de
    `POST /me/pokemon` (todos os 16 campos, incluindo espécie/pokébola — ao
    contrário de Items, aqui o conjunto completo é editável, por decisão do
    plano aprovado) + `status`. Reaplica as mesmas validações de
    `POST /me/pokemon` só pros campos presentes no corpo: addon equipado
    precisa estar no conjunto de addons selecionado (usa o conjunto já salvo
    no banco se `addonCatalogItemIds` não vier no corpo desta requisição);
    `boost` não pode ser negativo; `extraMoveCount` recomputa o teto via
    `computeExtraMovesCap` usando a espécie efetiva (a nova, se
    `pokemonCatalogItemId` vier no corpo, senão a já salva);
    `presetSlotCount` entre 0 e 3. Mesma regra de preço "só valida o que foi
    tocado" do PATCH de Items acima. `addonCatalogItemIds`/
    `stickerCatalogItemIds`, quando presentes, substituem o conjunto
    completo (`deleteMany: {}` + `create` dentro do mesmo `update` aninhado)
    em vez de tentar diff/merge — comportamento mais simples e correto pra
    uma edição de formulário completo, por decisão do plano. `updatedAt`
    sempre atualizado.
  - **`DELETE /stores/me/pokemon/:id`**: mesma checagem de posse, delete
    real, `204`; `StorePokemonAddon`/`StorePokemonSticker` cascateiam
    automaticamente via `onDelete: Cascade` já existente no schema.
- **Verificado**: `node -c` nos arquivos alterados; `npx prisma db push`
  aplicado limpo, Prisma Client regenerado; backend reiniciado, `GET
  /health` limpo antes/depois de todos os testes abaixo. `GET
  /stores/:slug` contra lojas reais (`shop`, `teste`) confirmado trazendo
  `CatalogItem`/relação de Pokémon aninhada com nome/imagem reais. As 4
  rotas novas: sem header `Authorization` → `401` limpo nas 4; Bearer
  sintaticamente válido mas falso → `401` limpo nas 4, processo seguiu de pé
  (`GET /health` `200` logo depois). Lógica de posse e validação exercida
  contra linhas reais do banco (mesma técnica já usada nesta sessão pra
  rotas protegidas sem token Firebase real — `User`/`Store`/`StoreItem`/
  `StorePokemon` temporários, `verifyIdToken` monkey-patched, nunca tocando
  o processo do servidor ao vivo; script isolado, todas as linhas
  removidas ao final, confirmado sem resíduo). **Nota de implementação da
  técnica de monkey-patch**: reatribuir `admin.auth = fn` diretamente é um
  no-op silencioso — `firebase-admin` expõe `auth` como accessor não
  configurável herdado do protótipo do SDK
  (`Object.getOwnPropertyDescriptor(admin, 'auth')` retorna `undefined`, e
  `admin.auth = fn` não muda o que `admin.auth()` retorna depois). O que
  funciona é sobrescrever o método `verifyIdToken` na instância `Auth` já
  inicializada (`admin.auth()` sempre retorna o mesmo singleton) —
  `admin.auth().verifyIdToken = async (...) => {...}`. Registrado aqui pra
  sessão futura que precisar da mesma técnica não repetir a mesma tentativa
  que falha silenciosamente. 17/17 checagens automatizadas passaram: PATCH
  de item só com `status` sucede sem exigir preço; `status` inválido → `400`
  nos dois tipos; PATCH/DELETE de item e de Pokémon contra loja de outro
  dono → `404` nos dois; `catalogItemId` no corpo do PATCH de item é
  ignorado (linha mantém o `catalogItemId` original); `priceReal: 0` → `400`;
  addon equipado fora do conjunto selecionado → `400`; `extraMoveCount`
  negativo → `400`; DELETE remove a linha de verdade do banco (confirmado
  via `findUnique` pós-delete) nos dois tipos; id inexistente e id malformado
  (`not-a-number`) → `404` nos dois, sem derrubar o processo. Nenhum resíduo
  de teste ficou no banco (confirmado por busca pós-limpeza pelos emails/
  slugs de teste). **Não verificado**: o fluxo feliz completo de qualquer
  uma das 4 rotas via HTTP autenticado de ponta a ponta com um usuário
  Firebase real (mesma limitação de sempre neste projeto — sem um idToken
  real pra forjar a sessão pelo caminho normal do frontend); a interface que
  vai consumir essas rotas (ocultar/marcar-vendido/editar/apagar na vitrine)
  não foi construída nesta mudança — é trabalho do domínio de frontend.

## Importar/Exportar Anúncios via texto "look" do jogo (2026-07-15)

Feature **100% frontend** (papel Interface) — nenhuma rota nova, nenhuma
mudança de schema. Deixa o dono da loja colar um ou vários textos de "look"
(inspecionar) copiados do jogo — exatamente o mesmo formato que
`buildPokemonLookText.js`/`buildItemLookText.js` já produzem pro preview do
formulário manual — e a plataforma interpreta cada um, casa os nomes com o
catálogo via os endpoints `GET` já existentes, e cria os anúncios em lote
depois de uma revisão obrigatória. "Exportar" é a operação inversa: gera de
volta esses mesmos textos a partir dos anúncios `ACTIVE` já cadastrados.

**Arquivos novos**:
- `frontend/src/domain/parseLookText.js` — parsing puro, sem rede.
  `splitLookBlocks(rawText)` separa múltiplos textos colados/concatenados em
  blocos, usando toda linha que começa com `"Você vê "` como marcador de
  início de bloco (a única linha que o próprio jogo sempre gera nesse
  formato — nem descrição livre de item nem nenhum label começa assim).
  `parseLookBlock(block)` tenta o regex de Pokémon primeiro (tem `" com "`,
  mais específico), depois o de Item; nenhum dos dois bate → `{ kind:
  'unparseable', rawText }`, mostrado como erro bruto na revisão, nunca
  adivinhado. Linhas `Label: valor` reconhecidas viram campos brutos via
  reversão dos mapas `GENDER_LABELS`/`GAME_WORLD_LABELS` já exportados por
  `buildPokemonLookText.js`/`buildItemLookText.js` (importados e invertidos
  via `invertLabelMap`, nunca duplicados) e um `fromSealName` (`Seal`→
  `Capsule`, ao lado do já existente `toSealName` inverso). Para blocos de
  Item, `Slots`/`Pode ser usado em` são reconhecidas e **descartadas**
  (informativas, derivadas do catálogo, não fazem parte do payload de
  criação); qualquer outra linha não reconhecida (com ou sem label) é
  acumulada em `notes` — nunca descartada silenciosamente. Para blocos de
  Pokémon (que não têm campo `notes` aceito por `POST /stores/me/pokemon`),
  linhas não reconhecidas viram `unrecognizedLines`, mostradas na revisão
  como aviso informativo.
- `frontend/src/domain/resolveImportDraft.js` — resolução assíncrona
  nome→`CatalogItem`, reaproveitando só endpoints que os formulários manuais
  já chamam (`api.getCatalogItems`, `api.getPokemonOptions`,
  `api.getMegaStonesFor`, `api.getAddonsFor`) — nenhuma rota nova. Regra de
  match: igualdade exata case-insensitive contra `.name`; exatamente 1
  resultado → `{ status: 'resolved', item, candidates }`; 0 ou 2+ → `{
  status: 'needs-review', item: null, candidates }` — nunca um palpite
  fuzzy. Ordem de resolução do Pokémon replica a cadeia reativa do
  formulário manual: pokébola primeiro (decide `restrictToCherishBall`),
  depois Pokémon (cujo `wikiTitle` libera mega-stone/addon compat), depois
  held item/mega stone/addon equipado/stickers. Importa
  `ITEM_PICKER_EXCLUDED_CATEGORIES` de `frontend/src/domain/gameConstants.js`
  (não duplica a lista de exclusão já usada em `AddItemListing.jsx`).
- `frontend/src/domain/buildExportText.js` — `buildStoreExportText(store)`,
  sibling de `buildPokemonCardDetails`/`buildItemCardDetails` de
  `StoreListingCard.jsx` (mesmas linhas/relações aninhadas de `GET
  /stores/:slug`, já carregadas por `StoreProfile.jsx` — zero fetch próprio),
  mas alimentando `buildPokemonLookText`/`buildItemLookText` em vez de pills
  de exibição. Filtra só `status === 'ACTIVE'` (decisão confirmada — não
  recriar "fantasmas" ocultos/vendidos ao reimportar). Simplificação
  deliberada: não busca `GET /store-item-options/:id/template` por item
  (evitaria N round-trips só pra exportar) — usa um `template` sintético
  (`quantity > 1 ? 'stackable' : 'default'`) só pra acionar a linha
  "Quantidade" já existente em `buildItemLookText`, sem implicar que o
  template real foi checado. Blocos juntados em ordem `createdAt desc`
  (mesma ordem que `StoreProfile.jsx` já exibe), separados por linha em
  branco dupla.
- `frontend/src/domain/gameConstants.js` — `NATURES`/`GAME_WORLDS`/
  `ITEM_PICKER_EXCLUDED_CATEGORIES` centralizados aqui (antes viviam soltos
  dentro de `AddPokemonListing.jsx`/`AddItemListing.jsx`) — motivo duplo:
  evita duplicar essas 3 listas fixas uma terceira vez em
  `ImportListings.jsx`/`resolveImportDraft.js`, e evita o warning
  `react(only-export-components)` do oxlint que vinha de exportar constantes
  não-componente de um arquivo de página. `AddPokemonListing.jsx`/
  `AddItemListing.jsx` foram atualizados pra importar dali em vez de
  declarar localmente — mudança puramente de organização, nenhum valor
  mudou.
- `frontend/src/pages/ImportListings.jsx` — rota `/:slug/anuncios/importar`.
  Mesmo padrão de página cheia via `navigate()` das demais telas de
  criação, reverifica dono da loja no mount (`onAuthStateChanged`→
  `getMyStore`→compara slug). Fluxo: `<textarea>` + botão "Analisar" →
  `parseLookText` + `resolveImportDraft` em paralelo por bloco → um
  "rascunho" por bloco, cada um com seus campos resolvidos/`needs-review`.
  Campo resolvido mostra texto + link "trocar" (revela `Autocomplete`); campo
  `needs-review`/vazio mostra o `Autocomplete` direto, com os candidatos da
  busca original oferecidos como chips de sugestão de um clique (forma
  escolhida de "pré-popular" sem precisar modificar `Autocomplete.jsx`, que
  não tem prop pra texto de busca inicial). Preview ao vivo via
  `LookPreviewCard` reaproveitado (não um componente novo), chamando
  `buildPokemonLookText`/`buildItemLookText` com os valores atuais —
  embutido dentro do próprio card do rascunho (não numa coluna lateral
  separada — com N rascunhos, uma coluna de previews sticky empilhados
  ficaria estranha; `NewListingPageShell` é usado sem `previewSlot`, single
  column sempre). Preço (Real/HD, ao menos um obrigatório) — ver "Atualização
  2026-07-15 (preço no export/import)" logo abaixo pra como isso passou a
  funcionar; nem sempre fica em branco. Botão "Confirmar e
  Criar" por rascunho **e** "Confirmar todos os prontos" em lote — cada
  confirmação é uma chamada isolada a `createStorePokemon`/`createStoreItem`
  (idênticas às dos formulários manuais, mesmo payload), nunca em transação
  — falha de um rascunho não desfaz os já criados (mesmo princípio já
  registrado neste arquivo pros loops de sync do backend). Bloco
  `unparseable` mostra o texto bruto com aviso, fora da lista confirmável.
  Aviso informativo quando `Addons: N > 1` no texto mas só o equipado foi
  identificado (nunca inventa os outros N-1).

**Arquivos modificados**:
- `frontend/src/App.jsx` — rota `/:slug/anuncios/importar`, registrada antes
  do catch-all `/:slug` (mesma convenção das demais rotas de anúncio).
- `frontend/src/pages/StoreProfile.jsx` — 2 itens novos no
  `landing-store-menu-dropdown` (mesmo menu hambúrguer dono-only de
  "Configurações"/"Desconectar"): "Importar Anúncios" (navega pra rota
  acima) e "Exportar Anúncios" (handler inline, sem navegação — chama
  `buildStoreExportText(store)` com o `store` já em state, baixa
  `<slug>-anuncios.txt` via `Blob`+`<a download>` e copia pra área de
  transferência via `navigator.clipboard.writeText`, com fallback silencioso
  se a permissão de clipboard for negada).
- `frontend/src/pages/AddPokemonListing.jsx`/`AddItemListing.jsx` — `NATURES`/
  `GAME_WORLDS`/`ITEM_PICKER_EXCLUDED_CATEGORIES` passaram a vir de
  `gameConstants.js` (ver acima) em vez de declaradas localmente.

**Limitações conhecidas (deliberadas, aprovadas no plano — não são gaps pra
"corrigir" numa sessão futura com esperteza)**:
- Addons não-equipados de um Pokémon nunca são recuperáveis a partir do
  texto de look (o formato só grava `Addons: N` e `Usando: <equipado>`,
  nunca a identidade dos outros N-1) — perda de informação permanente do
  formato de texto, não um bug.
- Resolução de nome é só por igualdade exata (case-insensitive) contra
  `CatalogItem.name` — nunca fuzzy/aproximada; ambíguo ou não encontrado
  sempre vira revisão manual, nunca um palpite.
- Export omite `Slots`/`Pode ser usado em` dos itens (informativo, também
  ignorado na importação) — não é perda de dado necessário pra reimportar.
- Export só inclui `status: ACTIVE` — reimportar não tenta recriar
  ocultos/vendidos.
- Importação nunca faz upsert/dedup contra anúncios já existentes — cada
  confirmação sempre cria uma linha nova (mesmo comportamento de colar o
  mesmo texto duas vezes manualmente no formulário manual).

**Verificado**: `npm run build`/`npm run lint` limpos (só os warnings
pré-existentes de `useFetch.js`/`StoreSettings.jsx`, não relacionados).
`parseLookText.js` testado isoladamente (fora da UI, via bundle esbuild)
contra os textos reais de Pokémon/Item construídos com `buildPokemonLookText`/
`buildItemLookText` — round-trip parse→build reproduziu exatamente os
mesmos campos usados pra gerar o texto original, incluindo `Slots`/`Pode ser
usado em` corretamente descartados (não viram `notes`) e `Quantidade`
capturada só quando presente; testado também um bloco "esquisito" (começa
com `"Você vê "` mas não bate em nenhum dos dois regex) → `unparseable`
corretamente isolado dentro de uma colagem com blocos válidos antes/depois.
Testado contra dado real do catálogo (Pinsir/Great Ball/Air Balloon/
Pinsirite/Hollow Addon/Acid Capsule): resolução automática correta em todos
os campos preenchidos; um nome propositalmente errado ("Air Baloon", faltando
um "l") resolveu corretamente pra `needs-review` com `candidates: []` (sem
match parcial no índice de busca do backend).

Playwright (Chrome real via `executablePath: '/usr/bin/google-chrome'`,
contra os dois dev servers rodando local) contra a loja real `teste`, usando
a mesma técnica de bypass temporário de dono já documentada em sessões
anteriores (forçar `isOwner`/pular a checagem de Firebase em
`StoreProfile.jsx`/`ImportListings.jsx`, revertido antes de terminar,
confirmado por `grep` sem sobra): colar 3 looks (1 Pokémon simples, 1
Pokémon complexo com held item **propositalmente errado** "Air Baloon" pra
forçar `needs-review`, mais held item/mega stone/addon equipado/sticker
corretos, 1 Item) → pokébola/Pokémon/mega stone/addon equipado/sticker
resolvidos automaticamente nos dois rascunhos de Pokémon, Held Item
corretamente sinalizado `needs-review` com a mensagem `Não encontramos
exatamente "Air Baloon" no catálogo — escolha manualmente.` e um
`Autocomplete` aberto; buscar "Air Ball" nesse campo devolveu exatamente
`["Air Balloon"]` como sugestão, clicar resolveu o campo (confirmado
`resolved-value` mudando de ausente pra "Air Balloon"); preview ao vivo
refletiu corretamente o estado parcial (omitindo `Held item:` até o campo
resolver, incluindo todo o resto). Clicar "Confirmar e Criar" com um preço
preenchido falhou com `"Sua sessão expirou. Volte e entre de novo."` — 
esperado e correto (sem credenciais Firebase reais neste ambiente pra
forjar um `idToken` válido, mesma limitação de sempre já documentada em
todas as features de criação deste projeto — a submissão de fato não foi
verificada via HTTP autenticado de ponta a ponta pela mesma razão).

Export/import round-trip verificado de ponta a ponta contra a loja real
`teste` (temporariamente com 2 `StorePokemon`+1 `StoreItem` de teste criados
direto via Prisma pra ampliar a cobertura do teste — apagados ao final,
confirmado por `findUnique` pós-delete que a loja voltou ao estado original
de 1 item/4 pokémon): menu hambúrguer mostrou os 2 itens novos
("Importar Anúncios", "Exportar Anúncios"); clicar "Exportar Anúncios"
baixou `teste-anuncios.txt` com texto batendo exatamente com
`buildStoreExportText(store)` chamado direto contra o `GET /stores/:slug`
real, e o conteúdo da área de transferência bateu com o arquivo baixado.
Colar esse texto exportado de volta em `/teste/anuncios/importar` produziu
8 rascunhos (2 itens + 6 pokémon, todas as linhas reais da loja) com **0
avisos de `needs-review`** — every campo que tinha nome no texto resolveu
automaticamente; os `Autocomplete` abertos restantes (8, confirmado via
`.autocomplete-input`) eram exclusivamente campos opcionais que o texto
original simplesmente não mencionava (ex: Held Item/Mega Stone quando a
linha de origem não tinha essas linhas) — não falhas de resolução,
confirmado batendo com a contagem esperada de campos opcionais vazios por
linha.

**Atualização 2026-07-15 (preço no export/import)**: pedido do usuário —
"esse export precisa puxar o look e o valor de cada item e pokemon". Até
aqui `buildStoreExportText` só exportava o texto de look puro (sem preço) e
`ImportListings.jsx` sempre deixava Preço Real/HD em branco pra preencher na
revisão. Adicionadas duas linhas **só no formato de export**, nunca no
formato de look real do jogo (`buildPokemonLookText.js`/`buildItemLookText.js`
continuam intocados/puros — ainda usados pelo preview ao vivo do formulário
manual, que precisa continuar batendo exatamente com o que o jogo gera):
`Preço Real: R$ <valor>` / `Preço HD: <valor> HD`, cada uma só aparecendo
quando aquele preço está definido. Adicionadas em `buildExportText.js`
(`buildPriceLines`, chamada depois de `buildPokemonLookText`/
`buildItemLookText`, nunca dentro delas) logo após o texto de look de cada
bloco (Pokémon e Item).
`parseLookText.js` ganhou os labels `Preço Real`/`Preço HD` em
`POKEMON_LABEL_FIELDS`/`ITEM_LABEL_FIELDS`, com `parsePriceRealRaw`/
`parsePriceHdRaw` revertendo o prefixo `R$ `/sufixo ` HD` fixos (sem parsing
de separador de milhar/locale — nunca necessário, já que `buildExportText.js`
é o único lugar que escreve essas linhas e nunca usa um). `resolveImportDraft.js`
repassa `priceReal`/`priceHd` já como string pronta (não precisa resolução
assíncrona, são só números). `ImportListings.jsx` inicializa o estado
`priceReal`/`priceHd` de cada rascunho a partir de `draft.fields.priceReal`/
`priceHd` (em vez de sempre `''`) — só vem preenchido quando o texto colado
já era um export desta própria plataforma; um look colado direto do jogo
continua sem essas linhas e cai no comportamento de sempre (campo em branco,
preenchido na revisão). Texto de dica do preço atualizado nos dois cards de
rascunho (Pokémon e Item) pra refletir isso.
Verificado: `npm run build`/`npm run lint` limpos. Round-trip testado via
Playwright contra o dev server real (import dinâmico dos módulos reais pela
página, não um bundle à parte): `buildPokemonLookText`+preço R$12.5/5 HD →
`parseLookText` devolveu `priceReal: "12.5"`, `priceHd: "5"` exatos; um bloco
de Item só com HD (`3 HD`, sem Preço Real) devolveu `priceReal: ""`,
`priceHd: "3"` corretamente, com a linha de `notes` (`"Um item raro."`)
intocada mesmo com a linha de preço logo depois dela no texto.

**Atualização 2026-07-15 (timestamp no início do look real + janelas em vez
de lista empilhada)**: dois problemas reportados pelo usuário colando um look
real do jogo (`"18:45 Você vê uma Dive Ball com um Shiny Gardevoir."` — o
look de verdade, copiado do chat do jogo, vem com a hora antes de `"Você
vê"`, diferente do texto sintético usado nos testes até aqui).

1. **Timestamp quebrava a detecção de início de bloco**: `splitLookBlocks`
   só reconhecia uma linha como início de bloco se ela começasse
   literalmente com `"Você vê "` — uma linha `"18:45 Você vê..."` não batia,
   então o bloco inteiro era descartado (a lógica só empilha linhas depois
   de já ter visto um início de bloco). Corrigido em
   `frontend/src/domain/parseLookText.js`: nova constante
   `TIMESTAMP_PREFIX_RE = /^\d{1,2}:\d{2}(?::\d{2})?\s+/` e
   `stripTimestampPrefix(line)`, aplicada a **toda** linha (não só a
   primeira) antes de qualquer checagem/match — defensivo contra um log de
   chat que carimbe hora em mais de uma linha, embora o exemplo real só
   tivesse na primeira. `buildExportText.js` continua sem gerar timestamp
   (nosso próprio formato de export nunca teve isso) — a mudança é só do
   lado do parser, puramente aditiva. Verificado via Playwright (import
   dinâmico dos módulos reais pelo dev server) contra o texto real
   exatamente como o usuário colou: parseou corretamente
   `pokeballName: "Dive Ball"`, `pokemonName: "Shiny Gardevoir"`, e todos os
   demais campos, sem nenhuma linha perdida.
2. **Vários rascunhos empilhados verticalmente → janelas alternáveis**: a
   pedido explícito do usuário ("não coloete varios formularios um abaixo do
   outro, cria janelas aonde pode ser alternado entre elas"). `ImportListings.jsx`
   ganhou `activeDraftIndex` (state, resetado pra `0` a cada novo
   "Analisar") e uma barra de abas (`import-listing-tabbar`, com botões
   `‹`/`›` pra navegar sequencialmente) logo acima da área de rascunhos — só
   o rascunho da aba ativa é renderizado por vez (`drafts[activeDraftIndex]`),
   nunca a lista inteira. Cada aba mostra um selo de status calculado por
   `draftTabStatus`/`draftNeedsReview` (novas funções no mesmo arquivo): `✅`
   quando já criado, `⚠️` quando `unparseable`/erro de submissão, `●` quando
   algum campo do rascunho ainda está `needs-review` — dá pra ver de relance
   quais janelas ainda precisam de atenção sem abrir cada uma. "Confirmar
   todos os prontos" continua operando sobre todos os rascunhos
   independente de qual aba está visível (não muda de aba sozinho ao
   confirmar em lote — comportamento aceito, não pedido o contrário). CSS
   novo em `AddPokemonListing.css` (`.import-listing-tab*`, mobile-first —
   `.import-listing-tabs` rola horizontalmente em vez de quebrar linha em
   telas estreitas, mantendo os botões `‹`/`›` sempre visíveis mesmo com
   muitas abas).
   Verificado via Playwright (viewport 500px, loja `teste`, bypass temporário
   de dono revertido ao final e confirmado por `grep`): colar 2 looks (1
   Pokémon com o timestamp real do achado 1 acima + 1 Item) → 2 abas
   (`"Pokémon 1 ●"`, `"Item 2"`), só 1 `.import-listing-draft-card` visível
   por vez confirmado nos dois momentos (antes e depois de trocar de aba);
   clicar na aba 2 trocou o card visível de `"Pokémon — rascunho 1"` pra
   `"Item — rascunho 2"` corretamente, com o campo `Item *` já resolvido
   (`Fire Stone`) aparecendo.
`npm run build`/`npm run lint` limpos depois de ambas as correções.

**Atualização 2026-07-15 (concorrência limitada no "Analisar" — travava com
colagens grandes)**: reportado pelo usuário — "o processo de analise demora
muito, até com pequena quantidade, se vier um paste de 600 looks
provavelmente o site vai travar". Causa raiz real: `handleAnalyze` resolvia
**todos** os blocos de uma vez via um único `Promise.all` sobre o array
inteiro — cada bloco de Pokémon já dispara vários requests
(pokébola/pokémon/mega-stone+addon compat/held item/stickers), então colar
poucas dezenas de looks já disparava uma centena de requisições
simultâneas, e uma colagem de 600 dispararia milhares de uma vez só —
estoura o limite de conexões simultâneas por host do navegador (a maioria
enfileira o resto), trava a aba, e bombardeia o pool de conexão do
Neon/backend de uma vez. Havia ainda um segundo `Promise.all` idêntico
(fetch do cap de Extra Moves por Pokémon), dobrando o problema.
Corrigido com um pool de concorrência limitada, novo
`frontend/src/domain/asyncPool.js` (`mapWithConcurrency(items, concurrency,
fn)` — mantém só `concurrency` chamadas de `fn` em voo por vez, ordem dos
resultados preservada mesmo assim). `ImportListings.jsx` usa isso nas duas
passadas de `handleAnalyze` (resolução dos blocos + cap de Extra Moves) com
`ANALYZE_CONCURRENCY = 5` — mesmo trabalho total, mas nunca mais que 5
blocos em resolução ao mesmo tempo, cada um com sua cadeia interna de poucas
chamadas sequenciais/paralelas já existente (não mudada). Também adicionado
feedback de progresso: state `analyzeProgress: { done, total }`, atualizado
a cada bloco resolvido, exibido no próprio botão ("Analisando... (12/600)")
— sem isso, mesmo com o pool bem mais rápido, uma colagem grande ainda
pareceria travada por não dar nenhum sinal de vida durante o processamento.
Verificado: `npm run build`/`npm run lint` limpos. Playwright (loja `teste`,
bypass temporário de dono revertido e confirmado por `grep`): 20 blocos
reais alternando Item/Pokémon (`Fire Stone`/`Great Ball com Pinsir`)
resolveram em ~9.7s com o pool de 5, produzindo exatamente 20 abas na ordem
correta (`Item 1, Pokémon 2, Item 3, Pokémon 4, ...` — `mapWithConcurrency`
preserva a ordem de entrada mesmo processando fora de ordem internamente),
confirmando que o pool não quebra a correspondência bloco↔rascunho nem a
ordem de exibição.

**Atualização 2026-07-15 (progresso ficava parado em N/N — "mesmo apos
chegar no limite ele continua analisando")**: bug real na correção acima.
`handleAnalyze` faz **duas** passadas de rede sequenciais — resolução de
nomes, depois (com o resultado da primeira já pronto) o cap de Extra Moves
por Pokémon — mas só existia **um** contador de progresso, compartilhado
pelas duas. Resultado: a barra/texto de progresso chegava em `N/N` ao fim da
1ª passada e **ficava parada nesse valor durante toda a 2ª passada**
(que continuava rodando de verdade, só sem atualizar o texto) — exatamente
a aparência de travado que o usuário reportou, mesmo com a concorrência já
limitada.
Corrigido com um state novo, `analyzePhase` (`'resolving' | 'caps' | null`):
cada passada agora reseta `analyzeProgress` pro seu próprio `{ done: 0,
total }` no início (a 2ª passada usa `resolved.length`, que é sempre igual a
`parsedBlocks.length` — `mapWithConcurrency` preserva o tamanho do array).
Texto do botão passou a refletir a fase (`"Resolvendo nomes... (N/M)"` →
`"Calculando limites de moves... (N/M)"`) em vez de um texto genérico único
— o usuário agora vê claramente que uma segunda etapa começou, não apenas
"o número parou de mudar". A 2ª passada também passou a contar/atualizar o
progresso pra **todo** item do array (inclusive os que não fazem chamada de
rede real — rascunhos de Item, ou Pokémon ainda não resolvido — que só
incrementam o contador na hora, sem esperar nada), não só os que de fato
chamam `getExtraMovesCap`, pra o contador da 2ª fase também bater com o
total certo.
Verificado via Playwright (mesma técnica de bypass temporário, revertida e
confirmada por `grep`): 6 blocos de Pokémon reais → sequência de textos do
botão capturada incluindo `"Resolvendo nomes... (5/6)"` seguido de
`"Calculando limites de moves... (5/6)"` — confirma a transição visível
entre as duas fases, sem nenhum trecho em que o texto fique parado enquanto
o processamento real continua. `npm run build`/`npm run lint` limpos.

**Atualização 2026-07-15 (concorrência do "Analisar" reduzida de 5 pra 1 —
pedido explícito do usuário)**: `ANALYZE_CONCURRENCY` em
`frontend/src/pages/ImportListings.jsx` mudou de `5` pra `1` — agora
totalmente sequencial, um bloco resolvido por vez nas duas passadas
(resolução de nomes e cap de Extra Moves). Nada na lógica de
`mapWithConcurrency`/`asyncPool.js` mudou (com `concurrency=1` ela já se
comporta como um loop sequencial simples, sem caso especial); só o valor da
constante. Efeito colateral esperado e aceito: o tempo total de análise
passa a escalar linearmente com o número de looks colados (mais lento que
antes pra colagens grandes), em troca da carga mais branda possível no
backend/Neon. `npm run build`/`npm run lint` limpos.

**Atualização 2026-07-15 (aba aparece assim que aquele rascunho termina, não
só quando o lote inteiro termina)**: pedido explícito do usuário —
"enquanto está finalizando a revisão e edição os outros estão sendo
carregados da mesma maneira". Antes, `handleAnalyze` fazia duas passadas
completas sobre **todos** os blocos (resolver nomes, depois calcular cap de
Extra Moves) e só chamava `setDrafts(...)` **uma vez**, no final — nenhuma
aba aparecia até o lote inteiro (resolução + cap de todo mundo) terminar,
mesmo já com a concorrência limitada das correções anteriores.
Reestruturado pra um pipeline por bloco: cada bloco agora resolve nome(s) **e**
busca seu próprio cap de Extra Moves (quando é Pokémon) como um único passo
atômico, e assim que esse passo termina, `setDrafts` insere aquele rascunho
na posição certa do array (`next[index] = finalDraft`) — a aba dele aparece
imediatamente, enquanto os demais (ainda `null` no array, pré-dimensionado
com `new Array(parsedBlocks.length).fill(null)`) continuam sendo processados
em background pelo mesmo `mapWithConcurrency`/`ANALYZE_CONCURRENCY=1` de
antes. Isso também **eliminou** a necessidade do `analyzePhase`
(`'resolving'`/`'caps'`) introduzido na correção anterior — não existem mais
duas passadas separadas, então não há mais "parece que travou entre uma fase
e outra": o progresso volta a ser um único contador simples (`"Analisando...
(N/M)"`), e agora a evidência mais visível de que está funcionando é a
própria aba aparecendo, não só o texto.
Efeitos colaterais tratados: `drafts` pode conter `null` enquanto a análise
roda — a barra de abas mostra um placeholder tracejado desabilitado
("Rascunho N ⏳") pro que ainda não chegou; o painel principal mostra "Ainda
analisando este rascunho..." se `activeDraftIndex` apontar pra um slot ainda
`null` (só possível se o usuário clicar `›` mais rápido que a resolução);
`confirmAllReady` ganhou uma guarda pra pular slots `null` (antes acessava
`drafts[i].kind` direto, que quebraria com `null` — bug latente introduzido
junto com a barra de abas, nunca antes exercitado porque `drafts` só existia
totalmente preenchido).
Verificado: `npm run build`/`npm run lint` limpos. Playwright (loja `teste`,
bypass temporário revertido e confirmado por `grep`): 5 blocos de Pokémon
reais colados de uma vez → capturada a progressão real da barra de abas ao
longo do tempo: `"Rascunho 1 ⏳ | Rascunho 2 ⏳ | ... "` → `"Pokémon 1 |
Rascunho 2 ⏳ | ..."` → ... → `"Pokémon 1 | Pokémon 2 | Pokémon 3 | Pokémon 4
| Pokémon 5"`, confirmando que cada aba materializa uma de cada vez, na
ordem certa, à medida que sua análise individual termina — nunca esperando
as outras 4.

**Atualização 2026-07-15 (resolução de nome tolerante a acento/espaço —
"não encontrou pokéhouse"/"não encontrou Masterball")**: usuário reportou 2
casos reais de falha de resolução: colar "Pokéhouse" (com acento) nunca
achava o `PokeHouse` do catálogo (sem acento); colar "Masterball" (uma
palavra) nunca achava o `Master Ball` do catálogo (com espaço). Causa raiz:
a busca do backend (`src/routes/catalogItems.js`) é um `ILIKE`/`contains`
literal, case-insensitive mas **não** ignora acento nem espaço — então a
query nem trazia esses candidatos de volta pra comparar (não era só um
problema no filtro de igualdade client-side, a lista de candidatos já vinha
vazia).
Corrigido em `frontend/src/domain/resolveImportDraft.js` — `resolveExactName`
agora: 1) normaliza pra comparação (`normalizeForMatch`: remove acentos via
`normalize('NFD')` + `/[\u0300-\u036f]/g`, minúsculo, remove tudo que não for
alfanumérico — espaço/apóstrofo/hífen inclusive, então `"Master Ball"` e
`"Masterball"` viram a mesma chave); 2) tenta múltiplas variantes de busca
em sequência (`buildSearchVariants`) até achar exatamente 1 match
normalizado: o nome colado como está → o mesmo sem acento (resolve o caso
`PokeHouse`) → um prefixo alfanumérico curto (`PREFIX_FALLBACK_LENGTH = 6`,
heurística documentada no código, não uma regra rígida — resolve o caso
`Masterball`→`Master`, que bate como substring de `Master Ball`). **Ainda
nunca fuzzy/aproximado** — cada variante ainda exige igualdade exata
(pós-normalização) com exatamente 1 candidato; se a normalização fizer 2
nomes reais colidirem, cai em `needs-review` (nunca escolhe errado
silenciosamente) — mesmo princípio de sempre, só a definição de "exato" ficou
mais tolerante. `candidates` acumula (deduplicado por `wikiPageId`) tudo que
qualquer variante trouxe, pra lista de sugestão na revisão ficar melhor
mesmo quando nenhuma variante resolveu sozinha.
Verificado via Playwright (import dinâmico dos módulos reais pelo dev
server, sem UI): `resolvePokemonDraft` com `pokeballName: "Masterball"` →
resolvido pra `"Master Ball"` real do catálogo (`wikiPageId` 1173429123);
`resolveItemDraft` com `itemName: "Pokéhouse"` → resolvido pra `"PokeHouse"`
real (`wikiPageId` 1536947834). `npm run build`/`npm run lint` limpos.

**Investigado, não corrigido — "Bitter Smack Leaf" (planta da loja de cash)
não existe no catálogo**: confirmado por query real que não há nenhuma
linha em `CatalogItem` com esse nome ou algo parecido (`Smack`/`Bitter`/
`Leaf` só batem em itens não relacionados — moves, Leafeon, etc.). Não é bug
de sincronização — o item genuinamente nunca foi capturado, porque a página
de origem provável (`data/wiki-crawl/index.json`'s entrada `"Vip Shop"`)
está marcada `{"missing": true}` — isso é um retorno real da API do
MediaWiki dizendo que **não existe página com esse título exato**, não uma
falha de rede/Cloudflare (que geraria `failed: true`, categoria diferente,
ver `src/wiki-crawler/state.js:recordResult`). Ou seja: o link "Vip Shop"
capturado em algum lugar do crawl aponta pra um título que não existe de
verdade na wiki (provavelmente o nome real da página é outro — case
diferente, "Cash Shop", "Loja VIP", etc.) — sem crawlear a página certa (que
exige saber o título exato e rodar o bookmarklet, mesma limitação de sempre
por causa do bloqueio de Cloudflare) não há wikitext nenhum de onde extrair
nome/imagem/preço reais pra criar a linha — **não inventado**, só
documentado como gap conhecido. Nenhuma outra página já crawleada (`Personal
Shop` é o sistema de loja pessoal do jogador, mecânica diferente da loja de
cash) menciona o item.

## Wordmark "inteligente" + filtros na vitrine da loja (2026-07-15)

Duas features **100% frontend** (papel Interface), independentes entre si,
sem nenhuma mudança de backend — todo dado usado já estava carregado
client-side.

### Wordmark clicável vira atalho pra própria loja quando logado

Antes, todo header tinha um `<Link to="/">` fixo pro wordmark "PokeShopping"
(marketing/landing), duplicado em 8 lugares. Extraído pra
`frontend/src/components/WordmarkLink.jsx` — mesmo idioma
`onAuthStateChanged` + `getMyStore` já usado independentemente em várias
páginas pra checagem de dono (ex: o efeito `isOwner` de
`StoreProfile.jsx`), aplicado aqui a uma preocupação nova: deslogado (ou
logado mas sem loja ainda, ou qualquer falha na checagem) → `/` como antes;
logado **e** com loja → `/${store.slug}` direto (o dono cai na própria
vitrine, não na landing de marketing). `getMyStore` num 404 (sem loja)
devolve `{ store: null }` sem lançar (ver `frontend/src/api.js`), então esse
caso cai no fallback pra `/` corretamente, sem precisar de tratamento
especial.

Substituído em todos os 8 pontos que tinham o wordmark antigo: `SetupShop.jsx`,
as 4 variantes de render de `StoreProfile.jsx` (loading/notfound/error/ready),
`Login.jsx`, as 2 variantes de `StoreSettings.jsx`, e
`NewListingPageShell.jsx` (shell compartilhado por
`AddPokemonListing.jsx`/`AddItemListing.jsx`/`ImportListings.jsx` — corrigir
esse arquivo cobriu as 3 páginas de uma vez, sem tocar em cada uma). Todos
os 8 usavam a mesma marcação/classes (`landing-wordmark landing-wordmark-link`
+ `<span className="landing-pokeball">` + texto), então nenhum precisou de
`className` customizado — o componente usa esse par como default.
**`Landing.jsx` deliberadamente não foi tocado** — o wordmark de lá é um
`<div>` puro, sem `Link`/`to="/"`, porque `Landing.jsx` já **é** `/` (não
tem pra onde "voltar").

### Filtros na lista de anúncios da vitrine (`StoreProfile.jsx`)

Adicionados acima de `.landing-store-listings`, inteiramente client-side —
nenhuma chamada de rede nova, tudo já vem em `store` (de `GET
/stores/:slug`) via `visibleListings` (`isOwner ? allListings :
allListings.filter(status === 'ACTIVE')`, já existente). 4 controles, AND
lógico entre eles, só renderizados quando `visibleListings.length > 0`
(nada pra filtrar numa loja vazia):

1. **Busca** — `frontend/src/domain/buildListingSearchText.js` (função pura
   nova) monta uma string minúscula com **todo** campo descritivo do
   anúncio, não só o nome: pra Item, nome + categoria (via
   `formatCategoryLabel`) + número de série + data + mundo de origem (label)
   + notas/descrição; pra Pokémon, nome + apelido + nature + gênero (label)
   + data de captura + nomes de held item/mega stone/addon equipado +
   nomes de cada sticker/addon selecionado. Substring simples
   case-insensitive, **deliberadamente não accent-folded** — mesmo padrão
   simples já usado no resto do app (a própria busca do backend é um ILIKE
   comum, também não accent-insensitive). Nomes de relação verificados
   contra `StoreListingCard.jsx` (que já lê exatamente esses mesmos campos
   pra `buildPokemonCardDetails`/`buildItemCardDetails`), não adivinhados.
2. **Categoria** (dropdown) — **decisão revertida em 2026-07-15** (ver
   entrada "Correção do filtro de categoria" mais abaixo): originalmente só
   relevante pra Item, escolher uma categoria excluía Pokémon de propósito.
   Isso ficou incorreto no mesmo dia em que o dropdown passou a listar
   **todas** as categorias reais do catálogo (não só as presentes na loja)
   — incluindo `pokemon`/`pokemon-shiny`/`cherish-ball-pokemon`, que
   correspondem exatamente à categoria real de um anúncio de Pokémon.
   Corrigido: `normalizeListings` (`StoreProfile.jsx`) agora resolve
   `category` pro tipo certo de `CatalogItem` conforme o `kind` do anúncio
   (item ou Pokémon), e o filtro compara `listing.category` sem nenhuma
   exceção por tipo — Pokémon respeita o filtro de categoria normalmente
   agora.
3. **Faixa de preço** — min/max aplicados só sobre `listing.priceReal` (a
   moeda Real, sempre a primeira/principal em qualquer outro lugar do app,
   ex: `StoreListingCard.jsx` sempre mostra `R$` antes do `HD`). Label
   explícito "Preço (R$)"/"Preço mín. (R$)"/"Preço máx. (R$)" pra nunca
   ambiguar com HD — o app tem duas moedas independentes que não devem se
   confundir num filtro genérico de "valor". Um anúncio com `priceReal ==
   null` é excluído sempre que **qualquer** um dos dois limites estiver
   ativo (não dá pra comparar faixa contra `null`), mas continua aparecendo
   normalmente quando nenhum limite de preço está setado.
4. **Tipo** (`<select>`: Todos / Somente Itens / Somente Pokémon).
`categoryOptions` e `filteredListings` são derivados a cada render a partir
de `visibleListings` (sem `useMemo` — listas pequenas, tamanho de vitrine de
loja, não de catálogo). Estado novo em `StoreProfile.jsx`: `searchQuery`,
`typeFilter`, `categoryFilter`, `priceMin`, `priceMax`.
**Mensagem de vazio dividida em dois estados, não conflados**: `"Ainda sem
anúncios à venda."` continua exclusiva de `visibleListings.length === 0`
(loja genuinamente sem nada); `"Nenhum anúncio encontrado com esses
filtros."` é nova, mostrada só quando a loja tem anúncios mas os filtros
ativos não retornaram nenhum (`filteredListings.length === 0` com
`visibleListings.length > 0`).

**CSS**: classes novas (`store-listings-filters`,
`store-listings-filter-search`, `store-listings-filter-row`,
`store-listings-filter-field`) em `frontend/src/Landing.css`, logo após a
seção `/* ---------- store profile ---------- */`. Mobile-first (base
empilhada em coluna única, o `.store-listings-filter-row` usa `flex-wrap`
pra acomodar os 4 campos em quantas linhas couberem em telas estreitas, sem
precisar de um `@media` novo — já se resolve sozinho). Chrome de
input/select reaproveitado do padrão visual de
`AddPokemonListing.css`'s `.new-listing-form input/select` (mesmos raios de
borda, cores `--ps-bg`/`--ps-ink`, bordas `rgba(46, 58, 158, ...)`) — sem
inventar um chrome novo de formulário.

**Verificado com Playwright** (Chrome real via
`executablePath: '/usr/bin/google-chrome'`, contra os dois dev servers
rodando local, loja real `teste` — 1 `StoreItem` ["15th Birthday",
categoria `decoracao`, `priceReal: 456`] + 4 `StorePokemon` [duas "Shiny
Gardevoir" com `priceReal` 26 e 452 — a de 452 com apelido "nick" e held
item "Black Belt" —, "Absol" `priceReal: 42`, "Shiny Alolan Exeggutor"
`priceReal: null`], todos `status: ACTIVE`):
- Busca por "Black Belt" (nome do held item, não faz parte do nome exibido
  "Shiny Gardevoir") → sobra exatamente 1 card, o Pokémon certo.
- Filtro de categoria "Decoração" (única categoria de item presente nessa
  loja) → sobra só o item "15th Birthday", os 4 Pokémon desaparecem.
- Faixa de preço 100–500 → sobram "15th Birthday" (456) e a "Shiny
  Gardevoir" de 452; excluídos corretamente Absol (42), a outra Gardevoir
  (26) e o Exeggutor (`priceReal: null`).
- Filtro de tipo "Somente Pokémon" → os 4 Pokémon ficam, o item some;
  "Somente Itens" → só o item fica.
- Wordmark: em `Login.jsx` (deslogado de verdade, sem bypass) o `href`
  resolvido aponta pra `/`. Pra confirmar o branch logado+com-loja sem
  credenciais Firebase reais (mesma limitação de sempre neste projeto), a
  checagem via `onAuthStateChanged`/`getMyStore` dentro de
  `WordmarkLink.jsx` foi temporariamente substituída por um valor fixo
  simulando `/teste`, testado via Playwright em `/configuracoes` (`href`
  resolveu pra `/teste`), e revertida ao código real antes de terminar —
  confirmado por `grep` que não sobrou nenhum código de bypass.
`npm run build`/`npm run lint` (`oxlint`) limpos (só os mesmos warnings
pré-existentes de `useFetch.js`/`StoreSettings.jsx`, não relacionados a esta
mudança). **Não verificado**: o branch logado+com-loja do wordmark via um
usuário Firebase real de ponta a ponta (mesma limitação de sempre neste
projeto).

**Corrigido em 2026-07-15 (vitrine da loja não era mobile-first de
verdade — reportado pelo usuário testando em dimensão de iPhone)**: só o
header ficava correto; o conteúdo (card da loja, filtros, lista de
anúncios) estourava a largura da tela. Diagnosticado com Playwright em
viewport 375×667 (iPhone SE) contra a loja real `teste`: `document.body`
tinha `scrollWidth: 436` contra `innerWidth: 375` — 61px de overflow
horizontal real, não só uma impressão visual. Variando por elemento (via
`getBoundingClientRect`), isolado exatamente às tags `<li
class="store-listing-detail-pill">` de `StoreListingCard.jsx` (os badges
tipo "Categoria: Decoração", "Held item: Black Belt", "Addons: 4 (Usando:
...)")  — a regra `.store-listing-detail-pill` em `AddPokemonListing.css`
tinha `white-space: nowrap`, então um pill com texto longo simplesmente não
tinha pra onde encolher/quebrar e vazava pra fora do card; como um filho com
overflow real (não só clipado visualmente) aumenta o `scrollWidth` de todo
ancestral flex acima dele, isso vazava até o `body`. Corrigido: removido
`white-space: nowrap`, adicionado `max-width: 100%` +
`overflow-wrap: break-word` — um pill longo agora quebra em mais de uma
linha dentro do próprio balão em vez de estourar a largura do card. Nenhuma
mudança em `.store-listings-filters`/`.store-listings-filter-row` (a barra
de filtros nova) — auditado à parte e já estava corretamente mobile-first
(sem elemento nenhum flagueado pelo mesmo script de detecção de overflow).
Verificado: `npm run build`/`npm run lint` limpos; Playwright confirmou
`document.body.scrollWidth` caindo de 436 pra exatamente 375 (igual ao
`innerWidth`, zero overflow) depois da correção, e screenshot em 375×667
mostrando os pills longos (`"Categoria: Decoração"`, `"Held item: Black
Belt"`, `"Addons: 4 (Usando: Bride Saint John Addon)"`) corretamente
quebrando em duas linhas dentro do próprio balão, card inteiro respeitando a
largura da tela.

**Proposto e revertido no mesmo dia (2026-07-15) — padding de
`.landing-store-listings`**: usuário apontou que `.landing-store-card` tem
um override de padding mais enxuto (`1.5rem 1.75rem`) que
`.landing-store-listings` nunca recebeu (fica com o `2.5rem` padrão de
`.landing-auth-card`, pensado pra um cartão de login estreito). Cheguei a
aplicar `padding: 1.5rem 1rem` em `.landing-store-listings` e verificar via
Playwright (largura útil subiu de 192px pra 240px em viewport 320px) — **mas
o usuário pediu pra desfazer só essa mudança específica em seguida**
(mantendo a correção do pill `white-space: nowrap` da entrada acima).
Revertido — `.landing-store-listings` está de volta ao padding padrão de
`.landing-auth-card` (sem override próprio). Registrado aqui pra uma sessão
futura não reaplicar a mesma mudança sem saber que já foi feita e desfeita
por decisão explícita do usuário.

**Auditoria 2026-07-15 (piso mínimo 375×667/320×568 nas 4 telas que exigem
login+loja — `StoreSettings.jsx`, `AddPokemonListing.jsx`,
`AddItemListing.jsx`, `ImportListings.jsx`)**: pedido explícito de suportar
375×667 (iPhone SE) como menor tela. As 4 telas acima nunca tinham sido
auditadas em viewport pequeno porque todas redirecionam (`navigate`) sem
sessão Firebase real/posse de loja confirmada — mesma técnica de bypass
temporário já usada nesta sessão (editar o `useEffect` de mount pra pular a
checagem real e ir direto a `pageStatus: 'ready'` com dado real da loja
`teste`, verificar, reverter por completo e confirmar via `grep` que não
sobrou nenhum vestígio). **Resultado: nenhum bug novo encontrado** — as 4
telas já estavam corretas nos dois viewports. Verificado com Playwright
(Chrome real) em cada uma, checando tanto overflow real
(`document.body.scrollWidth` vs `window.innerWidth`, mais
`getBoundingClientRect().right` de cada elemento contra `window.innerWidth`
— nunca só inspeção visual) quanto captura de tela cheia:
- `StoreSettings.jsx`: formulário completo (7 campos + preview de slug),
  vazio e com erro de campo — limpo nos dois viewports.
- `AddPokemonListing.jsx`: preenchido de ponta a ponta com um exemplo real
  (`Pinsir`/`Dusk Ball`, 2 addons selecionados via `MultiSelectPicker`,
  Mega Stone, Held Item, 2 stickers, sprite preview com aura de Boost,
  preço) e também com o dropdown de addons aberto por cima dos chips já
  selecionados (comportamento normal de overlay, não um bug — os chips
  reaparecem ao fechar o dropdown) — limpo nos dois viewports.
- `AddItemListing.jsx`: preenchido com um item `legendary` real (nome
  "15th Birthday", descrição longa, todos os campos) — limpo nos dois
  viewports.
- `ImportListings.jsx` (a tela mais nova/complexa, focada explicitamente no
  pedido): testado colando 2-3 blocos reais de look text de uma vez
  (Pokémon + Item + um bloco propositalmente não reconhecível) e navegando
  pela barra de abas (`import-listing-tab`/`import-listing-tab-nav`) nos
  três estados — a barra rola horizontalmente dentro de
  `.import-listing-tabs` (`overflow-x: auto`) sem vazar pro `body`, e os
  botões `‹`/`›` continuam clicáveis mesmo com mais abas do que cabem a
  320px. Também testado um caso de `needs-review` de propósito (busca por
  "Ball", que bate em vários itens do catálogo — pokébolas, "Air Balloon",
  addons — e força `status: 'needs-review'` com 5 chips de sugestão) e o
  fluxo de resolver manualmente escolhendo um candidato de nome longo
  ("Balloon of Saint John addon") pra checar
  `.import-listing-resolved-value` (nome + link "trocar") com texto longo —
  quebra em duas linhas dentro do próprio balão, "trocar" nunca sai da
  tela. `.autocomplete-option` (linha de resultado dentro do dropdown,
  distinta do chip) também testada com um nome real longo ("Legendary
  Blastoise Cursed Statue") — quebra em duas linhas dentro da própria
  opção, sem overflow.
- Motivo provável de já estar tudo certo: as 4 telas são construídas quase
  inteiramente sobre os mesmos componentes genéricos já auditados/corrigidos
  quando `AddPokemonListing.jsx` foi originalmente construído em 2026-07-14
  (`NewListingPageShell`, `Autocomplete`, `MultiSelectPicker`,
  `LookPreviewCard`, mais o CSS mobile-first já existente em
  `AddPokemonListing.css`/`Landing.css`) — nenhuma delas introduziu um
  componente ou padrão de layout genuinamente novo que pudesse ter escapado
  daquela auditoria original.
`npm run build`/`npm run lint` (`oxlint`) limpos depois de reverter os 4
bypasses (só os mesmos warnings pré-existentes de `useFetch.js`/
`StoreSettings.jsx`, não relacionados). Confirmado por `grep
-rn "TEMP-MOBILE-AUDIT-BYPASS" frontend/src/` que não sobrou nenhum vestígio
de bypass nos 4 arquivos. **Não verificado**: o fluxo feliz completo de
qualquer uma das 4 telas via Firebase real de ponta a ponta (mesma limitação
de sempre neste projeto).

**Reportado, não reproduzido — FAB "sumindo" em 375x667**: usuário relatou
duas vezes o FAB desaparecendo (uma durante scroll, outra de forma mais
persistente, "impossibilitando adicionar um pokemon"). Testado
exaustivamente em Chromium headless (viewport estático 375×667 e 320×568,
`isMobile`/`hasTouch` simulados, scroll real via `mouse.wheel` em vários
passos pra cima e pra baixo, antes/depois de assentar) — em **todos** os
casos o FAB mede posição correta (`getBoundingClientRect` sempre dentro dos
limites do viewport, `opacity/visibility` sempre `1`/`visible`). Usuário
confirmou que testa via Chrome DevTools em modo de dispositivo móvel — ou
seja, o mesmo motor Chromium usado aqui pra testar, não Safari real — então
a suspeita de quirk específico de WebKit/iOS perde força. Sem conseguir
reproduzir, **nenhuma mudança de posicionamento foi feita além das duas já
aplicadas antes** (`env(safe-area-inset-*)`, `translateZ(0)` +
`will-change: transform` — ver entrada anterior). Pendente: preciso de mais
detalhe (screenshot, ou em que momento exato ele some — ao carregar? só
depois de rolar? só com poucos/muitos anúncios?) antes de arriscar mais
mudanças de CSS às cegas — já houve um ciclo nesta sessão de aplicar/
reverter uma mudança de padding sem confirmação suficiente, não repetir o
mesmo padrão aqui.

**Ajustes visuais pontuais (2026-07-15)**:
- `StoreListingCard.jsx`: botão "Marcar como vendido" → só **"Vendido"**
  (`isSold ? 'Reverter venda' : 'Vendido'`) — pedido explícito do usuário,
  mais compacto. `buildItemCardDetails` não prefixa mais a categoria com
  `"Categoria: "` — o pill mostra só o nome já formatado (`"Decoração"` em
  vez de `"Categoria: Decoração"`), mesmo `formatCategoryLabel` de sempre,
  só sem o label redundante na frente.
- `frontend/src/pages/Landing.jsx`: o CTA grande da hero ("Entrar com
  Google", `.landing-btn-lg`) agora só renderiza quando `!firebaseUser` —
  correto ele sumir se o usuário já está logado (o header já mostra "Ir
  para minha loja" nesse caso, ter os dois botões de auth simultâneos não
  fazia sentido). Reaproveita o mesmo state `firebaseUser` já adicionado
  pra essa página no wordmark "inteligente".
- `.fab-button` — **4 iterações no mesmo dia**, histórico deixado registrado
  porque o design final foi um pedido explícito de reverter as anteriores,
  não uma evolução linear: 1) Poké Ball de verdade (vermelho/branco/faixa
  preta) — usuário achou o círculo central descentralizado; 2) sprite real
  de Plusle (`wikiPageId` 11297) como imagem de fundo — Plusle já tem marca
  de "+" nas bochechas e cauda; 3) alternância cronometrada entre Plusle e
  seu par **Minun** (`wikiPageId` 11296, marca azul de "−"), trocando de
  imagem a cada 1800ms via `setInterval`. **Design final** (pedido explícito,
  substituindo as 3 tentativas anteriores por completo): **sem nenhuma
  imagem/sprite/ilustração** — só a identidade de cor+símbolo de Plusle/Minun,
  em CSS puro, e a troca acontece **somente ao abrir/fechar o menu** (nunca
  mais por tempo). Fechado: círculo vermelho sólido (`#ef4444`) com um "+"
  amarelo grosso de pontas arredondadas; aberto: círculo azul sólido
  (`#3b82f6`) com um "−" amarelo, mesma espessura/cantos. O "+"/"−" não é um
  caractere de texto (impossível controlar espessura/arredondamento de
  fonte com precisão) — são 2 barras CSS (`.fab-button-icon::before`
  horizontal, `::after` vertical, ambas com `border-radius`); a barra
  vertical encolhe (`scaleY(0)`) suavemente quando o menu abre, transformando
  o "+" em "−" só com CSS, sem JS/estado novo (a troca de cor/ícone é
  inteiramente orientada por `aria-expanded`, atributo que `FabSpeedDial.jsx`
  já definia antes por outro motivo — nenhuma prop nova precisou ser
  adicionada ao componente, que voltou a ficar tão simples quanto era antes
  de toda essa sequência de redesigns, e sem nenhum conhecimento de
  domínio/Pokémon). `StoreProfile.jsx` não passa mais nenhuma prop de ícone
  pro `<FabSpeedDial>` — só `actions`, como no início. Verificado via
  Playwright (viewport 375×667, bypass temporário revertido e confirmado
  por `grep`): `background-color` computado confirma vermelho no estado
  fechado e azul no aberto; `getComputedStyle` da pseudo-`::after` confirma
  `scaleY(0)` (matriz `matrix(1,0,0,0,0,0)`) no estado aberto; screenshots
  confirmam visualmente o "+"/"−" grosso e arredondado nas cores certas.

**Filtros da vitrine — ajustes adicionais (2026-07-15, mesmo dia da adição
original)**:
- `frontend/src/domain/formatCategoryLabel.js`: 2 overrides novos —
  `pokemon-shiny` → **"Shiny"**, `cherish-ball-pokemon` → **"Cherishball"**
  (em vez do humanizado literal "Pokemon Shiny"/"Cherish Ball Pokemon") —
  pedido explícito, rótulos mais curtos pro shopper.
- Filtro "Tipo": opções reduzidas de "Todos/Somente Itens/Somente Pokémon"
  pra **"Todos/Pokémon/Itens"** (ordem e texto exatos pedidos, só mantido o
  acento em "Pokémon" por consistência com o resto do app, que sempre grafa
  assim).
- Filtro "Categoria": antes só listava categorias **presentes nos anúncios
  atuais da loja** (`visibleListings`); agora lista **todas as categorias
  reais do catálogo**, buscadas uma vez via `api.getCatalogFilters()`
  (`useFetch`, mesmo endpoint `GET /catalog-items/filters` que
  `Catalog.jsx` já usa pro próprio `<select>` de categoria) — permite
  filtrar em direção a uma categoria que essa loja específica ainda não tem
  nada listado. Ordenado alfabeticamente pelo label formatado (a ordem
  nativa da API é por contagem no catálogo inteiro, não útil pra escanear
  um dropdown de ~19 itens por nome). Confirmado via Playwright: 19
  categorias reais + "Todas as categorias" = 20 opções, incluindo "Shiny"/
  "Cherishball" corretos.
- Filtro de preço: redesenhado de um único par min/max (R$) pra **dois
  pares independentes, Real e HD lado a lado**, cada um com Mín./Máx.
  empilhados verticalmente e compactos (`.store-listings-filter-price-group`/
  `-col`/`-label`, `.store-listings-filter-field-sm` — fonte/padding
  menores que os campos Tipo/Categoria, `Landing.css`). Estado novo
  `priceMinHd`/`priceMaxHd` (os `priceMin`/`priceMax` antigos viraram
  `priceMinReal`/`priceMaxReal`) — a lógica de filtro trata as duas moedas
  como independentes, cada uma só compara contra seu próprio campo
  (`listing.priceReal`/`listing.priceHd`), nunca somadas/comparadas entre
  si. Verificado via Playwright (viewport 375×667): layout lado a lado
  visível e legível, sem overflow.

**Reorganização responsiva da área de filtros (2026-07-15)**: usuário pediu
análise antes de mexer — diagnóstico: `.store-listings-filter-row` era um
único `display:flex; flex-wrap:wrap` com 3 itens soltos (Tipo, Categoria,
`.store-listings-filter-price-group`), cada um com `flex-grow` sem teto e
**nenhum `@media` próprio** — em desktop eles simplesmente esticavam pra
preencher a linha inteira, deixando vazio desequilibrado entre eles. Correção
proposta e aprovada pelo usuário antes de implementar: envolver Tipo+Categoria
e Real+HD em dois wrappers-irmãos (`.store-listings-filter-group`). **Essa
abordagem foi substituída no mesmo dia** por uma mais específica pedida em
seguida — ver "Grade 2×3" logo abaixo; `.store-listings-filter-group` não
existe mais no código.

**Grade 2×3 da área de filtros (2026-07-15, substituindo a versão acima no
mesmo dia)**: usuário pediu um layout mais específico — pesquisa ocupando
2 colunas na linha 1 + Real na coluna 3 linha 1; Tipo/Categoria na linha 2
colunas 1-2 + HD na coluna 3 linha 2. Pediu análise antes de implementar
(mesmo padrão da vez anterior). Diagnóstico: um layout 2D real com célula
que atravessa 2 colunas só é limpo com **CSS Grid** (`grid-template-areas`),
não dá pra fazer bem só com Flexbox aninhado.
**Técnica escolhida pra não duplicar estrutura entre mobile e desktop**:
`.store-listings-filters` continua sendo só um `flex-column` (inalterado)
até `min-width: 860px`; a partir daí ele vira o próprio grid
(`grid-template-areas: "search search real" / "tipo cat hd"`), e os 2
wrappers intermediários que já existiam (`.store-listings-filter-row`,
`.store-listings-filter-price-group`) ganham `display: contents` **só
dentro do media query** — isso os "dissolve" como caixa (sem remover do
DOM), deixando busca/Tipo/Categoria/Real/HD virarem itens diretos do grid,
posicionados por 4 classes-âncora novas (`store-listings-filter-area-
{tipo,categoria,real,hd}`, aplicadas nos elementos que já existiam — a
busca usa a própria `.store-listings-filter-search` já única). O grupo
`.store-listings-filter-group` (Tipo+Categoria) da versão anterior foi
removido — o pareamento agora é só o `grid-template-areas` declarando as
duas na mesma linha, sem precisar de wrapper. Mín./Máx. dentro de Real/HD
passam a ficar lado a lado (`flex-direction: row`) só no desktop — no
mobile continuam empilhados, como já era.
Verificado via Playwright: mobile (375px) sem overflow e visualmente
idêntico a antes (nenhuma regressão); desktop (1280px) — coordenadas reais
de cada peça confirmam a grade exata pedida (busca left=72→right=975 na
linha top=414; Real na mesma linha, col3, left=988→right=1208; Tipo/
Categoria na linha seguinte, top=495, mesmas colunas 1-2 da busca; HD na
mesma linha de Tipo/Categoria, mesma coluna de Real).

**Ajuste de rótulo (mesmo dia, logo em seguida)**: os headers visíveis
"Real (R$)"/"HD" acima de cada coluna de preço foram removidos — a
informação de moeda agora vive como `placeholder` (`"R$"`/`"HD"`) dentro
dos próprios 4 campos Mín./Máx., em vez de uma linha de texto fixa acima
deles (economiza uma linha vertical, "Mín."/"Máx." continuam como label
visível de cada campo, só a moeda virou dica de placeholder).
`.store-listings-filter-price-label` (CSS) removida — não tinha mais
nenhum uso no JSX. Verificado via Playwright/screenshot em 375px e 1280px:
"R$"/"HD" aparecem corretamente como texto de placeholder dentro dos
inputs vazios, no lugar certo, nos dois tamanhos.

**Ajuste fino da grade (mesmo dia, logo em seguida)**: a linha 1 do grid
(busca + Real) tem `align-items: start` compartilhado — como a célula de
Real (label "Mín./Máx." + input, ~68px) é mais alta que o campo de busca
sozinho (~47px), a busca ficava colada no topo da linha, com espaço morto
embaixo. Corrigido com `align-self: center` só em
`.store-listings-filter-search` (não em `align-items` do grid) — centraliza
a busca dentro da altura da linha sem tocar no alinhamento de Real/Tipo/
Categoria/HD, que preservam exatamente o `start` que já tinham (garantindo
que Real e HD continuem com o mesmo espaçamento/posicionamento entre si,
pedido explícito). Verificado via Playwright: centro vertical da busca
(top 424/bottom 471) bate com o centro vertical da célula de Real (top
414/bottom 482, meio em 448) nos dois casos; bounding box de Real/HD
conferida idêntica antes e depois da mudança (mesma largura/altura/
alignItems/gap).

**Correção 2 (mesmo dia, usuário reportou que HD ainda não batia com Real)**:
medição mais profunda revelou a causa raiz de verdade — Real e HD já tinham
CSS **idêntico** entre si (largura 220px, padding, gap, `flex-direction`,
confirmado via `getComputedStyle`); a diferença nunca esteve nelas, estava
na **altura da linha onde cada uma vive**. `gridTemplateRows` medido:
`67.86px / 77.27px`. Linha 1 (Real) tem exatamente a altura da própria Real
— ela é o item mais alto ali (a busca já centralizada é mais curta) — então
preenche a linha sem sobra. Linha 2 (HD) é ditada por Tipo/Categoria
(`.store-listings-filter-field` tamanho normal, label+select maiores),
**mais alta que a própria HD** (que usa os campos `-sm`, menores) — com
`align-items: start` do grid, HD ficava colada no topo da linha 2 sobrando
~9.4px de espaço morto embaixo, isso nunca acontecia com a Real. Mesma
causa raiz da busca (item mais curto que a própria linha, sob alinhamento
compartilhado), só que do lado direito da grade.
Corrigido com `align-self: center` na classe **compartilhada**
`.store-listings-filter-price-col` (não uma regra `-hd` específica) — pra
Real é no-op (já preenche a linha, centralizar dentro do próprio tamanho
não muda nada); pra HD, centraliza dentro da linha 2 mais alta, eliminando
o espaço morto. Verificado via Playwright: HD passou de
`top 495.1→bottom 562.9` (colada no topo, sobra embaixo) para
`top 499.8→bottom 567.6`, com o centro da HD (533.7) batendo exatamente
com o centro da linha 2 (533.7) — mesmo padrão que a Real já tinha em
relação à linha 1.

**Ajuste pontual (mesmo dia)**: `.store-listings-filter-search`'s
`align-self` trocado de `center` pra `end` — pedido explícito. Agora a
busca fica ancorada na base da linha 1 em vez de dividir a sobra igual
acima/abaixo; verificado que o `bottom` da busca bate exatamente com o
`bottom` da linha (mesmo valor que a célula de Real). `.store-listings-filter-price-col`
continua `center` (não foi pedido mudar).

**Reportado, não reproduzido (mesmo dia) — barra de rolagem horizontal em
375×667 "de novo"**: usuário reportou testando via F12/DevTools do Chrome,
preset iPhone SE. Testado exaustivamente com Playwright tentando reproduzir
com a maior fidelidade possível ao que o DevTools do Chrome faz: viewport
375×667 puro, com `isMobile`/`hasTouch`/`deviceScaleFactor: 2` (replicando o
preset real do Chrome), e também o descriptor `devices['iPhone SE']` do
próprio Playwright (que na verdade é 320×568, o iPhone SE de 1ª geração,
não o de 375×667) — em **nenhum** desses `document.body.scrollWidth` bateu
diferente de `window.innerWidth`, tanto na vista pública quanto na de dono
(FAB aberto, filtros preenchidos, scroll até o fim da página, troca do
select de Tipo). Nenhum uso de `100vw` encontrado no CSS (causa clássica de
overflow por barra de rolagem clássica/não-overlay comendo espaço de
layout). Sem conseguir reproduzir, nenhuma mudança de CSS foi feita a mais
— **hipótese mais provável, não confirmada**: cache de uma build antiga no
DevTools (o Chrome às vezes não invalida CSS antigo entre trocas rápidas de
HMR do Vite) — pedir um hard refresh (Ctrl+Shift+R, ou desabilitar cache na
aba Network do DevTools) antes de testar de novo. Se persistir mesmo após
isso, preciso do nome exato da página e do momento (carregamento vs. depois
de alguma interação específica) pra reproduzir de verdade em vez de ficar
tentando variações às cegas.

**Regra reforçada no subagente `frontend` (mesmo dia, pedido explícito)**:
`.claude/agents/frontend.md` — a verificação de 375×667 passou de "ao criar/
tocar uma página" pra **toda vez que qualquer coisa em `frontend/src` for
alterada**, por menor que pareça (um `align-self`, uma linha de CSS) —
inclusive quando a mudança "parece" estar isolada dentro de um
`@media (min-width: ...)` e portanto "não poderia" afetar mobile (esse
racional específico já se provou errado antes neste projeto). Também
reforçado: sempre testar o estado de dono/logado (FAB, filtros, menu
hambúrguer), não só o estado público padrão, usando a técnica de bypass
temporário já documentada (sempre revertida, confirmada por `grep`).

## Card de Pokémon: addon equipado separado + modal de addons (2026-07-15)

Pedido explícito, com análise prévia confirmada antes de mexer no código
(padrão já estabelecido nesta sessão). Duas mudanças:

**Pill de addon separado**: `buildPokemonCardDetails` (`StoreListingCard.jsx`)
gerava um único pill combinado (`"Addons: 4 (Usando: X)"`). Agora só o addon
**equipado** vira pill de texto puro (`"Usando: X"`, só informativo, igual
antes) — a **contagem** de addons virou um **botão** dentro do mesmo
`<ul className="store-listing-details">`, com sua própria classe
(`.store-listing-detail-pill-button`, reseta o chrome padrão de `<button>`
pra continuar parecendo um pill, com hover/focus sinalizando que é
clicável).

**Modal de addons (primeiro desta aplicação)**: clicar no botão abre
`frontend/src/components/Modal.jsx` — componente genérico novo (zero
conhecimento de domínio, mesmo espírito de `FabSpeedDial`/`Autocomplete`/
`LookPreviewCard`: o chamador só passa `title`/`children`, o componente só
cuida de overlay+painel+fechar via Esc/clique fora). Confirmado antes de
criar: **não existia nenhum modal/dialog em todo `frontend/src`** — este é
o primeiro. Visual reaproveita a identidade já estabelecida (painel branco
arredondado, mesma sombra de `.landing-auth-card`), sem inventar um look
novo. Corpo do modal lista cada addon selecionado (`raw.StorePokemonAddon`,
com `CatalogItem` aninhado) num grid reaproveitando `.store-listing-photo`
(a mesma caixa de thumbnail já usada em todo o resto do app) — **zero
consulta nova**: confirmado antes de implementar que `GET /stores/:slug`
(`src/index.js:106`) já inclui `StorePokemonAddon: { include: { CatalogItem:
true } }` desde o redesign da vitrine, os dados (nome + `imageUrl` de cada
addon) já vêm prontos. Só visualização, sem nenhuma ação de editar/remover
addon dentro do modal.
Verificado via Playwright (viewport 500px e 375×667, bypass temporário
revertido e confirmado por `grep`): pills separados corretamente
("Usando: Bride Saint John Addon" e "Addons: 4" como itens distintos);
clicar no botão abre o modal com o título certo ("Addons de Shiny
Gardevoir") e os 4 addons reais (nome + sprite) da loja `teste`; `Escape`
fecha o modal; sem overflow horizontal em 375px com o modal aberto (grid
reflui pra menos colunas).

## Correção do filtro de categoria — Pokémon não respeitava o filtro (2026-07-15)

Pedido explícito de investigação antes de mexer. **Causa raiz confirmada**:
`normalizeListings` (`StoreProfile.jsx`) nunca extraía um campo `category`
normalizado — o predicado do filtro lia a categoria direto de
`listing.raw.CatalogItem?.category`, que só existe pro branch de **Item**,
com uma exceção explícita (`listing.kind !== 'item' || ...`) que sempre
excluía Pokémon. Isso foi uma decisão deliberada e documentada **até o
dropdown de categoria passar a listar todas as categorias reais do
catálogo** (mudança de mais cedo no mesmo dia) — a partir daí, categorias
como `pokemon`/`pokemon-shiny`("Shiny")/`cherish-ball-pokemon`("Cherishball")
passaram a aparecer no dropdown, mas nunca podiam bater com nada (todo
Pokémon era excluído incondicionalmente pelo `kind !== 'item'`), fazendo
essas opções parecerem "quebradas" pro usuário.
Corrigido na raiz, sem tratamento por categoria: `normalizeListings` agora
resolve `category` como campo normalizado pra **qualquer** listing — pro
branch de Item, `raw.CatalogItem?.category` (como já era); pro branch de
Pokémon, `raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem
?.category` (a categoria real do Pokémon subjacente, já carregada, mesmo
include de sempre). O predicado do filtro virou `categoryFilter &&
listing.category !== categoryFilter` — sem exceção de `kind`, sem lógica
por categoria específica, mesmo comportamento pra Item e Pokémon.
Verificado via Playwright contra a loja real `teste` (1 item Decoração + 4
Pokémon, sendo 3 `pokemon-shiny` e 1 `pokemon`): filtrar por "Shiny" retorna
exatamente os 3 Pokémon `pokemon-shiny`; filtrar por "Pokemon" retorna
exatamente o 1 `pokemon` (Absol); filtro de Item (`Decoração` etc.)
continua funcionando exatamente como antes, confirmado sem regressão.

## Sprites de looktype de addon: preview do formulário + modal da vitrine (2026-07-16)

A migração de imagem de looktype de addon documentada em "Wiki crawler"
acima concluiu nesta data (`GET /wiki-images/pending` → `remaining: 0`,
`public/images/` com 5195 arquivos) — isso desbloqueou dois pontos cuja
lógica de exibição já existia mas nunca tinha sido verificada contra dado
real migrado (a maioria das URLs estava como `https://wiki.otponline.com/...`
até então, então o guard `isMigratedImageUrl` sempre caía no fallback).

**Novo módulo compartilhado**: `frontend/src/domain/resolveAddonSprite.js`
— `isMigratedImageUrl`, `isShinyPokemonName` (extraídos de duplicatas locais
que só existiam em `AddPokemonListing.jsx`), `findAddonLooktypeUrl` (busca
crua na `extractedFields.addonCompatibilities` de uma linha de `CatalogItem`
de addon, pelo `pokemonWikiTitle`, mesmo match case-insensitive/trimmed que
`src/routes/storePokemonOptions.js` já faz server-side — sem match ou sem
migração, retorna `null`, sem fallback embutido) e `resolveAddonLooktypeUrl`
(mesma busca, com fallback pro `imageUrl` do próprio addon quando não há
composto).

**Bug real encontrado e corrigido nesta verificação, além de simplesmente
"esperar a migração terminar"**: `AddPokemonListing.jsx`'s
`resolveSpritePreviewUrl` só lia `equippedAddonItem.looktypeImageUrl`/
`.looktypeShinyImageUrl` como campos diretos — shape que só existe na
resposta *achatada* de `GET /store-pokemon-options/addons` (usada quando o
addon é escolhido via Autocomplete, fluxo de criação). No fluxo de
**edição** de um anúncio já existente, o `equippedAddon` é pré-preenchido a
partir da linha crua de `CatalogItem` (`existing
.CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem`, vinda de
`GET /stores/:slug`), que não tem esses campos achatados — só
`extractedFields.addonCompatibilities`. Resultado: editar um anúncio com
addon equipado sempre mostrava o sprite base do Pokémon, nunca o composto
com o addon, independente de a imagem já estar migrada — mesmo gap já
registrado para `genderOptions` no comentário logo abaixo dessa função no
código. Corrigido: `resolveSpritePreviewUrl` agora tenta os campos achatados
primeiro e, se ausentes/não migrados, cai em `findAddonLooktypeUrl` sobre o
shape cru — funciona pras duas formas sem duplicar a lógica de match.
Confirmado via Playwright (bypass temporário de dono já documentado nesta
sessão, revertido e confirmado por `grep`) contra `/teste/anuncios/pokemon/
16/editar` (Shiny Gardevoir com "Bride Saint John Addon" equipado): antes da
correção, sprite de preview = `1000011580.png` (base); depois, =
`2118628492-looktype-0-shiny.png` (composto correto).

**Modal de addons da vitrine** (`StoreListingCard.jsx`, ver seção "Card de
Pokémon: addon equipado separado + modal de addons" acima): antes mostrava
`entry.CatalogItem.imageUrl` (ícone genérico do addon) pra cada addon
selecionado; agora mostra `resolveAddonLooktypeUrl(entry.CatalogItem,
pokemonWikiTitle, isShinyPokemon)` — o Pokémon do anúncio de fato vestindo
aquele addon, quando existe composto migrado pra aquela espécie/shininess;
cai no ícone do addon quando não existe (ex: addon sem entrada de
compatibilidade pra essa espécie, ou variante shiny sem composto próprio na
wiki — confirmado ocorrendo de verdade em 2 dos 4 addons da Shiny Gardevoir
de teste, comportamento correto, não bug). `pokemonWikiTitle`/
`isShinyPokemon` derivados da mesma relação
`CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem` que o resto do
card já lê — zero fetch novo.
Verificado via Playwright contra a loja real `teste`: modal da "Shiny
Gardevoir" (4 addons) mostra 2 composites corretos (`Dark magician girl`,
`Bride Saint John`) e 2 fallbacks corretos pro ícone do addon (`Desert
Flower`, `Christmas Helper` — ambos sem `looktypeShinyImageUrl` pra
Gardevoir na wiki, confirmado via query direta no banco); modal do "Absol"
(4 addons, não-shiny) mostra os 4 como composite `looktype-0-normal`
corretos (Absol é a única espécie compatível de cada um desses 4 addons).
`npm run build`/`npm run lint` limpos nas duas correções.
