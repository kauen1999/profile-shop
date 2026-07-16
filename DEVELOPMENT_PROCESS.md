# Processo de Desenvolvimento — profile-shop (OTPHub)

Como o trabalho neste projeto é organizado em **papéis**, não em ferramenta.
Um papel é uma responsabilidade com escopo claro — pode ser executado por um
humano, por um agente de IA, ou por qualquer assistente, sem mudar a
definição. Como cada papel é implementado na ferramenta específica em uso no
momento está documentado separadamente, não aqui.

## Papéis permanentes

### Servidor & Catálogo

Dono de rotas de API, scripts de sincronização/parsers, schema de dados, e do
modelo de categoria/subcategoria (aplica as regras de `ARCHITECTURE_RULES.md`).

Domínio principal: tudo que roda no servidor.

### Interface

Dono de páginas, componentes, estilo, e do consumo de dado via camada de API
do cliente — nunca acesso direto a dado do servidor.

Domínio principal: tudo que roda no cliente.

Hoje só existem estes dois papéis permanentes. Ver "Crescimento dos papéis"
abaixo para quando adicionar um terceiro.

## Regra de cruzamento de domínio

Um papel pode executar trabalho fora do seu domínio principal quando a tarefa
genuinamente exigir (ex: endpoint novo que já nasce com o ajuste de interface
que o consome, no mesmo pedido) — mas precisa **explicitar que está cruzando e
por quê** antes de prosseguir. Nunca dois extremos: nem bloqueio rígido que
impede trabalho legítimo, nem cruzamento silencioso sem aviso.

## Pontos de revisão ocasional

Não são papéis permanentes — são **momentos** do processo que acontecem raro
o suficiente para não justificar alguém/algo carregando esse contexto o tempo
todo. Cobertos por qualquer capacidade de revisão disponível no momento (humana
ou de ferramenta).

| Momento | Quando acontece | Por que não é um papel permanente |
|---|---|---|
| Revisão de arquitetura | Antes de uma decisão estrutural grande | Pouco frequente; não precisa carregar contexto o tempo todo |
| Revisão de segurança | Antes de expor rota nova ou mexer em autenticação/dado sensível | Projeto pequeno, superfície de ataque muda devagar |
| Revisão de performance | Quando houver sintoma real (lentidão medida) | Investigar antes do sintoma é desperdício |
| Revisão de schema | Antes de qualquer mudança estrutural (regra 4 de `ARCHITECTURE_RULES.md`) | Schema muda raramente |
| Bootstrap de testes | Uma vez, quando o projeto priorizar isso | Depois de existir, escrever teste vira parte normal de implementar |
| Bootstrap de CI/CD | Uma vez, quando fizer sentido | Não é um papel recorrente, é um projeto pontual |
| Revisão de release | Antes de publicar uma mudança | Frequência baixa hoje |

## Crescimento dos papéis

Um papel se divide em dois quando aparecer **dor real de escopo** — nunca
antecipando complexidade que ainda não existe. Exemplos previstos (não
decisões já tomadas):

- **Servidor & Catálogo** → **Servidor & Catálogo** + **Marketplace**, se o
  lado de lojas/anúncios/usuários crescer a ponto de ter rotina própria
  (hoje esse lado nem tem rota de escrita implementada).
- **Interface** → **Interface** + **Painel Admin**, se surgir uma área
  administrativa grande o suficiente pra ter convenções próprias.

## O que foi conscientemente rejeitado

- **Um papel por parser/sistema de jogo** (Boss, Quest, NPC, Craft...) — os
  scripts de sincronização já seguem o mesmo padrão e compartilham utilitários;
  um único papel "Servidor & Catálogo" cobre todos sem perder contexto, porque
  o contexto relevante por tarefa já é pequeno (1-2 arquivos), independente de
  quantos papéis existem no papel.
- **Papel de documentação separado** — quem implementa documenta, no mesmo
  momento (regra 5 de `ARCHITECTURE_RULES.md`). Um papel à parte só
  adicionaria handoff sem necessidade.
