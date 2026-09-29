# LINA-13-P1A-IMPLEMENT-SEMANTIC-SEARCH-PREGATE-001

## 1. Problema
Antes desta fase (LINA-13 — P1-A), o fluxo de pesquisa semântica pura no explorador (`runSemanticSearchGrouped` em `src/search/linaSearchView.ts`) continha um pré-gate redundante e antecipado baseado em cache/estado derivado:

```typescript
const runtimeState = this.plugin.getDeviceRuntimeState();
if (!runtimeState.embeddings.semanticAvailable) {
  this.setSearchStatus(runtimeState.embeddings.reason || this.L.stateSemanticUnavailable);
  return;
}
```

Este pré-gate criava um acoplamento problemático entre:
- O estado de cache transitório ou em background de `DeviceRuntimeState` (ex.: após arranque, sync ou transição);
- A disponibilidade operacional real dos artefactos publicados e do índice vetorial em disco/memória.

Caso o estado derivado estivesse temporariamente desatualizado ou o dispositivo operasse como Companion com Vector Contract válido e índice local compatível, a pesquisa semântica era prematuramente bloqueada antes mesmo de consultar `getRuntimeEmbeddingIndex()`.

## 2. Decisão Arquitetural
1. **Remoção Estrita do Pré-Gate Redundante:** Eliminou-se a verificação antecipada de `getDeviceRuntimeState().embeddings.semanticAvailable` em `runSemanticSearchGrouped`.
2. **Confiança no Vector Contract e Validação Operacional em Tempo Real:** A cadeia de pesquisa semântica confia exclusivamente nas validações operacionais reais já implementadas:
   - Papel de dispositivo e Vector Contract em Companion (`embeddingConfig.contract`);
   - Carregamento lazy/cached do índice runtime (`getRuntimeEmbeddingIndex()`);
   - Validação de identidade e compatibilidade de Provider (`runtimeIndex.provider === settingsProvider`);
   - Validação de Modelo (`runtimeIndex.model === settingsModel`);
   - Validação de `inputVersion` e `prefixMode` (`runtimeIndex.sourceIdentity`);
   - Consistência de dimensões (`runtimeIndex.dimensions > 0`);
   - Geração controlada de embedding da query (`generateSingleEmbedding()`);
   - Princípio *Zero Silent Fallback* preservado integralmente: qualquer incompatibilidade bloqueia a pesquisa semântica com mensagem clara e nunca recorre silenciosamente a fallback de modelo ou texto.
3. **Mapeamento Canónico de Falhas de Carga/Estado Vazio:** Atualizou-se `getSemanticRuntimeLoadMessage()` (em `linaSearchView.ts` e `semanticSearchModal.ts`) para mapear diagnósticos como `canonical-manifest-invalid`, `canonical-manifest-read-failed` e `canonical-embeddings-empty` diretamente para `semanticNoEmbeddings` ("Não existem embeddings gerados..."), evitando mensagens genéricas de falha de I/O quando o vault simplesmente não tem embeddings gerados.

## 3. Ficheiros Alterados
- `src/search/linaSearchView.ts`:
  - Removido o pré-gate `getDeviceRuntimeState().embeddings.semanticAvailable` de `runSemanticSearchGrouped`.
  - Expandido `getSemanticRuntimeLoadMessage()` para mapeamento robusto de códigos vazios/inválidos para `semanticNoEmbeddings`.
- `src/search/semanticSearchModal.ts`:
  - Alinhado `getRuntimeLoadMessage()` com os mesmos códigos de índice inexistente/vazio.
- `tests/search/semanticSearchRuntimeGate.test.ts`:
  - Novo ficheiro de testes dedicado cobrindo invariantes estruturais e os 4 casos de validação canónicos.

## 4. Testes Executados
A nova suíte `tests/search/semanticSearchRuntimeGate.test.ts` valida:
- **Invariante Estrutural:** `runSemanticSearchGrouped` não contém chamadas a `getDeviceRuntimeState` nem bloqueios por `semanticAvailable`.
- **Caso 1 (Cache indisponível vs Artefacto válido):** Estado de runtime/cache com `semanticAvailable: false`, mas com índice e Vector Contract válidos → pesquisa semântica executa normalmente.
- **Caso 2 (Contrato incompatível):** Divergência de provider ou modelo entre definições e índice publicado → pesquisa semântica é bloqueada com mensagem explícita sem efetuar chamadas a providers.
- **Caso 3 (Embeddings inexistentes):** Índice vazio/inexistente → pesquisa semântica é bloqueada com `semanticNoEmbeddings`.
- **Caso 4 (Companion com Vector Contract válido):** Companion com contrato sincronizado e índice compatível → pesquisa semântica opera com sucesso.

### Resultados da Validação Global:
- `npm test`: 127 suites / 1700 testes aprovados.
- `npm run typecheck`: Aprovado sem erros (tsc --noEmit).
- `npm run lint:obsidian:strict`: Aprovado sem erros e com 0 avisos.
- `npm run build`: Build de produção e cópia para test-vault concluídos com sucesso.
- `npm run release-check`: Todos os ficheiros e condições de release validados.
- `git diff --check`: Nenhuma anomalia de formatação ou whitespace.

## 5. Impacto
- **Zero Regressões:** O fluxo de pesquisa textual, pesquisa combinada, e a geração/manutenção de embeddings permanecem intocados.
- **Transparência e Fiabilidade:** A pesquisa semântica agora reflete rigorosamente a realidade operacional do índice e do Vector Contract, eliminando falsos bloqueios por desfasamento de cache.
- **Zero Silent Fallback:** Regras de segurança de modelo e provider continuam estritamente cumpridas antes de qualquer chamada de rede.

## 6. Limitações
- Esta fase concentrou-se exclusivamente no pré-gate de pesquisa semântica (P1-A).
- As fases subsequentes de robustez e unificação da máquina de estados do workflow de embeddings e UI settings continuam no roadmap.

## 7. Próximos Passos do Roadmap
- **Fase P1-B:** Concluída anteriormente (inicialização do Vector Contract antes do cálculo do runtime state).
- **Fase LINA-13 subsequente:** Monitorização e polimento das métricas operacionais e transições de estado do workflow de embeddings.
