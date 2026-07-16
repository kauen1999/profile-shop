# PokeShopping

Codinome interno do repositório/pasta: `profile-shop`. Renomeado de "OTPHub"
em 2026-07-13 — deixou de ser um marketplace único e passou a ser uma
plataforma onde cada usuário cria sua própria loja de itens/Pokémon do jogo
**otPokémon** (servidor PvP baseado em Pokémon). O catálogo é populado a
partir da wiki do jogo (`wiki.otponline.com`).

**Stack**: Express + Prisma + Postgres (Neon) no backend; React + Vite
(JavaScript, sem TypeScript) no frontend.

## Rodando localmente

```bash
npm start                     # backend em http://localhost:3000
cd frontend && npm run dev    # frontend em http://localhost:5173
```

`.env` (raiz) precisa de `DATABASE_URL`; `frontend/.env` precisa de
`VITE_API_URL`. Nunca commitar nenhum dos dois.

## Documentação do projeto

- **[`ARCHITECTURE_RULES.md`](./ARCHITECTURE_RULES.md)** — regras
  invariáveis de como o sistema é modelado (categoria/subcategoria,
  regra contra duplicata, domínios de dado). Não muda com a ferramenta usada
  pra desenvolver.
- **[`DEVELOPMENT_PROCESS.md`](./DEVELOPMENT_PROCESS.md)** — como o trabalho é
  organizado em papéis (Servidor & Catálogo, Interface) e quando cada
  revisão ocasional (segurança, schema, release etc.) acontece.
- **[`CLAUDE.md`](./CLAUDE.md)** — contexto operacional pra quem (ou o que)
  está desenvolvendo com Claude Code: estado atual do catálogo, decisões
  recentes, como os papéis acima são implementados nesta ferramenta
  especificamente.
- **[`CATALOG_PIPELINE.md`](./CATALOG_PIPELINE.md)** — arquitetura detalhada
  do pipeline do catálogo: estado ativo (wiki → parser → classificador →
  persistência → subcategories), componentes legados do schema sem
  consumidor real, decisões de domínio, e o que não deve ser alterado sem
  revisão arquitetural.
