# LINA 0.3.2 — Release readiness

```text
MÓDULOS
1. Settings/Privacy:            OK (3 P1 corrigidos: M1-F1, M1-F2, M1-F5)
2. Producer/Companion/Sync:     OK
3. Search/Embeddings:           OK
4. AI/Tags/YAML:                OK
5. Persistence/Migrations:      OK com pendências não bloqueantes (M5-F1, M5-F2)
6. UI/UX:                       OK (análise estática; validação Android fornecida pelo responsável)
7. Build/Docs:                  OK com pendência não bloqueante (teste M6 de vault real)
G. Transversal:                 OK após correções (resíduo G-F1)

PENDÊNCIAS BLOQUEANTES
- Nenhuma.

PENDÊNCIAS NÃO BLOQUEANTES
- M7-F1  Teste M6 depende de vault real (zettel): 2302 != 2303, assinatura idêntica ao baseline.
- G-F1   Política de exclusões não recarregada durante a sessão fora do limite do provider de IA (pesquisa, definições do Companion).
- M5-F1  Promoção de ficheiros partilhados por duas renames: janela de crash com canónico ausente; claim inicial não consulta ownership-history.
- M1-F3  getEffectiveExclusionRules() devolve regras vazias em `invalid`; consumidores que não verificam o estado ficam permissivos.

BACKLOG
- M1-F4  Verificar se o inventário de tags do vault entra em algum prompt (inclui tags de notas excluídas).
- M2-F1  Unificar PRODUCER_STATE_FILE_PATH.
- M4 INFO  Mover mensagem de fallback de taxonomia para UiStrings.
- M5-F2  Limpeza/protocolo determinístico para .tmp-*/.bak-* na raiz de .lina/.
- M6-F1..F3  !important (28), ausência de regras mobile, estilos inline.
- M7-F2  Executar npm test e lint no CI depois de resolver M7-F1.
- INFO   Campos vestigiais generateEmbeddingsOnStartup/autoGenerateEmbeddingsOnStartup.

GATES FINAIS (árvore de trabalho com as correções)
tests:          2605 passed / 1 failed (m6DesktopRuntimeValidation, falha conhecida e idêntica)
lint:           lint:obsidian e lint:obsidian:strict — 0 erros, 0 avisos
typecheck:      limpo
build:          concluído (main.js regenerado)
release-check:  READY FOR OBSIDIAN RELEASE
diff-check:     limpo

ALTERAÇÕES DESTA FASE (por commitar)
- main.ts, src/search/linaSearchView.ts, src/i18n/strings.ts — 3 correções de privacidade
- tests/search/aiPrivacyGateIntegration.test.ts — +2 testes, 1 asserção atualizada
- main.js — bundle regenerado
- CHANGELOG.md — entrada em Fixed
- docs/audits/release/0.3.2/ — 10 relatórios

DECISÃO
GO COM BACKLOG
```

## Reservas

- A decisão assenta em análise estática e na suite automatizada. Não houve validação runtime em Obsidian por este agente.
- Os testes novos são estruturais (inspecionam o código-fonte), seguindo o padrão de `aiPrivacyGateIntegration.test.ts`; não substituem uma
  verificação manual de: (a) um Companion com sessão aberta depois de o Producer adicionar uma exclusão; (b) análise de uma nota com uma pasta excluída.
- Como M1-F5 altera o caminho de IA em todos os fluxos (um `reloadExclusionPolicy` por pedido), recomenda-se uma passagem rápida manual de
  `/ask`, `/tags`, análise individual e Inbox antes do pre-release.
- Sem commit, tag, push ou release realizados.
