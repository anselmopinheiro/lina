# LINA-14B-IMPLEMENT-SHADOW-ADAPTER-001

## 1. Contexto e Objetivo
Esta fase do roadmap implementa o **Embedding Lifecycle Shadow Adapter** em modo de observabilidade estrita (*Shadow Mode*).

O adapter converte os múltiplos artefactos e estados em memória atualmente existentes no Lina numa representação unificada [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts) e permite comparar sistematicamente as decisões do modelo legado com as decisões do novo modelo, sem alterar decisões funcionais nem substituir consumidores de produção activos.

## 2. Arquitetura do Shadow Adapter

### 2.1 Módulo `src/index/embeddingLifecycleAdapter.ts`
Implementado como um conjunto de funções puras e determinísticas:
- **`toEmbeddingIdentitySummary`**: Normaliza e extrai uma `EmbeddingIdentitySummary` canónica a partir de `PublishedEmbeddingIdentity`, `VectorContractV1` ou de definições de runtime;
- **`adaptCurrentStateToLifecycleSnapshot`**: Recebe `CurrentEmbeddingStateInputs` (agregando `deviceRuntimeState`, `workflowState`, `updatePlan`, `vectorContract`, `producerState`, `companionState`, etc.) e invoca `resolveEmbeddingLifecycle` com parâmetros normalizados;
- **`compareLegacyWithLifecycleSnapshot`**: Compara o sumário de estado legado (`legacyStateSummary`) com o snapshot gerado, detetando e classificando divergências em 5 áreas (`read`, `write`, `process`, `primary`, `capability`);
- **`createEmbeddingLifecycleShadowComparison`**: Função de conveniência que executa a adaptação e a comparação de shadow num único passo determinístico.

### 2.2 Fontes de Estado Utilizadas
- **`deviceRuntimeState`**: Papel efetivo do dispositivo (`effectiveRole`), autoridade de publicação (`isActiveProducer`), preferências de armazenamento e estado de embeddings;
- **`workflowState`**: Estado do workflow legado e indicação de trabalho pendente (`workAvailable`);
- **`updatePlan`**: Planeamento factual de embeddings com contagens detalhadas de trechos e estratégia (`initial-build`, `incremental`, `full-rebuild`, `indeterminate`);
- **`vectorContract`**: Identidade formal e imutável do contrato vetorial canónico (`VectorContractV1`);
- **`publishedIdentity`**: Identidade dos embeddings atualmente publicados em disco;
- **`operationState`**: Estado e progresso da operação ativa de geração/persistência de embeddings;
- **`producerState`**: Histórico operacional e de manutenção do Produtor Ativo (`ProducerStateV1`);
- **`companionState`**: Proveniência e capacidades de consumo sincronizado do Companion (`CompanionArtifactConsumptionState`).

## 3. Divergências Observadas e Tratamento no Shadow Mode

1. **Isolamento de Escrita no Papel Companion (C1):**
   - *Legado:* Em certas situações, `workflowState.workAvailable` podia reportar `true` no Companion se este avaliasse o plano com base em definições locais.
   - *Snapshot:* `write.applicable` é estritamente `false` e `capability.canRequestUpdate` é `false`. A comparação shadow classifica esta divergência como `info`, confirmando a resolução da regra C1 sem afetar o modo de pesquisa (`READY`).
2. **Disponibilidade Semântica e Cache do Read Path:**
   - *Legado:* `DeviceRuntimeState.embeddings.semanticAvailable` podia divergir temporariamente da realidade operacional se a cache não tivesse sido atualizada após sync ou carregamento de contrato.
   - *Snapshot:* Avalia deterministicamente a presença de vetores utilizáveis (`validForSearchCount > 0`) e compatibilidade do contrato vetorial. Divergências são assinaladas com severidade `divergence`.
3. **Mapeamento de Estado Primário vs Status de Workflow Legado:**
   - O adapter mapeia os 12 estados primários para os equivalentes legados de workflow, assinalando estados mais granulares (ex.: `INDEX_ONLY`, `NO_TEXT_INDEX`, `INCOMPATIBLE`, `STANDBY`) como `warning` informativo para observação.

## 4. Ficheiros Criados e Alterados
- **Criados:**
  - [`src/index/embeddingLifecycleAdapter.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleAdapter.ts): Shadow adapter e funções de comparação.
  - [`tests/index/embeddingLifecycleAdapter.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingLifecycleAdapter.test.ts): Suíte com 10 testes unitários cobrindo todos os cenários canónicos.
  - [`docs/audits/architecture/LINA-14B-AUDIT-SHADOW-ADAPTER-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14B-AUDIT-SHADOW-ADAPTER-001.md): Auditoria e inventário pré-implementação.
  - [`docs/audits/architecture/LINA-14B-IMPLEMENT-SHADOW-ADAPTER-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14B-IMPLEMENT-SHADOW-ADAPTER-001.md): Relatório de implementação.
- **Alterados:**
  - [`src/index/embeddingLifecycleModel.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts): Ajustada a ordem de precedência de `INDETERMINATE` e tipagem de fases de operação.
  - [`AGENTS.md`](file:///d:/_dev/obsidian/lina/AGENTS.md): Registo da conclusão da Fase LINA-14B.
  - [`CHANGELOG.md`](file:///d:/_dev/obsidian/lina/CHANGELOG.md): Registo no changelog.
  - [`main.js`](file:///d:/_dev/obsidian/lina/main.js): Build de produção atualizado.

## 5. Testes Executados
A suíte `tests/index/embeddingLifecycleAdapter.test.ts` valida:
- Conversão de identidade a partir de contratos e manifestos;
- Embeddings inexistentes mapeados para `NO_TEXT_INDEX` ou `INDEX_ONLY`;
- Embeddings válidos e sincronizados mapeados para `READY`;
- Incompatibilidade de provider/modelo mapeada para `INCOMPATIBLE` (Zero Silent Fallback);
- Notas alteradas sem rebuild mapeadas para `UPDATE_AVAILABLE`;
- Isolamento estrito do Companion (`write.applicable = false`, `canRequestUpdate = false`);
- Estado desconhecido/ilegível mapeado para `INDETERMINATE` (sem fallback silencioso para `READY`);
- Relatório detalhado de diferenças no `createEmbeddingLifecycleShadowComparison`.

### Resultados da Validação Global:
- `npm test`: 129 ficheiros de teste / 1742 testes aprovados (+10 novos testes).
- `npm run typecheck`: Aprovado sem erros (`tsc --noEmit`).
- `npm run lint:obsidian:strict`: Aprovado com 0 erros e 0 avisos.
- `npm run build`: Compilação de produção e cópia para test-vault concluídas com sucesso.
- `npm run release-check`: Validado para release.
- `git diff --check`: Limpo sem anomalias de whitespace.

## 6. Limitações
- O adapter opera exclusivamente em modo observacional e de teste.
- Os componentes de UI e os workers continuam a utilizar as fontes de estado legadas até à fase LINA-14D.

## 7. Próximos Passos (Roadmap LINA-14)
- **LINA-14C (Coordinator & Subscription):** Criar `EmbeddingLifecycleCoordinator` que orquestre revisões, invalidações por eventos e subscrições reativas.
- **LINA-14D (Presentation Cutover):** Migrar a Sidebar, ecrãs de diagnóstico e Settings para consumir o `EmbeddingLifecycleSnapshot`.
