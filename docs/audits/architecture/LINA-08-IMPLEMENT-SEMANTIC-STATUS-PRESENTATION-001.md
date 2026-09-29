# LINA-08-IMPLEMENT-SEMANTIC-STATUS-PRESENTATION-001

## Implementação da Coerência Final entre Capacidade Semântica, Proveniência e Apresentação do Estado no Lina

**Data:** 29 de Setembro de 2026
**Papel:** Arquiteto de Software Sénior e Engenheiro TypeScript/Obsidian
**Estado:** Concluído
**Tipo:** Implementação Arquitetural e UX (Alinhamento de Apresentação e Prioridade Canónica)
**Documento de Auditoria Prévia:** [`docs/audits/architecture/LINA-08-AUDIT-SEMANTIC-STATUS-PRESENTATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-08-AUDIT-SEMANTIC-STATUS-PRESENTATION-001.md)

---

# 1. Problemas corrigidos

### Problema A — Badge pejorativo "Desatualizado" em artefactos válidos
- **Diagnóstico:** Em [`src/device/artifactProvenanceValidation.ts`](file:///d:/_dev/obsidian/lina/src/device/artifactProvenanceValidation.ts), qualquer artefacto com proveniência de uma época anterior (`producerEpoch < ownershipEpoch`) era avaliado internamente como `status: "stale"`. No modal de diagnóstico ([`src/device/deviceDiagnosticsModal.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts)), este estado era traduzido para a badge com aviso amarelo `⚠ Desatualizado` e a mensagem `Desatualizado (época 1 vs época ativa 3)`. Isto induzia o utilizador em erro, fazendo-o crer que o índice estava corrompido ou requeria regeneração urgente.
- **Correção:** O modal de diagnóstico passou a tratar artefactos de época anterior com apresentação neutra:
  - Badge: `✓ Válido` (em estilo neutro com contorno, sem aviso amarelo/laranja).
  - Proveniência: `Época anterior ({epoch} vs época ativa {activeEpoch})`.
  - A mensagem técnica em `formatArtifactProvenanceDiagnostic` passou a registar `Época anterior` em vez de `Desatualizado`.

### Problema B — Sidebar apresentava "Estado desconhecido" em coexistência com "Pesquisa híbrida disponível"
- **Diagnóstico:** A Sidebar calculava o estado de frescura dos embeddings através de múltiplos canais concorrentes. Quando o ficheiro de heartbeat de produtor no cofre (`.lina/producer-state.json`) não existia, a avaliação em `companionConsumptionState.ts` devolvia `embeddingFreshness: "unknown"`. Como qualquer string não-vazia é truthy, [`sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts) fixava `embeddingsStatus = "unknown"`, ignorando o `runtimeEmbeddings` que já estava `ready` e disponível. Em paralelo, o estado inicial transitório ou em debounce do `EmbeddingWorkStatusController` (`status: "unknown"`) fazia com que [`linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts) ativasse `embeddingsChecking = true`, forçando o texto `Estado desconhecido`.
- **Correção:** Foi implementada a **Regra Canónica de Prioridade de Estado** em `sidebarStatusViewModel.ts` e uma salvaguarda em `linaSearchView.ts`. Quando a capacidade operacional semântica está confirmada (`semanticAvailable === true`), sensores secundários de trabalho ou ausência de heartbeat de produtor são estritamente impedidos de sobrepor-se ao motor de pesquisa, apresentando sempre `Atualizado` ou o tempo relativo real.

### Problema C — Ação "Atualizar embeddings" sem drift
- **Diagnóstico:** Quando o cofre tem vetores válidos e sem alterações nas notas, o planeador conclui que há 0 chunks a gerar.
- **Correção e Preservação:** Preservou-se integralmente a resposta `"Os embeddings já se encontram atualizados."`, sem mutações em disco, sem regeneração forçada e sem falsificação da proveniência histórica.

---

# 2. Regra final de proveniência

A proveniência é factual e imutável:

$$\text{provenance.stale} \neq \text{semantic unavailable}$$

1. Um avanço de época de ownership (`ownership.epoch`) no cofre é um evento do plano de controlo (*control plane*).
2. Não representa drift de dados (*data plane drift*).
3. Não invalida vetores matematicamente compatíveis já publicados.
4. Mutações da posse do cofre não exigem nem autorizam:
   - Regeneração de embeddings;
   - Republicação de manifestos apenas para alterar o carimbo de época;
   - Falsificação do dispositivo produtor original.
5. Na interface, artefactos com proveniência de épocas anteriores que continuem utilizáveis são categorizados como **Válido (Época anterior)** com proveniência histórica factual neutra.

---

# 3. Regra final de prioridade de estado

A resolução do estado visual e operacional na interface do Lina obedece rigorosamente à seguinte hierarquia:

$$\text{DeviceRuntimeState.embeddings.semanticAvailable} > \text{runtime readiness} > \text{work-status transitório} > \text{heartbeat/freshness secundário}$$

### Invariante Absoluto
Se:
$$\texttt{semanticAvailable} === \text{true}$$

É **terminantemente proibido** apresentar:
- `Estado desconhecido`
- `Embeddings indisponíveis`
- `Pesquisa semântica indisponível`

Se o tempo de atualização estiver disponível no manifesto, a linha de embeddings exibe `Atualizado (há X)`; caso contrário, exibe `Atualizado`. Se o sensor em background estiver a calcular diffs de notas, esse cálculo transitório não afeta a disponibilidade imediata já confirmada em memória.

---

# 4. Superfícies migradas

