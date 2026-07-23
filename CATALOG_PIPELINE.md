# Arquitetura do pipeline do catálogo

Este documento consolida em decisões arquiteturais claras o que uma sequência
de auditorias de código (não suposição, não documentação anterior) confirmou
sobre o pipeline que produz `CatalogItem`. Onde a auditoria anterior só
registrava "achado", este documento registra "decisão".

---

## 1. Estado atual da arquitetura ativa

### Pipeline real de sincronização

```
Wiki (wiki.otponline.com, via bookmarklet — Cloudflare bloqueia acesso direto)
  ↓
data/wiki-crawl/*.json (1897 páginas, wikitext bruto — fonte real hoje)
  ↓
Parser (src/wiki-crawler/parsers/dailyBoss.js e módulos irmãos)
  ↓
Normalização (itemFilter.js: stripLeadingQuantity, isLikelyRewardItem)
  ↓
Classificação (categoryClassifier.js: classifyItemCategory(name) → { category, matchedRule })
  ↓
Persistência (cada sync*.js: findFirst por wikiTitle OU name → update; senão → create)
  ↓
Subcategories (syncSubcategories.js: recalcula extractedFields.subcategories)
  ↓
CatalogItem (estado final, consultado pela API/frontend)
```

### Fluxo de criação de um `CatalogItem`

1. Um script `sync<Sistema>Catalog.js` roda (`npm run <nome>:sync`), lê o
   wikitext relevante de `data/wiki-crawl/`, e produz uma lista de nomes de
   item + fonte (boss, quest, evento etc.).
2. Pra cada nome: `findFirst` busca um `CatalogItem` já existente por
   `wikiTitle` **ou** `name` (case-insensitive) — regra corrigida nesta
   sessão, antes só checava `wikiTitle`.
3. Se achou: atualiza `extractedFields` (adiciona a fonte nova), preserva
   `category` como está. Nunca duplica.
4. Se não achou: `classifyItemCategory(name)` decide a `category` (uma das
   ~39 categorias de tipo, ou `materials` como fallback quando nenhuma regra
   bate — e nesse caso marca `extractedFields.classifierFallback = true`).
   Cria a linha nova.
5. Depois de rodar todos os scripts relevantes, `subcategories:sync` roda
   por último e recalcula `extractedFields.subcategories` a partir das
   chaves de fonte (`dailyBossSources`, `questSources` etc.) presentes em
   cada item.

### Responsabilidade de cada camada

| Camada | Responsabilidade | Não é responsabilidade dela |
|---|---|---|
| Wiki / `data/wiki-crawl/` | Fonte bruta de wikitext | Estruturar dado, decidir tipo |
| Parser | Extrair `{name, file, fonte}` de uma tabela wiki | Decidir categoria, deduplicar |
| Normalização | Remover prefixo de quantidade, filtrar placeholder | Reconhecer variante de nome (Shiny/Legendary) |
| Classificação | Decidir `category` só pra item genuinamente novo | Corrigir item já existente, cobrir pokémon/pokeball/held-item/evolution-item/mega-stone |
| Persistência | Achar-ou-criar, sem duplicar | Validar se a categoria escolhida está certa |
| Subcategories | Recalcular `subcategories` a partir do que já existe | Buscar fonte nova na wiki, remover subcategoria obsoleta em todos os casos |

---

## 2. Componentes legados (schema com dado real, zero consumidor no código atual)

Confirmado por busca exaustiva em `src/`, `frontend/src/` e `scripts/`: nenhuma
das 5 tabelas abaixo é lida ou escrita por qualquer código ativo hoje, apesar
de todas terem dado histórico real (não são schema nunca-usado).

### `WikiPage` (993 linhas)
- **Propósito original** (inferido dos campos `pageId`/`title`/`revisionId`/
  `html`/`wikitext`): armazenar o conteúdo de cada página da wiki direto no
  Postgres, como alternativa ao arquivo JSON.
