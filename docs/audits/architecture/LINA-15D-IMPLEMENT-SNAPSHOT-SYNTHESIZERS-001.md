# LINA-15D — RELATÓRIO DE IMPLEMENTAÇÃO: FONTE ÚNICA DE SNAPSHOT & REMOÇÃO DE SINTETIZADORES PARALELOS

> **Fase:** LINA-15D — Fonte Única de Snapshot & Remoção de Sintetizadores Paralelos  
> **Data:** 2026-10-01  
> **Autoridade Documental:** `AGENTS.md`, `docs/INDEX.md`, `docs/audits/architecture/LINA-15D-AUDIT-SNAPSHOT-SYNTHESIZERS-001.md`, `docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md`  
> **Contexto:** Resolução dos Findings F-06 e F-07 da Auditoria Global Pós-LINA-14  

---

## 1. Sumário da Execução

A fase **LINA-15D** implementou o saneamento arquitetural completo das fontes e adaptadores de `EmbeddingLifecycleSnapshot`, eliminando todas as identidades fabricadas e fallbacks cegos de provider que existiam no runtime e nas camadas de apresentação/fallback.

A cadeia canónica unificada foi formalmente restabelecida e validada:

$$\text{Estado Factual Real} \longrightarrow \text{EmbeddingLifecycleSnapshot} \longrightarrow \text{deriveEmbeddingWritePathDecision()} \longrightarrow \text{Consumidores (Worker / Scheduler / UI / Search)}$$

---

## 2. Inventário de Alterações por Módulo

| Ficheiro | Natureza | Alteração Realizada | Justificação Arquitetural |
|---|---|---|---|
| [`src/index/embeddingLifecycleAdapter.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleAdapter.ts) | Adaptador Canónico (Cat. B) | Remoção das identidades fabricadas `"default-producer"`, `"default-model"`, `"mismatch-local"` e `"mismatch-model"`. Quando os metadados reais estão ausentes, `publishedIdentity` ou `deviceIdentity` permanecem `undefined`. | O modelo canónico em `resolveEmbeddingLifecycle` trata ausência de identidade como `incomplete-identity` de forma pura, sem inventar strings fictícias. |
| [`src/index/embeddingWorkStatusController.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts) | Factory de Controller (Cat. B) | Eliminação dos defaults forçados `"ollama"` / `"nomic-embed-text"` / `768` em `buildEmbeddingWorkLifecycleSnapshot`. `targetIdentity` e `publishedIdentity` só são construídos se os campos `provider` e `model` existirem factualmente. | Impede que vaults sem configuração de embeddings ou em estado não inicializado inventem configurações Ollama não existentes. |
| [`src/device/deviceRuntimeState.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceRuntimeState.ts) | Derived State (Cat. E) | Saneamento da derivação de `publishedIdentity` em `resolveDeviceRuntimeState`: validação estrita de strings em `manifestEmbeddings.provider` e `manifestEmbeddings.model` sem fallback cego para `"ollama"` ou model `"default"`. | Garante que o `DeviceRuntimeState` derive o seu estado estritamente dos artefactos em disco (`.lina/ownership.json`, `.lina/devices/`, manifestos). |
| [`src/search/semanticCapability.ts`](file:///d:/_dev/obsidian/lina/src/search/semanticCapability.ts) | Avaliador de Capacidade Semântica (Cat. E) | Remoção de `"mismatch-provider"` / `"mismatch-model"` / `1024` e saneamento de fallback para `canonicalExists` quando `reasonCode === "missing"`. | Preserva a integridade do modelo de prontidão semântica sem sintetizar providers artificiais. |
| [`src/search/sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts) | ViewModel de Apresentação (Cat. E) | Remoção de `"mismatch-configured"` e eliminação de propriedade redundante `vectorContract` no fallback adapter, alinhando `workAssessment` com `mode: "full-rebuild"` em caso de mismatch. | Apresentação fiel do estado de degradação semântica/híbrida para o utilizador. |

---

## 3. Classificação Final dos Produtores de Snapshot

1. **`resolveEmbeddingLifecycle` (`src/index/embeddingLifecycleModel.ts`):**  
   *Categoria A (Fonte factual legítima / Motor de regras canónico)* — Mantido intacto.
