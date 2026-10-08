# AI-SETTINGS-BUSY-STATE-FIX-001

## Sintoma
Em Desktop Producer (vault DEV `zettel`): Testar ligação OK → Gerar embeddings falha → ao voltar às Settings o botão
**Testar ligação** fica não clicável (cursor "proibido").

## Mapa do estado
- O botão é renderizado por `createDeclarativeSettingsButtonRenderer` com `setDisabled(action.isDisabled())`.
- `isDisabled()` (`declarativeSettingsConnectionCredentialRenderers.ts`) = `disposed || connection.status === "pending"`.
- `connection.status` e o `pending` do lifecycle são libertados por `runConnectionTest` em `declarativeSettingsConnectionCredentialBindings.ts`.
- Não existe flag partilhada entre "Gerar embeddings" e "Testar ligação": o estado de ligação é por domínio
  (`analysis` / `embeddings`) e por instância de composição; `hide()` faz `dispose()` e uma nova abertura cria composição nova.
- Não há CSS que desative o botão (`pointer-events: none` / `is-disabled` ausentes; teste de guarda adicionado).
- Nenhum estado transitório (`busy/pending/isGenerating/...`) é persistido em `data.json` (verificado no `data.json` do vault DEV e no código).

## Causa raiz (BUG-B) — defeito de cleanup, confirmado por análise estática e testes
`runConnectionTest` chamava `getConnectionConfiguration()` **fora de `try`** e, no sucesso/erro, voltava a chamá-lo dentro
de `completeConnection()`, que também era invocado dentro do `catch`. Se o resolvedor de configuração lançar (estado de runtime
de embeddings inconsistente após uma falha), a exceção escapava do `catch`, `completePending` nunca era chamado e ficavam
presos o `pending` do lifecycle e `connection.status === "pending"` ⇒ botão `disabled` até o domínio ser invalidado.
O mesmo padrão existia em `saveCredential`/`clearCredential` (pending preso em "saving"/"clearing").

## Correção
- Configuração capturada uma única vez, dentro do `try`; `completeConnection` deixa de a reler.
- `finally` em `runConnectionTest`, `saveCredential` e `clearCredential` liberta pending/estado se a operação não foi resolvida
  por nenhum outro caminho (apenas se o token ainda é o atual — resultados tardios continuam neutralizados).
- `run()` da ação não deixa promessas rejeitadas sem tratamento.
- Sem alterações a ownership, CURRENT, M6, gerações, SQLite, vector contract, build profiles ou M7.

## BUG-A — falha da geração de embeddings
**Não determinada.** Não foi possível reproduzir no Obsidian real neste ambiente; o vault DEV não contém registo do erro
(`.lina` sem log da falha). Não foi feita nenhuma correção especulativa. Para o apurar: reproduzir no vault DEV com a consola
aberta e registar provider, modelo, endpoint, fase e mensagem.

## Testes
`tests/settings/aiSettingsBusyStateRelease.test.ts` (9 testes): sucesso, resultado falhado, exceção do port, exceção do resolvedor
(durante e antes do pedido), independência entre domínios, cancelamento/invalidation, save/clear com exceção, reabertura das
settings e guardas contra persistência/CSS. Suite completa: 187 ficheiros / 2418 testes.

## Gates
`npm test`, `typecheck`, `lint:obsidian:strict`, `build`, `build:dev`, `release-check`, `git diff --check`: todos verdes.

## Validação em runtime
`OBSIDIAN_RUNTIME`: **NÃO EXECUTADA** (sem acesso interativo ao Obsidian). Build DEV instalado em `zettel`; a sequência
Testar ligação → Gerar embeddings → Settings → Testar ligação deve ser confirmada manualmente.