- **Estado atual**: órfã. O pipeline ativo usa `data/wiki-crawl/*.json`
  (1897 páginas) — um mecanismo de armazenamento diferente e dessincronizado
  (993 ≠ 1897, pipelines diferentes, nunca reconciliados).
- **Motivo de não remoção**: nenhuma justificativa concreta pra alterar
  schema; dado histórico pode ter valor de referência não avaliado.
- **Condição para reativação**: se o projeto decidir migrar o armazenamento
  de wikitext do arquivo JSON pro Postgres (ganho: consulta via SQL em vez de
  ler arquivo; perda: mais uma tabela pra manter sincronizada) — decisão de
  arquitetura explícita, não faça isso incidentalmente.
- **Condição para remoção**: só depois de confirmar que as 993 linhas não têm
  conteúdo que não exista em `data/wiki-crawl/`, e com aprovação explícita
  pra alterar schema.

### `SyncExecution` (2 linhas), `ParserAuditRecord` (70), `CatalogItemLineage` (34), `ReplaySnapshot` (2)
- **Propósito original**: rastreabilidade completa de execução de sync —
  `SyncExecution` registra cada rodada (status, contagem de entidades,
  `qualityScore`, `validationReport`); `ParserAuditRecord` registra, por
  linha processada, se foi aceita (`accepted`), por que foi rejeitada
  (`rejectReason`), e o resultado da classificação (`classificationResult`);
  `CatalogItemLineage` liga cada `CatalogItem` à página/linha/parser que o
  originou; `ReplaySnapshot` guarda o HTML bruto capturado, pra reprocessar
  sem rebaixar da wiki.
- **Estado atual**: órfãs. É infraestrutura de uma geração anterior do
  pipeline — as 2 execuções e os 70 registros de auditoria existentes datam
  de antes dos scripts `sync*.js` atuais (que escrevem direto em
  `CatalogItem`, sem passar por nenhuma dessas 4 tabelas).
- **Motivo de não remoção**: mesma razão do `WikiPage` — sem justificativa
  concreta pra alterar schema; e este é exatamente o tipo de infraestrutura
  que tornaria auditorias futuras (como as que geraram este documento)
  automatizáveis em vez de manuais.
- **Condição para reativação**: se o projeto decidir que quer rastreamento
  automático de execução/decisão de parser (o que eliminaria a necessidade de
  auditoria manual recorrente) — é um projeto de instrumentação, não um
  ajuste pontual; exige decidir o formato de write nos 9 scripts de sync.
- **Condição para remoção**: só com aprovação explícita pra alterar schema, e
  só depois de decidir conscientemente que rastreabilidade automática nunca
  será prioridade pra este projeto.

---

## 3. Decisões de domínio

### Por que `daily-boss-access` não é um `CatalogItem`, conceitualmente

Os 24 registros dessa categoria representam **janelas de acesso sazonal**
("Halloween 2024", "Dia das Mães 2023", "Mega Evolution") — quando um boss
fica acessível, não um objeto que o jogador possui. A evidência que sustenta
isso (não é opinião, é comportamento observável):

- `imageUrl` vazio em 24/24 (único padrão sistemático assim no catálogo
  inteiro — todo item de verdade tem alguma imagem).
- 0 referências em `Listing`, 0 em `StoreItem` — nunca foi negociado, porque
  não é negociável.
- `slug` no formato `daily-boss-access-{evento}` — autogerado a partir de um
  nome de evento, não é o "nome de um produto".

Um `CatalogItem` no modelo deste projeto representa algo que o jogador
possui e pode negociar. Uma janela de acesso é um conceito de calendário/
progressão, categoricamente diferente.

### Registro: a migração foi adiada, depois revisitada e resolvida (deleção)

Durante a auditoria original, foi oferecida uma correção mínima (tag
`extractedFields.isAccessRecord`, sem mudança de schema) e a decisão
explícita foi **não mexer naquele momento**. Isso não foi esquecimento —
foi adiamento registrado (ver seção 5, texto original preservado abaixo).