2. **`main.getEmbeddingLifecycleSnapshot()` (`main.ts`):**  
   *Categoria A (Ponto de Orquestração Runtime Canónico)* — Mantido intacto. Agrega o live authority runtime state, live operation state e `EmbeddingWorkSummary` do controller.
3. **`adaptCurrentStateToLifecycleSnapshot` (`src/index/embeddingLifecycleAdapter.ts`):**  
   *Categoria B (Adaptador factual legítimo)* — Saneado. Converte e normaliza inputs heterogéneos sem inventar identidades.
4. **`buildEmbeddingWorkLifecycleSnapshot` (`src/index/embeddingWorkStatusController.ts`):**  
   *Categoria B (Adaptador factual legítimo)* — Saneado. Constrói o snapshot a partir do resumo factual do controlador.
5. **Fallbacks de UI/Diagnósticos (`deviceRuntimeState.ts`, `sidebarStatusViewModel.ts`, `semanticCapability.ts`):**  
   *Categoria E (Fallbacks legítimos)* — Saneados. Operam apenas como proteções defensivas sem fabricação de semântica.

---

## 4. Quality Gates e Validação

A bateria completa de testes e verificações foi executada com sucesso:

- **Vitest Unit & Integration Suite:** 149 ficheiros de teste, 1969 testes aprovados (100% pass rate).
- **TypeScript Typecheck (`npm run typecheck`):** 0 erros.
- **Strict Obsidian ESLint (`npm run lint:obsidian:strict`):** 0 avisos, 0 erros.
- **Production Build (`npm run build`):** Sucesso (bundle gerado e test-vault sincronizado).
- **Release Verification (`npm run release-check`):** READY FOR OBSIDIAN RELEASE.
- **Git Working Tree (`git diff --check`):** Limpo, sem trailing whitespace nem conflitos.

---

## 5. Respostas Finais aos Critérios de Conclusão da LINA-15D

1. **Quantos produtores de `EmbeddingLifecycleSnapshot` existem?**
   - 1 resolvedor puro canónico (`resolveEmbeddingLifecycle`), 1 adaptador puro (`adaptCurrentStateToLifecycleSnapshot`), 1 factory de controller (`buildEmbeddingWorkLifecycleSnapshot`), e o gateway central de runtime em `main.getEmbeddingLifecycleSnapshot()`.
2. **Quais são fontes factuais legítimas?**
   - `resolveEmbeddingLifecycle` e `main.getEmbeddingLifecycleSnapshot()`.
3. **Quais eram sintetizadores redundantes ou com valores fabricados?**
   - As ramificações de fallback com `"default-producer"`, `"mismatch-local"`, `"mismatch-configured"`, `"mismatch-provider"`, e injeção forçada de `"ollama"` / `768` em summaries desprovidos de configuração.
4. **Quantos foram removidos / saneados?**
   - 5 pontos no total foram integralmente saneados.
5. **Quais valores fabricados existiam?**
   - `"default-producer"`, `"default-model"`, `"mismatch-local"`, `"mismatch-model"`, `"mismatch-configured"`, `"mismatch-provider"`, `"default"` model/contractId em fallbacks cegos.
6. **Algum valor fabricado continua em runtime?**
   - Não.
7. **`DeviceRuntimeState` continua a ter responsabilidades legítimas?**
   - Sim, agrega a identidade local e o estado de autoridade do cluster sem duplicar o lifecycle.
8. **`adaptCurrentStateToLifecycleSnapshot()` continua necessário?**
   - Sim, como adaptador puramente factual conectando estruturas heterogéneas ao modelo canónico.
9. **Todos os consumidores usam o modelo canónico?**
   - Sim (Sidebar, Search, Worker, Scheduler, Diagnósticos).
10. **A pesquisa semântica mantém os contratos?**
    - Sim, validada integralmente através da suíte de testes de `VectorContractV1` e busca híbrida.
11. **Producer/Companion continuam isolados?**
    - Sim, autoridade de escrita restrita exclusivamente ao Active Producer.
12. **A LINA-15A continua protegida?**
    - Sim, fencing por epoch e asserção de autoridade intactos.
13. **A distinção da LINA-15C continua protegida?**
    - Sim, `resource-limit-exceeded` flui sem degradação para `unreadable`.
14. **Existe alguma dívida técnica que deve permanecer para uma fase futura?**
    - Não. Findings F-06 e F-07 resolvidos na íntegra.