1. **[`src/device/artifactProvenanceValidation.ts`](file:///d:/_dev/obsidian/lina/src/device/artifactProvenanceValidation.ts):**
   - Atualizado `formatArtifactProvenanceDiagnostic` para emitir `"Época anterior"` em vez de `"Desatualizado"`.
2. **[`src/i18n/strings.ts`](file:///d:/_dev/obsidian/lina/src/i18n/strings.ts):**
   - Atualizadas as chaves `deviceDiagnosticsProvStaleMismatch` e `deviceDiagnosticsProvStaleEpoch` (em português e inglês) para refletirem `Época anterior` / `Prior epoch`.
3. **[`src/device/deviceDiagnosticsModal.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts):**
   - `getStatusBadgeText`: Mapeia `case "stale"` para `this.L.deviceDiagnosticsBadgeValid` (`"✓ Válido"`).
   - `getStatusBadgeStyle`: Mapeia `case "stale"` para estilo neutro com contorno (`var(--background-modifier-border)`), eliminando o aviso amarelo (`var(--background-modifier-warning)`).
4. **[`src/search/sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts):**
   - Implementada a verificação `isOperational` baseada em `runtimeEmbeddings?.semanticAvailable ?? (semanticAvailable && embeddingsReady)`.
   - Garantido que quando `isOperational` é verdadeiro, `embeddingsStatus` é resolvido para `fresh` (ou relativo baseado em timestamp), ignorando retornos espúrios de `"unknown"` provenientes de heartbeats ausentes.
   - `effectiveChecking` passa a ser suprimido quando a prontidão operacional já se encontra ativa.
5. **[`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts):**
   - Salvaguardado `embeddingsChecking` para não assinalar verificação quando `runtimeState.embeddings.semanticAvailable` já é verdadeiro.

---

# 5. Testes adicionados e alterados

### Testes Alterados
- **[`tests/device/artifactProvenanceValidation.test.ts`](file:///d:/_dev/obsidian/lina/tests/device/artifactProvenanceValidation.test.ts):**
  - Atualizada a asserção diagnóstica de `stale` para verificar a presença de `"Época anterior"`.
- **[`tests/device/deviceDiagnosticsModal.test.ts`](file:///d:/_dev/obsidian/lina/tests/device/deviceDiagnosticsModal.test.ts):**
  - Atualizadas as asserções em pt-PT e en para validarem a badge `✓ Válido` e o texto explicativo de `Época anterior` para o artefacto canónico com época anterior.

### Testes Adicionados
- **[`tests/device/deviceDiagnostics.test.ts`](file:///d:/_dev/obsidian/lina/tests/device/deviceDiagnostics.test.ts):**
  - Adicionado teste específico verificando que artefactos com epoch anterior produzem `diagnosticMessage` com `"Época anterior"` e sem o termo `"Desatualizado"`.
- **[`tests/search/sidebarStatusUX.test.ts`](file:///d:/_dev/obsidian/lina/tests/search/sidebarStatusUX.test.ts):**
  - Adicionado bloco de testes dedicado `LINA-08: Canonical Priority & Semantic Status Presentation`:
    - **Cenário 1:** Embeddings com proveniência de época anterior e sem heartbeat de produtor no cofre nunca produzem `"Estado desconhecido"` e mantêm `Pesquisa híbrida disponível`.
    - **Cenário 3:** Contrato incompatível degrada deterministicamente para modo textual com status `stale`.
    - **Cenário 4:** Artefacto ausente reporta `missing` (`Não gerado`) e modo textual sem alarmismo.
    - **Cenário 5:** Estado de verificação ativo exibe texto explícito `A verificar...`, nunca `Estado desconhecido`.

---

# 6. Validações técnicas executadas

Todas as validações obrigatórias foram executadas e passaram sem erros:

| Comando | Resultado | Notas |
| :--- | :--- | :--- |
| `npm test` | **PASSOU** | 123 ficheiros de teste, 1662 testes passaram a 100%. |
| `npm run typecheck` | **PASSOU** | `tsc --noEmit` sem qualquer erro de tipos. |
| `npm run lint:obsidian:strict` | **PASSOU** | 0 erros, 0 avisos em todo o repositório. |
| `npm run build` | **PASSOU** | Build de produção esbuild e cópia para o vault de testes concluídos. |
| `npm run release-check` | **PASSOU** | Validação de manifesto e arquivos de release conforme. |
| `git diff --check` | **PASSOU** | Sem conflitos de whitespace ou marcadores residuais. |

---

# 7. Riscos residuais

- **Risco:** Confusão de utilizadores que esperavam ver a época atual em todos os nós do cofre.
  *Mitigação:* O painel de diagnóstico detalha explicitamente a época de criação do artefacto vs a época ativa do cofre, explicando que a proveniência reflete a autoria original dos vetores.
- **Risco:** Regressão na deteção de notas alteradas pelo utilizador.
  *Mitigação:* A frescura do conteúdo continua desacoplada da proveniência da época. Quando uma nota é editada, o `toGenerateCount` deteta imediatamente os chunks pendentes sem interferência da proveniência histórica.

---

# 8. Confirmação de invariantes arquiteturais

- **Zero alterações de schemas:** Nenhuma alteração a schemas JSON ou estruturas de dados em disco.
- **Zero alterações de contratos:** `VectorContractV1` mantido estritamente imutável.
- **Zero mutações de persistência:** Nenhuma migração criada, nenhum artefacto persistente novo, zero escritas espúrias induzidas por leitura.
- **Zero falsificação de proveniência:** A proveniência histórica permanece íntegra e factual.