**Atualização (2026-07-15)**: a decisão adiada foi revisitada, a pedido
explícito do usuário, e resolvida de forma diferente da correção mínima
oferecida — as 24 linhas foram **apagadas do catálogo** (não só
tagueadas), confirmado sem nenhuma referência em `Listing`/`StoreItem`
antes da deleção. Ver `CLAUDE.md`, "Deleção de dado real 2026-07-15", pro
registro completo.

**Risco conhecido, não resolvido**: `src/wiki-crawler/parsers/
syncDailyBossCatalog.js`'s branch de criação (namespace `'access'`, linha
~145) continua escrevendo `category: 'daily-boss-access'` — rodar `npm
run dailyboss:sync` de novo recria essas linhas silenciosamente. Isso foi
deixado assim de propósito (o pedido do usuário foi "apagar agora", não
"impedir de existir pra sempre" — essa segunda decisão de modelagem não
foi tomada). `test/dailyBossAccess.test.js` agora serve de canário contra
essa recriação silenciosa — se esse teste voltar a falhar, é o sinal pra
revisitar esta seção antes de decidir o que fazer com as linhas.

---

## 4. Campos denormalizados sem consumidor confirmado

| Campo | Onde é escrito | Consumidor real encontrado | Divergência medida | Risco | Decisão |
|---|---|---|---|---|---|
| `extractedFields.mainCategory` | Só `syncSubcategories.js:54` | Nenhum (busca em `src/` e `frontend/src/` não encontra leitura) | 399/809 itens (49%) divergentes do `category` real | Nenhum risco funcional hoje — só risco de confundir uma auditoria futura que não saiba que o campo é morto | Não corrigido: não há consumidor que se beneficie da correção |
| `CatalogItem.slug` | Gerado uma vez, na criação, por cada `sync*.js` | Nenhum uso funcional (só existe pro `@unique` da criação; não aparece em nenhuma rota nem componente do frontend) | Não medido em %, mas qualquer reclassificação manual de `category` deixa o `slug` descrevendo a categoria antiga pra sempre | Nenhum risco funcional hoje | Não corrigido: mesma razão |

**Registro do risco**: ambos os campos podem divergir do dado real
indefinidamente, sem gerar nenhum sintoma visível — são inconsistências
silenciosas por definição. A decisão de não corrigir é válida **enquanto**
nenhum consumidor passar a existir; se algum dia uma rota ou componente
começar a ler `mainCategory` ou `slug`, esta decisão precisa ser revisitada
antes, não depois.

---

## 5. Não alterar sem revisão arquitetural

Os itens abaixo não devem ser alterados como parte de uma tarefa pontual —
exigem uma decisão explícita de arquitetura antes (equivalente ao momento
"Revisão de arquitetura" descrito em `DEVELOPMENT_PROCESS.md`):

- **As 5 tabelas legadas** (`WikiPage`, `SyncExecution`, `ParserAuditRecord`,
  `CatalogItemLineage`, `ReplaySnapshot`) — não dropar, não migrar dado pra
  elas, não passar a escrever nelas incidentalmente como parte de outra
  tarefa. Reativação ou remoção são projetos próprios (ver condições na
  seção 2).
- **Qualquer mudança de schema em `prisma/schema.prisma`** — inclui adicionar
  coluna, mudar tipo, adicionar/remover relação. Mudança aditiva de rotina
  ainda segue a regra 4 de `ARCHITECTURE_RULES.md`; qualquer coisa além disso
  (rename, drop, mudar relação) é o que este item cobre.
- **Migração de `daily-boss-access` pra um modelo próprio** — não fazer como
  parte de uma tarefa de reclassificação de categoria. É uma decisão de
  modelagem que afeta schema, sync scripts e potencialmente a API/frontend.
  Foi oferecida e recusada nesta sessão (adiada, não descartada) — revisitar
  exige decisão nova, não repetir a oferta automaticamente.

Nenhum código, banco ou schema foi alterado na produção deste documento —
só leitura e registro do que já havia sido confirmado nas auditorias
anteriores.
