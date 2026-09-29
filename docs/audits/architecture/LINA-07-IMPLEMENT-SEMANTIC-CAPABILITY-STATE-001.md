# LINA-07-IMPLEMENT-SEMANTIC-CAPABILITY-STATE-001

## Implementação da Camada Canónica de Capacidade Semântica

**Data:** 28 de Setembro de 2026
**Papel:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian
**Estado:** Concluído com Sucesso
**Rastreabilidade:**
- Auditoria de Estado de Dispositivo: `LINA-06-AUDIT-DEVICE-STATE-CONSISTENCY-001`
- Implementação de Estado Runtime: `LINA-06-IMPLEMENT-DEVICE-RUNTIME-STATE-001`
- Auditoria de Consistência Semântica: `LINA-07-AUDIT-SEMANTIC-CAPABILITY-CONSISTENCY-001`

---

# 1. Resumo da Implementação

Esta tarefa eliminou as divergências entre **Sidebar Status, Search, Diagnostics e DeviceRuntimeState**, unificando a avaliação da pesquisa semântica numa fonte única de verdade em memória.

Anteriormente, cada superfície da interface executava avaliações isoladas de manifestos em disco, timers com debounce de 250ms e proveniência de épocas, resultando em contradições como "Modo Completo (Texto + Vetores)" apresentado em simultâneo com "Embeddings indisponíveis", ou "Estado desconhecido" na Sidebar.

Com esta implementação:
1. O **`DeviceRuntimeEmbeddingsState`** foi enriquecido para estruturar explicitamente:
   - **`exists`**: Existência física do artefacto no cofre.
   - **`provenance`**: `{ epoch, producerId, stale }` (auditável e não-bloqueante para a pesquisa).
   - **`compatibility`**: `{ provider, model, dimensions, compatible }` (contrato vetorial).
   - **`readiness`**: `{ loaded, runtimeReady }` (prontidão do runtime local).
   - **`semanticAvailable`** e **`effectiveMode`**: Decisão final e unificada de capacidade operacional.
2. Todas as superfícies de interface (Sidebar, Search View, Diagnostics Modal) foram migradas para consumir diretamente esta representação consolidada.
3. Ficou formalmente consagrado o invariante de que **proveniência não é disponibilidade**: uma época desatualizada (`provenance.stale === true`, e.g. época 1 vs época ativa 3) **não** desativa a pesquisa semântica se o contrato for compatível e os ficheiros existirem.

---

# 2. Arquitetura Implementada

### Fluxo Canónico Unidirecional

```text
  .lina/ownership.json + .lina/devices/<id>.json + text-manifest.json + chunks.jsonl
                                ↓
               getSemanticSearchAvailability()
                                ↓
                    resolveDeviceRuntimeState()
                                ↓
              DeviceRuntimeState.embeddings (Fonte Única)
              ├── exists
              ├── provenance { epoch, producerId, stale }
              ├── compatibility { provider, model, dimensions, compatible }
              ├── readiness { loaded, runtimeReady }
              ├── semanticAvailable (boolean)
              └── effectiveMode ("full" | "text-only" | "unavailable")
                                ↓
       ┌────────────────────────┼────────────────────────┐
       ↓                        ↓                        ↓
  Sidebar UX            Diagnostics Modal           Search View
(LinaSearchView)     (DeviceDiagnosticsModal)    (runSemanticSearch)
```

### Contrato de Dados Runtime

```typescript
export interface DeviceRuntimeEmbeddingsProvenance {
  readonly epoch?: number;
  readonly producerId?: string;
  readonly stale: boolean;
}

export interface DeviceRuntimeEmbeddingsCompatibility {
  readonly provider?: string;
  readonly model?: string;
  readonly dimensions?: number;
  readonly compatible: boolean;
}

export interface DeviceRuntimeEmbeddingsReadiness {
  readonly loaded: boolean;
  readonly runtimeReady: boolean;
}

export interface DeviceRuntimeEmbeddingsState {
  readonly configured: boolean;
  readonly textIndexAvailable: boolean;
  readonly embeddingsDeclared: boolean;

  // 1. Existência física no vault
  readonly exists: boolean;
  readonly vectorFileState: "available" | "missing" | "empty" | "invalid";

  // 2. Proveniência (metadados do artefacto vs ownership)
  readonly provenance: DeviceRuntimeEmbeddingsProvenance;

  // 3. Compatibilidade do contrato vetorial
  readonly compatibility: DeviceRuntimeEmbeddingsCompatibility;
  readonly contractState: "compatible" | "mismatch" | "none";

  // 4. Prontidão operacional do runtime local
  readonly readiness: DeviceRuntimeEmbeddingsReadiness;
  readonly runtimeState: "ready" | "checking" | "unavailable";

  // 5. Disponibilidade semântica e modo efetivo
  readonly semanticAvailable: boolean;
  readonly effectiveMode: "full" | "text-only" | "unavailable";
  readonly reasonCode?: SemanticOperationalReasonCode;
  readonly reason?: string;
}
```

---

# 3. Fonte Única de Decisão

A autoridade técnica sobre se a pesquisa semântica pode ser executada no dispositivo local é:

```typescript
getSemanticSearchAvailability(app, provider, model)
```

em `src/search/hybridSearch.ts`.

