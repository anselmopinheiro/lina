# Relatório de Auditoria: LINA-15C — Separação entre Teto de Leitura JSONL e Corrupção Física em `INDETERMINATE`

**Identificador:** `LINA-15C-AUDIT-LARGE-CANONICAL-STATE-001`  
**Data:** 2026-10-01  
**Autor:** Arquiteto de Software Sénior & Engenheiro de Embeddings  
**Âmbito:** Auditoria técnica aprofundada do pipeline de leitura do ficheiro canónico JSONL (`embeddings.jsonl`), limites de recursos desktop/mobile do Bridge Read Guard, distinção semântica entre teto de capacidade e corrupção física, impacto em `updatePlan`, `EmbeddingLifecycleSnapshot`, `deriveEmbeddingWritePathDecision()`, Producer, Companion e Search.  
**Estado:** **AUDITORIA CONCLUÍDA — CORREÇÃO NECESSÁRIA (CLASSIFICAÇÃO B + D)**

---

## 1. Contexto e Finding de Origem (F-04)

A auditoria global pós-LINA-14 ([`docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md`](docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md), Finding F-04) identificou a seguinte anomalia operacional:

- Acima de aproximadamente **53,3 MB** de JSONL no desktop;
- Acima de aproximadamente **11,2 MB** de JSONL no mobile;

o subsistema de embeddings entra no estado:

```text
primary = "INDETERMINATE"
work.kind = "indeterminate"
action = "none"
canExecute = false
```

### O Problema Arquitetural
Quando o ficheiro canónico `embeddings.jsonl` ultrapassa o teto do Resource Guard:
1. O ficheiro é perfeitamente íntegro e válido;
2. No entanto, a recusa do Resource Guard marca `readability = "unreadable"`;
3. `calculateEmbeddingUpdatePlan` interpreta `"unreadable"` como falha indeterminada de leitura e define `mode = "indeterminate"`;
4. O `EmbeddingLifecycleSnapshot` assume `primary = "INDETERMINATE"`;
5. O motor de decisão (`deriveEmbeddingWritePathDecision`) bloqueia qualquer ação (`action = "none"`, `canExecute = false`);
6. `evaluateOperationStartGate` recusa arranque com motivo `"indeterminate"`.

**Consequência:** O Producer fica **preso num beco sem saída**. Não consegue atualizar incrementalmente (porque não pode ler o ficheiro em memória) e **não consegue reconstruir o índice (`full-rebuild`)**, mesmo que uma reconstrução completa nunca precise de ler os registos antigos e fosse simplesmente sobrepor o ficheiro com uma versão limpa! O utilizador é confrontado com uma indicação enganadora de que o índice está corrompido/indeterminado.

---

## 2. Mapeamento Completo do Pipeline de Leitura JSONL

```text
Ficheiro Físico (.lina/index/embeddings.jsonl)
    ↓
adapter.stat(embeddingsPath)
    ↓
evaluateEmbeddingBridgeRead(stat.size, resourceProfile)
    ├─ [Recusado por Limite de Recursos] ──► readability: "resource-limit-exceeded"
    └─ [Permitido] ────────────────────────► adapter.read(embeddingsPath)
                                                ↓
                                            split("\n") + JSON.parse por linha
                                                ├─ [Erro I/O ou Parse Falhado] ──► readability: "unreadable"
                                                ├─ [0 registos válidos] ─────────► readability: "empty"
                                                └─ [Registos carregados] ────────► readability: "readable"
                                                        ↓
                                            calculateEmbeddingUpdatePlan()
                                                        ↓
                                            adaptCurrentStateToLifecycleSnapshot()
                                                        ↓
                                            deriveEmbeddingWritePathDecision()
```

### 2.1 Análise Passo a Passo

1. **Abertura e Stat:**
   - Realizado via `app.vault.adapter.stat(".lina/index/embeddings.jsonl")`.
   - Se o ficheiro não existir (`stat === null` ou `stat.type !== "file"`), devolve `{ readability: "missing", records: [] }`.
   - Se ocorrer erro de I/O no `stat`, devolve `{ readability: "unreadable", records: [], error: msg }`.

2. **Avaliação pelo Resource Guard:**
   - [`src/index/embeddingResourceGuard.ts`](src/index/embeddingResourceGuard.ts): `evaluateEmbeddingBridgeRead(stat.size, profile)`.
   - Modela o pico de memória estimado ao transferir o ficheiro através da ponte IPC / carregamento de strings em memória.

3. **Leitura e Parsing Linha a Linha:**
   - `adapter.read()` carrega o texto integral.
   - Divisão por `\n` e `JSON.parse` linha a linha.
   - Linhas inválidas são filtradas como `undefined`.

