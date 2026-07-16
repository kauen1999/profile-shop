# Regras de Arquitetura — profile-shop (OTPHub)

Regras invariáveis sobre como este sistema é modelado. Não descrevem
ferramenta, fluxo de trabalho ou quem/o que executa o trabalho — isso está em
`DEVELOPMENT_PROCESS.md`. Estas regras valem independente de qual assistente
de IA (se algum) está sendo usado.

## 1. Categoria responde só "o que é", nunca "de onde veio"

`CatalogItem.category` classifica **o que o item é** (ex: `held-items`,
`pokeballs`, `mega-stones`, `carpets`). Nunca representa um sistema de
recompensa ou uma fonte de obtenção (ex: não pode existir uma categoria
`daily-boss-drops` ou `quest-rewards` como classificação principal de um
item).

Onde/como um item é obtido vive em `extractedFields.subcategories` — um
array de chaves de fonte (ex: `dailyBossSources`, `questSources`,
`craftIngredient`). Um item pode ter uma categoria e múltiplas subcategorias
simultaneamente (ex: uma pedra de evolução obtida por 5 sistemas diferentes
continua sendo 1 linha só, com 1 categoria e 5 subcategorias).

Misturar os dois conceitos na mesma coluna é a causa raiz mais comum de
duplicata neste catálogo — já resolvido em ~134 casos reais nesta base.

## 2. Nenhum item novo sem checar se já existe

Antes de criar um registro novo de item, busca-se por um já existente que
represente a mesma coisa — comparando **nome canônico** e **título de
origem**, não apenas um dos dois (um já divergiu do outro nesta base e
escondeu duplicatas de uma varredura que só olhava um campo).

Se já existe: atualiza-se o registro existente (adiciona a subcategoria/fonte
nova), nunca se cria um segundo registro. Só se cria um registro novo quando
nenhum já existente representa o mesmo item.

## 3. Dois domínios de dado independentes

O sistema tem um domínio de **servidor/dado** (schema, sincronização,
regras de negócio, API) e um domínio de **cliente/interface** (o que é
renderizado e como). O domínio de cliente nunca acessa dado diretamente —
sempre por meio da camada de API do domínio de servidor.

Mudança de contrato de um domínio que afeta o outro (ex: um campo que a
interface espera e deixa de existir) é sinalizada explicitamente antes de
prosseguir — nunca silenciosa.

## 4. Mudança estrutural de dado é aditiva por padrão

Adicionar um campo novo opcional, ou uma tabela nova que não afeta dado
existente, é uma mudança de rotina. Renomear ou remover um campo existente,
ou mudar uma relação entre entidades, é uma mudança estrutural que exige um
passo de revisão explícito antes de ser aplicada — nunca decidida no impulso
durante uma tarefa não relacionada.

## 5. Documentação acompanha a mudança, no mesmo momento

Uma mudança relevante no sistema (novo modelo de dado, nova regra, decisão de
arquitetura, mudança que altera número/contagem documentado) é registrada
junto com a mudança que a motivou — nunca como tarefa separada ou adiada para
depois.

## 6. Toda tela do domínio de cliente é pensada mobile-first

Qualquer página ou componente novo do domínio de cliente/interface (regra 3)
é desenhado **mobile-first desde a primeira versão**, não convertido depois:
regras base (sem `@media`) alvejam a tela pequena, e `@media (min-width: ...)`
só amplia/reorganiza para telas maiores — nunca o caminho inverso
(`max-width` a partir de um layout desktop). Isso vale mesmo quando a tarefa
pedida é pequena ou parece cosmética (ex: mover um botão) — a versão mobile
não é um ajuste posterior, é parte da própria implementação.

**Piso mínimo de tela pra verificar, não só de intenção**: toda tela/
componente novo (ou alterado) do domínio de cliente precisa ser checado
contra viewport **375×667** (um celular pequeno real, não hipotético) antes
de considerar a tarefa concluída — não basta escrever CSS mobile-first "de
memória", tem que confirmar visualmente/via medição (`document.body.
scrollWidth` vs `window.innerWidth`, elementos com `getBoundingClientRect()`
saindo do viewport) que não há overflow horizontal nem elemento cortado
nessa largura. Motivo registrado: várias correções nesta mesma sessão
(overflow de pill com `white-space: nowrap`, hambúrguer colado no logo,
padding nunca sobrescrito num card) só existiam porque "pensado mobile-first"
não tinha sido de fato testado nesse tamanho concreto antes de dar a tarefa
por pronta.