Esta função:
1. Valida a identidade de prefixo e dimensões do modelo.
2. Compara o provider e modelo configurados com os publicados.
3. Verifica se os chunks contêm vetores válidos em disco ou no índice runtime em memória (`RuntimeEmbeddingIndex`).

O resultado alimenta o planeador puro `resolveDeviceRuntimeState()`, gerando o nó imutável `deviceRuntimeState.embeddings`.

---

# 4. Consumidores Migrados

### 1. Sidebar Status (`src/search/sidebarStatusViewModel.ts`)
- **Eliminação de decisões próprias:** Passou a receber o nó `runtimeEmbeddings: DeviceRuntimeEmbeddingsState`.
- **Eliminação do "Estado desconhecido":**
  - Durante o carregamento assíncrono ou verificação (`runtimeState: "checking"`), exibe `"A verificar..."` em vez de `"Estado desconhecido"`.
  - Se os embeddings existem e são compatíveis, exibe `"Recente"`.
  - Se o contrato não coincide, exibe alerta específico de divergência de contrato (`vector-mismatch`).
- **Eliminação de fallback contraditório:** O modo híbrido passa a adotar estritamente `runtimeEmbeddings.effectiveMode`.

### 2. Diagnostics Modal (`src/device/deviceDiagnosticsModal.ts`)
- **Separação entre auditoria histórica e capacidade operacional:**
  - A grelha de capacidade de pesquisa do Companion consome preferencialmente `diagnostics.runtime.embeddings`.
  - O modo apresentado é `runtimeEmbeddings.effectiveMode`. É impossível exibir "Pesquisa Completa" quando `semanticAvailable` for `false`.
  - A indicação de artefactos distingue se os embeddings existem fisicamente (`runtimeEmbeddings.exists`) da capacidade operacional.
  - A secção de artefactos publicados continua a exibir a proveniência detalhada (`Desatualizado: época 1 vs época ativa 3`) para fins de auditoria, sem que isso invalide o modo operacional.

### 3. Search View (`src/search/linaSearchView.ts`)
- **Sidebar UX:** Injeta `runtimeState.embeddings` diretamente no construtor do view model.
- **Execução de Pesquisa Semântica (`runSemanticSearchGrouped`):** Valida `runtimeState.embeddings.semanticAvailable` antes de prosseguir. Se indisponível, apresenta imediatamente o motivo canónico (`runtimeState.embeddings.reason`) ao utilizador.

### 4. EmbeddingWorkStatusController
- Mantém o seu papel estrito de coordenação de operações em segundo plano (progresso de reconstrução, cancelamento e agendamento).
- Deixou de ser utilizado pelas vistas como árbitro da disponibilidade funcional da pesquisa semântica.

---

# 5. Cobertura de Testes

Foram implementados testes de unidade rigorosos em `tests/device/deviceRuntimeState.test.ts` cobrindo todos os cenários obrigatórios:

| Caso | Cenário | Expectativa | Resultado |
| :--- | :--- | :--- | :--- |
| **Caso 1** | Embeddings existentes, mesma época | `semanticAvailable: true`, `provenance.stale: false`, `effectiveMode: "full"` | APROVADO |
| **Caso 2** | Embeddings de época anterior (e.g. época 1 vs época ativa 3) | `semanticAvailable: true`, `provenance.stale: true`, `effectiveMode: "full"` | APROVADO |
| **Caso 3** | Provider ou modelo incompatível | `semanticAvailable: false`, `compatibility.compatible: false`, `reasonCode: "model-incompatible"` | APROVADO |
| **Caso 4** | Embeddings inexistentes no manifesto e disco | `semanticAvailable: false`, `exists: false`, `reasonCode: "vector-file-missing"` | APROVADO |
| **Caso 5** | Primeiro arranque e verificação inicial | Exibe `"A verificar..."` em checking; transita para `"Recente"` e modo `"full"` quando pronto, sem estado `"unknown"` permanente | APROVADO |

Além dos testes unitários novos, toda a suíte de regressão do projeto foi executada:
- **123 ficheiros de teste** passaram com sucesso.
- **1657 testes** aprovados.

---

# 6. Validação e Qualidade

- `npm test`: 123 ficheiros / 1657 testes aprovados.
- `npm run typecheck`: 0 erros de compilação TypeScript.
- `npm run lint:obsidian:strict`: 0 erros e 0 avisos no ESLint strict.
- `npm run build`: bundle de produção gerado com sucesso.
- `git diff --check`: 0 erros de formatação ou whitespace.
- `git branch --show-current`: branch `master`.

---

# 7. Riscos Residuais e Mitigações

1. **Latência de Inicialização no Dispositivo Móvel:**
   - *Risco:* Em dispositivos mais lentos, `getSemanticSearchAvailability()` pode demorar alguns milissegundos a ler ficheiros de índice.
   - *Mitigação:* O estado `runtimeState: "checking"` garante que a interface permanece responsiva e em modo `text-only` até à confirmação dos vetores, sem congelar a UI nem exibir mensagens de erro enganosas.
2. **Sincronização em Curso:**
   - *Risco:* Chegada assíncrona de novos ficheiros de cofre via Obsidian Sync durante a utilização.
   - *Mitigação:* Os event listeners do cofre re-executam `refreshDeviceRuntimeState()`, que recalcula o `DeviceRuntimeState.embeddings` de forma atómica e idempotente.