4. **Identificação e Validação de Identidade:**
   - `readPublishedEmbeddingIdentity()` lê o `.lina/index/manifest.json`.
   - Valida provider, model, dimensions, inputVersion e prefixMode.

---

## 3. Análise Comparativa: Desktop vs Mobile

### 3.1 Parâmetros e Fórmulas do Resource Guard

A função `estimateCapacitorBridgePeakBytes` calcula o consumo de memória projetado:
$$\text{estimatedPeakBytes} = \text{fileBytes} \times \text{estimatedBridgeAmplification} + \text{fixedMarginBytes}$$

A decisão é permitida se e só se:
$$\text{fileBytes} \le \text{maxFileBytes} \quad \land \quad \text{estimatedPeakBytes} \le \text{maxEstimatedBridgePeakBytes}$$

### 3.2 Tabela Comparativa

| Plataforma | `maxFileBytes` | `amplification` | `fixedMarginBytes` | `maxEstimatedPeakBytes` | Teto Efetivo Calculado | Causa Real | Natureza |
|---|---:|---:|---:|---:|---:|---|---|
| **Desktop** (Electron / Node) | 96 MB | 3× | 32 MB | 192 MB | **$\approx$ 53,33 MB** $\left(\frac{192 - 32}{3}\right)$ | Sobrecarga de parsing JSON em memória V8 e strings duplicadas. | Limite deliberado de segurança operacional. |
| **Mobile** (Capacitor / WebKit / Android) | 12 MB | 5× | 8 MB | 64 MB | **11,20 MB** $\left(\frac{64 - 8}{5}\right)$ | Ponte IPC nativo-JS (Java/Obj-C $\to$ Base64/UTF-8 $\to$ WebKit JS string $\to$ JSON objects) retém múltiplas cópias em memória simultaneamente, arriscando OOM crash do processo WebView. | Limite deliberado de segurança operacional. |

### 3.3 Conclusão da Análise Desktop vs Mobile
Os tetos de **53,33 MB** e **11,20 MB** são **limites deliberados de proteção contra Out-Of-Memory (OOM)**, calculados matematicamente pelos guards. **Não devem ser aumentados cegamente** sem um mecanismo de streaming / binário, porque a arquitetura móvel do Capacitor não tolera alocações superiores a 64 MB na ponte IPC sem risco de encerramento forçado da aplicação pelo sistema operativo.

---

## 4. Matriz de Classificação de Casos

| Caso | Estado Físico | Readability Canónica | Modo de `updatePlan` | Snapshot Primary | Decisão Write Path | `canExecute` | `requiresConfirmation` |
|---|---|---|---|---|---|---|---|
| **1. JSONL pequeno e válido** | Válido ($\le$ teto) | `readable` | `incremental` | `READY` ou `UPDATE_AVAILABLE` | `update` / `none` | `true` (se houver chunks) | `false` |
| **2. JSONL grande e válido** | Válido (> teto) | `resource-limit-exceeded` | `full-rebuild` | `INCOMPATIBLE` | `rebuild` | **`true`** | **`true`** |
| **3. JSONL truncado / I/O quebrado** | Corrompido / Ilegível | `unreadable` | `indeterminate` | `INDETERMINATE` | `none` | `false` | N/A |
| **4. Linha JSON inválida** | Parse falhou na linha | `readable` (linhas válidas) ou `unreadable` | `full-rebuild` (se inválidos detetados) | `INCOMPATIBLE` | `rebuild` | `true` | `true` |
| **5. Identidade incompatível** | Válido mas outro modelo | `readable` | `full-rebuild` | `INCOMPATIBLE` | `rebuild` | `true` | `true` |
| **6. Identidade mista** | Válido com múltiplos modelos | `readable` | `full-rebuild` | `INCOMPATIBLE` | `rebuild` | `true` | `true` |
| **7. Ficheiro inexistente** | Não existe | `missing` | `initial-build` | `INDEX_ONLY` | `generate` | `true` | `false` |
| **8. Ficheiro vazio (0 bytes)** | Vazio | `empty` | `initial-build` | `INDEX_ONLY` | `generate` | `true` | `false` |

---

## 5. Causa-Raiz do Finding F-04 e Reconciliação Necessária

### 5.1 Onde Ocorre a Conflitualidade Semântica
Em [`src/index/embeddingGenerator.ts`](src/index/embeddingGenerator.ts) (linhas 330–338):
```typescript
const bridgeDecision = evaluateEmbeddingBridgeRead(stat.size, resourceProfile);
if (!bridgeDecision.allowed) {
  return {
    readability: "unreadable", // <--- ERRO: mistura teto de recursos com corrupção física!
    records: [],
    resourceLimitCode: bridgeDecision.code,
    error: bridgeDecision.code,
  };
}
```

E em [`src/index/embeddingUpdatePlan.ts`](src/index/embeddingUpdatePlan.ts) (linhas 12–13 e 267–270):
```typescript
export type CanonicalEmbeddingReadability = "missing" | "empty" | "readable" | "unreadable";
...
} else if (canonicalReadability === "unreadable") {
  mode = "indeterminate";
  addReason(reasons, "canonical-unreadable");
}
```

### 5.2 Semântica Correta
1. Distinguir o tipo de legibilidade:
   ```typescript
   export type CanonicalEmbeddingReadability =
     | "missing"
     | "empty"
     | "readable"
     | "unreadable"
     | "resource-limit-exceeded";
   ```
2. Quando `readability === "resource-limit-exceeded"`:
   - O planeador `calculateEmbeddingUpdatePlan` **NÃO** deve entrar em `mode = "indeterminate"`.
   - Deve entrar em **`mode = "full-rebuild"`** com razão **`"canonical-resource-limit-exceeded"`**!
   - `reusableCanonicalCount = 0` (porque os registos não podem ser lidos para diffing incremental).
   - `toGenerateCount = totalChunks` (reconstrução completa de todos os chunks existentes).
   - O lifecycle model resolve para **`primary = "INCOMPATIBLE"`** (ou `UPDATE_AVAILABLE` com `full-rebuild`, que LINA-15B mapeia estritamente para `INCOMPATIBLE`).
   - A decisão do Write Path resulta em:
     ```typescript
     action: "rebuild",
     canExecute: true,
     requiresConfirmation: true
     ```
   - O Scheduler bloqueia despacho automático em background (`confirmation-required`).
   - O Producer / utilizador na UI pode acionar a reconstrução completa com confirmação!
   - O Worker gera os embeddings de todos os chunks e grava o novo ficheiro canónico atomicamente via staging `.tmp`, sem nunca precisar de ler os registos antigos.

---

## 6. Segurança e Invariantes

1. **Incerteza Real Permanece Bloqueante:**
   - Erros reais de I/O ou ficheiros fisicamente ilegíveis continuam com `readability = "unreadable"`, produzindo `mode = "indeterminate"`, `primary = "INDETERMINATE"`, `action = "none"` e `canExecute = false`.
2. **Ownership e Fencing (LINA-15A):**
   - A validação de `{ deviceId, epoch }` e `assertCurrent()` na publicação canónica mantém-se estrita e intocada.
3. **Reconciliação Lifecycle (LINA-15B):**
   - O modo `full-rebuild` continua a exigir confirmação explícita e a impedir despacho automático silencioso.
4. **Proteção contra OOM:**
   - O Resource Guard continua a impedir que ficheiros acima de 53,3 MB (desktop) ou 11,2 MB (mobile) sejam lidos para memória JavaScript.

---

## 7. Decisão e Plano de Ação

- **Classificação:** **B (Limite legítimo, mas semanticamente mal representado)** + **D (Solução arquitetural limpa no planeador e lifecycle)**.
- **Não aumentar limites arbitrariamente:** Os limites numéricos de 53,3 MB e 11,2 MB são válidos e protegem contra falhas de processo no Capacitor e Node.
- **Passos de Implementação:**
  1. Expandir `CanonicalEmbeddingReadability` em `embeddingUpdatePlan.ts`, `embeddingGenerator.ts`, `embeddingLifecycleModel.ts`, `embeddingLifecycleAdapter.ts`, `embeddingWorkStatusController.ts` para incluir `"resource-limit-exceeded"`.
  2. Adicionar razão `"canonical-resource-limit-exceeded"` a `EmbeddingUpdatePlanReason`.
  3. No `embeddingGenerator.ts` (`readCanonicalEmbeddingFileState`), quando `!bridgeDecision.allowed`, devolver `readability: "resource-limit-exceeded"`.
  4. No `calculateEmbeddingUpdatePlan`, tratar `canonicalReadability === "resource-limit-exceeded"` como `mode = "full-rebuild"`, `reusableCanonicalRecords = []`, `reasons = ["canonical-resource-limit-exceeded"]`.
  5. No `classifyEmbeddingWork` e `embeddingLifecycleModel.ts`, garantir que `"resource-limit-exceeded"` é classificado como trabalho pendente em `full-rebuild` com `severity = "blocking"`.
  6. Criar suite de testes de caracterização reproduzindo todos os 10 cenários da secção 9 do prompt.
  7. Validar todas as suites de testes, types, lint e release-check.
