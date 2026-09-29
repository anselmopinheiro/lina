# LINA-10-AUDIT-DIAGNOSTICS-SEMANTIC-PARITY-001

## 1. Resumo Executivo

Esta auditoria arquitetural analisa a divergência observada no painel de Diagnóstico do Lina, onde a interface apresenta em simultâneo:
- **Capacidade Operacional:** `Estado: Disponível` e `Modo de pesquisa: Pesquisa Completa (Texto + Vetores)`;
- **Linha de Artefactos da Capacidade:** `Artefactos: Índice textual disponível • Embeddings indisponíveis`;
- **Cartões de Artefactos:** `Embeddings canónicos (JSONL) ✓ Válido` e `Cópia binária de embeddings ✓ Válido`, com proveniência `Época anterior (época 1 vs época ativa 3)`;
- **Assimetria Visual:** O badge do índice textual surge com fundo verde de sucesso, enquanto os badges `✓ Válido` dos embeddings surgem a cinzento neutro.

### Respostas inequívocas às questões centrais da auditoria:

1. **Porque a linha `Artefactos:` ainda apresenta `Embeddings indisponíveis` quando `semanticAvailable === true`?**
   Na função `onOpen()` de [deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L276), a variável `hasEmbeddings` é calculada através de `runtimeEmbeddings ? runtimeEmbeddings.exists : this.diagnostics.companionSearch.embeddingsAvailable`. Esta propriedade `.exists` **não reflete a disponibilidade operacional semântica**, mas sim a existência física combinada com `embeddingsDeclared` de [deviceRuntimeState.ts](file:///d:/_dev/obsidian/lina/src/device/deviceRuntimeState.ts#L239-L240). O cálculo de `embeddingsDeclared` baseia-se em `companionState.artifactAvailability.embeddings === "available"`. Quando o índice textual sofre reindexação ou alteração de época, `manifestGenId !== embeddingSourceGenId`, fazendo com que `evaluateCompanionConsumptionState()` classifique os embeddings como `"invalid"`, resultando em `exists: false` e no fallback `companionSearch.embeddingsAvailable: false`. Consequentemente, a linha ignora por completo `DeviceRuntimeState.embeddings.semanticAvailable === true`.

2. **Porque um artefacto `valid + prior epoch` não recebe o mesmo badge verde de qualquer outro artefacto válido?**
   Existe uma regra explícita e assimétrica em [deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L521-L533). No ciclo de refatoração LINA-08, a função `getStatusBadgeText()` foi atualizada para devolver o texto positivo `this.L.deviceDiagnosticsBadgeValid` (`"✓ Válido"`) tanto para `"valid"` como para `"stale"`. No entanto, a função complementar `getStatusBadgeStyle()` **não foi atualizada**, mantendo `case "stale": return "background-color: var(--background-modifier-border); color: var(--text-normal);";` (estilo neutro/cinzento), enquanto `case "valid"` utiliza `background-color: var(--background-modifier-success); color: var(--text-on-accent);` (verde). Como os embeddings têm proveniência de época anterior (`epoch 1` vs `epoch 3`), o validador atribui-lhes `status: "stale"`, fazendo com que recebam o badge cinzento apesar de apresentarem o texto `"✓ Válido"`.

---

## 2. Origem da Linha “Artefactos”

### 2.1 Mapeamento do Código
- **Ficheiro:** [src/device/deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L272-L289)
- **Função:** `onOpen()`
- **Linhas exatas:** 272 a 289

```typescript
// Artifacts (reflects published artifacts)
compGrid.createDiv({ text: this.L.deviceDiagnosticsCompanionArtifactsLabel, attr: { style: "font-weight: bold;" } });
const artifactsList = [];
const hasTextIndex = runtimeEmbeddings ? runtimeEmbeddings.textIndexAvailable : this.diagnostics.companionSearch.textIndexAvailable;
const hasEmbeddings = runtimeEmbeddings ? runtimeEmbeddings.exists : this.diagnostics.companionSearch.embeddingsAvailable;

if (hasTextIndex) {
  artifactsList.push(this.L.deviceDiagnosticsCompanionTextIndexAvailable);
} else {
  artifactsList.push(this.L.deviceDiagnosticsCompanionTextIndexMissing);
}
if (hasEmbeddings) {
  artifactsList.push(this.L.deviceDiagnosticsCompanionEmbeddingsAvailable);
} else {
  artifactsList.push(this.L.deviceDiagnosticsCompanionEmbeddingsMissing);
}
compGrid.createDiv({ text: artifactsList.join(" • ") });
```

### 2.2 Cadeia de Dados e Condições
1. **Fonte primária avaliada:** `runtimeEmbeddings.exists` (onde `runtimeEmbeddings = this.diagnostics.runtime?.embeddings`).
2. **Fonte de fallback:** `this.diagnostics.companionSearch.embeddingsAvailable`.
3. **Condição de exibição:** Se `hasEmbeddings` for verdadeiro, injeta `deviceDiagnosticsCompanionEmbeddingsAvailable` (`"Embeddings disponíveis"`). Caso contrário, injeta `deviceDiagnosticsCompanionEmbeddingsMissing` (`"Embeddings indisponíveis"`).

### 2.3 Porque esta linha não respeita `DeviceRuntimeState.embeddings.semanticAvailable === true`?
A propriedade `semanticAvailable` reflete a capacidade real de executar pesquisa semântica no dispositivo (vetores carregáveis em memória ou binário compatível com o provider/modelo ativo, validados por `getSemanticSearchAvailability()` em [hybridSearch.ts](file:///d:/_dev/obsidian/lina/src/search/hybridSearch.ts#L90)).

Contudo, `deviceDiagnosticsModal.ts` não consulta `runtimeEmbeddings.semanticAvailable`. Em vez disso, consulta `runtimeEmbeddings.exists`.

Ao inspecionar a construção de `exists` em [src/device/deviceRuntimeState.ts](file:///d:/_dev/obsidian/lina/src/device/deviceRuntimeState.ts#L239-L240):
```typescript
const exists = (embeddingsDeclared || companionState.artifactAvailability.binaryCopy === "available")
  && semanticCap.artifactState.vectorFile !== "missing";
```
Verifica-se que:
1. `embeddingsDeclared` vem de `companionState.artifactAvailability.embeddings === "available"` ([deviceRuntimeState.ts:217](file:///d:/_dev/obsidian/lina/src/device/deviceRuntimeState.ts#L217)).
2. Em [src/companion/companionConsumptionState.ts](file:///d:/_dev/obsidian/lina/src/companion/companionConsumptionState.ts#L347-L350), existe a validação de sincronização:
   ```typescript
   if (manifestGenId && embeddingSourceGenId && manifestGenId !== embeddingSourceGenId) {
     embeddingGenerationMismatch = true;
     embeddingsAvailability = "invalid";
   }
   ```
   Quando o índice textual é reconstruído ou atualizado num dispositivo (gerando um novo `generationId` no manifesto de texto), o `sourceTextGenerationId` guardado no bloco de embeddings deixa de coincidir. `companionConsumptionState` marca imediatamente `embeddingsAvailability = "invalid"`.
3. Como `embeddingsAvailability` não é `"available"`, `embeddingsDeclared` torna-se `false`. Se a cópia binária não estiver presente ou estiver em formato JSONL canónico, `(false || false)` resulta em `exists = false`.
4. O fallback `this.diagnostics.companionSearch.embeddingsAvailable` em [deviceDiagnostics.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnostics.ts#L401) recebe exatamente o mesmo valor `embeddingsDeclared` (`false`).
5. Deste modo, mesmo com vetores perfeitamente válidos e utilizáveis (`semanticAvailable: true`), `hasEmbeddings` avalia para `false`, produzindo a string incongruente `Embeddings indisponíveis`.

---

## 3. Fontes Usadas no Bloco Search Capability

O bloco de Diagnóstico "Capacidade de Pesquisa" ([deviceDiagnosticsModal.ts:233-298](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L233-L298)) é composto por quatro campos tabulares. A matriz abaixo compara a fonte atual com a fonte canónica aprovada:

| Campo | Rótulo UI | Fonte atual no código | Fonte canónica correta | Diagnóstico de Paridade |
|---|---|---|---|---|
| **Estado** | `Estado:` | `runtimeEmbeddings ? (runtimeEmbeddings.effectiveMode !== "unavailable") : companionSearch.available` | `DeviceRuntimeState.embeddings.effectiveMode !== "unavailable"` (ou `semanticAvailable \|\| textIndexAvailable`) | **Parcialmente correto.** Consome `effectiveMode` quando `runtimeEmbeddings` está definido. |
| **Modo de pesquisa** | `Modo de pesquisa:` | `runtimeEmbeddings?.effectiveMode ?? companionSearch.operationalMode ?? companionSearch.mode` | `DeviceRuntimeState.embeddings.effectiveMode` | **Correto.** Prioriza `DeviceRuntimeState.embeddings.effectiveMode`. |
| **Artefactos** | `Artefactos:` | `hasTextIndex`: `runtimeEmbeddings.textIndexAvailable`<br>`hasEmbeddings`: `runtimeEmbeddings.exists` (fallback `companionSearch.embeddingsAvailable`) | `hasTextIndex`: `DeviceRuntimeState.embeddings.textIndexAvailable`<br>`hasEmbeddings`: `DeviceRuntimeState.embeddings.semanticAvailable` | **Incoerente / Divergente.** Utiliza `.exists` contaminado por `companionConsumptionState` em vez da disponibilidade operacional semântica unificada. |
| **Observações** | `Observações:` | `runtimeEmbeddings?.reason \|\| companionSearch.operationalReason \|\| companionSearch.reason` | `DeviceRuntimeState.embeddings.reason` | **Correto.** Prioriza a razão unificada de runtime. |

### Conclusão sobre a secção:
Três dos quatro campos (Estado, Modo e Observações) já utilizam a capacidade operacional de `DeviceRuntimeState.embeddings`. A linha `Artefactos:` é a única que ficou acoplada ao conceito legado de manifesto teórico/`exists`.

---

## 4. Origem dos Estilos dos Badges

### 4.1 Mapeamento dos Cartões de Artefactos
Em [deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L306-L345), são renderizados três cartões principais através de `renderArtifactCard()`:
1. **Índice textual** (`diagnostics.artifacts.index`)
2. **Embeddings canónicos (JSONL)** (`diagnostics.artifacts.embeddings`)
3. **Cópia binária de embeddings** (`diagnostics.artifacts.binary`)

Em cada cartão, o cabeçalho renderiza um badge:
```typescript
header.createSpan({
  attr: {
    style:
      "padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold;" +
      this.getStatusBadgeStyle(artifact.status),
  },
  text: this.getStatusBadgeText(artifact.status),
});
```

### 4.2 Status Interno vs Status Visual
O campo `artifact.status` possui o tipo `ArtifactProvenanceStatus = "valid" | "stale" | "unknown" | "future"` gerado por `evaluateArtifactProvenance()` em [artifactProvenanceValidation.ts](file:///d:/_dev/obsidian/lina/src/device/artifactProvenanceValidation.ts#L120-L157):
- Se `producerEpoch === ownershipEpoch` e `producerDeviceId === activeProducerId`: status = `"valid"`.
- Se `producerEpoch < ownershipEpoch` (época anterior): status = `"stale"`.

### 4.3 A Regra Explícita de Estilo
Nas linhas 508 a 533 de [deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L508-L533):
```typescript
private getStatusBadgeText(status: ArtifactProvenanceStatus): string {
  switch (status) {
    case "valid":
    case "stale":
      return this.L.deviceDiagnosticsBadgeValid; // "✓ Válido"
    case "future":
      return this.L.deviceDiagnosticsBadgeFuture;
    case "unknown":
    default:
      return this.L.deviceDiagnosticsBadgeUnknown;
  }
}

private getStatusBadgeStyle(status: ArtifactProvenanceStatus): string {
  switch (status) {
    case "valid":
      return "background-color: var(--background-modifier-success); color: var(--text-on-accent);"; // VERDE
    case "stale":
      return "background-color: var(--background-modifier-border); color: var(--text-normal);"; // CINZENTO NEUTRO
    case "future":
      return "background-color: var(--text-accent); color: var(--text-on-accent);";
    case "unknown":
    default:
      return "background-color: var(--background-modifier-border); color: var(--text-muted);";
  }
}
```

### Resposta à Pergunta da Auditoria:
> *Existe uma regra explícita que transforma `valid + prior epoch` num estilo neutro?*

**Sim.** A regra está explicitamente codificada na linha 526 de [deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L526).
- No LINA-08, o texto do badge para `"stale"` foi alterado para `"✓ Válido"` porque a proveniência de uma época anterior é plenamente válida e funcional para pesquisa.
- Porém, o estilo CSS (`getStatusBadgeStyle`) **não foi unificado**. Manteve a regra histórica que atribui a `"stale"` a cor de borda neutra `var(--background-modifier-border)` e texto normal, enquanto `"valid"` recebe `var(--background-modifier-success)` (verde).
- Assim, o Índice Textual (produzido na época ativa 3) tem `status: "valid"` e recebe badge verde. Os Embeddings (produzidos na época 1) têm `status: "stale"` e recebem badge cinzento com o texto `"✓ Válido"`.

---

## 5. Consumidores Antigos Encontrados

Foi realizada pesquisa global no repositório à procura de referências a strings e padrões legados de estado:

1. **`deviceDiagnosticsCompanionEmbeddingsMissing`:**
   - [src/i18n/strings.ts:1946](file:///d:/_dev/obsidian/lina/src/i18n/strings.ts#L1946): definição da string (`"Embeddings indisponíveis"`).
   - [src/device/deviceDiagnosticsModal.ts:286](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L286): único ponto de consumo ativo no código.
2. **`companionSearch.embeddingsAvailable`:**
   - [src/device/deviceDiagnostics.ts:401](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnostics.ts#L401): atribuído a partir de `embeddingsDeclared` (manifesto textual), ignorando se os vetores já foram verificados operacionalmente.
   - [src/device/deviceDiagnosticsModal.ts:276](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L276): consumido como fallback quando `runtimeEmbeddings` não existe.
3. **`runtimeEmbeddings.exists`:**
   - [src/device/deviceRuntimeState.ts:239](file:///d:/_dev/obsidian/lina/src/device/deviceRuntimeState.ts#L239): condicionado a `(embeddingsDeclared || companionState.artifactAvailability.binaryCopy === "available")`. Se houver desfasamento de digest/geração textual, a expressão invalida a existência funcional, contrariando o princípio de que vetores existentes e compatíveis são utilizáveis.
4. **`SidebarStatusViewModel` (Contraste Positivo):**
   - Em [src/search/sidebarStatusViewModel.ts:341-353](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts#L341-L353), a Sidebar já foi migrada com sucesso no LINA-08 e LINA-09:
     ```typescript
     const isOperational = runtimeEmbeddings
       ? Boolean(runtimeEmbeddings.semanticAvailable)
       : Boolean(semanticAvailable && embeddingsReady);
     ```
     A Sidebar não apresenta o erro precisamente porque avalia a disponibilidade operacional (`semanticAvailable`) e só sinaliza necessidade de atualização se houver trabalho real pendente (`embeddingsWorkAvailable`).

---

## 6. Matriz Estado Funcional → Apresentação

Em conformidade com os princípios arquiteturais aprovados, a proveniência cronológica ou histórica nunca deve degradar o estado funcional de um artefacto. O badge do cartão representa exclusivamente a integridade funcional do ficheiro.

| Estado funcional | Proveniência | Badge Text | Badge Cor | Texto Traduzido (PT) | Justificação Arquitetural |
|---|---|---|---|---|---|
| **valid** | `current epoch` | `Valid` | **Verde** (`--background-modifier-success`) | `✓ Válido` | Artefacto íntegro e gerado na época ativa. |
| **valid** | `prior epoch` | `Valid` | **Verde** (`--background-modifier-success`) | `✓ Válido` | Artefacto íntegro e operacional. A época anterior é apenas proveniência histórica, documentada na linha de detalhe inferior. |
| **invalid** | qualquer | `Invalid` | **Vermelho** (`--background-modifier-error`) | `Inválido` | Conteúdo corrompido, digests inválidos ou falha estrutural de leitura. |
| **missing** | nenhuma | `Missing` | **Neutro** (`--background-modifier-border`) | `Ausente` | Ficheiro do artefacto não existe no disco. |
| **incompatible**| qualquer | `Incompatible` | **Aviso/Laranja** (`--background-modifier-warning`) | `Incompatível` | Dimensões, modelo ou provider incompatíveis com a configuração ativa do dispositivo. |

A proveniência histórica (`Época anterior (época 1 vs época ativa 3)`) permanece expressa de forma legível na linha dedicada `Proveniência:` logo abaixo dos detalhes do artefacto, sem contaminar o badge de validade funcional.

---

## 7. Causa Raiz

Identificam-se duas causas raiz independentes:

### Causa Raiz 1: Desacoplamento entre Disponibilidade Operacional e Linha de Artefactos
Em [deviceDiagnosticsModal.ts:276](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L276), a verificação de embeddings da grelha de Capacidade de Pesquisa consulta:
```typescript
const hasEmbeddings = runtimeEmbeddings ? runtimeEmbeddings.exists : this.diagnostics.companionSearch.embeddingsAvailable;
```
1. `runtimeEmbeddings.exists` e `companionSearch.embeddingsAvailable` dependem de `embeddingsDeclared` em [deviceRuntimeState.ts:217](file:///d:/_dev/obsidian/lina/src/device/deviceRuntimeState.ts#L217).
2. `embeddingsDeclared` torna-se falso se houver desfasamento de geração de texto (`manifestGenId !== embeddingSourceGenId`), mesmo que os vetores canónicos estejam intactos, compatíveis e operacionais.
3. A linha de Capacidade de Pesquisa foi concebida para informar o utilizador se a pesquisa do dispositivo tem acesso aos artefactos necessários. Ao consultar `.exists` em vez de `.semanticAvailable`, a interface contradiz a linha imediatamente acima (`Modo de pesquisa: Pesquisa Completa`).

### Causa Raiz 2: Assimetria Incompleta no Tratamento de `stale` em `DeviceDiagnosticsModal`
Durante a implementação de LINA-08:
- O método `getStatusBadgeText()` foi alterado para mapear tanto `"valid"` como `"stale"` para `this.L.deviceDiagnosticsBadgeValid` (`"✓ Válido"`).
- O método `getStatusBadgeStyle()` não foi alterado na mesma proporção: manteve `"stale"` associado ao estilo neutro `var(--background-modifier-border)` e texto atenuado, enquanto `"valid"` permaneceu associado a `var(--background-modifier-success)` (verde).
- Isto gerou uma incoerência visual direta entre dois artefactos ambos marcados como `✓ Válido`.

---

## 8. Correção Recomendada

*Nota: Esta secção é estritamente descritiva da futura implementação e não altera código nesta fase de auditoria.*

1. **Alinhar a Linha de Artefactos com a Realidade Operacional em [deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L276):**
   Substituir a consulta a `.exists` por `.semanticAvailable`:
   ```typescript
   const hasEmbeddings = runtimeEmbeddings
     ? runtimeEmbeddings.semanticAvailable
     : Boolean(this.diagnostics.companionSearch.operationalSemanticAvailable ?? this.diagnostics.companionSearch.embeddingsAvailable);
   ```
   Deste modo, se `semanticAvailable === true`, a linha de artefactos reportará coerentemente `Índice textual disponível • Embeddings disponíveis`.

2. **Unificar o Estilo do Badge de Artefactos Válidos em [deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L521-L533):**
   Unificar os casos `"valid"` e `"stale"` em `getStatusBadgeStyle()`, atribuindo a ambos a classe/estilo de sucesso verde:
   ```typescript
   private getStatusBadgeStyle(status: ArtifactProvenanceStatus): string {
     switch (status) {
       case "valid":
       case "stale":
         return "background-color: var(--background-modifier-success); color: var(--text-on-accent);";
       case "future":
         return "background-color: var(--text-accent); color: var(--text-on-accent);";
       case "unknown":
       default:
         return "background-color: var(--background-modifier-border); color: var(--text-muted);";
     }
   }
   ```
   A indicação de época anterior continua perfeitamente visível na linha textual de proveniência (`getLocalizedProvenanceMessage()`), sem criar ambiguidade na cor de validação do artefacto.

---

## 9. Riscos

1. **Risco de Falsa Disponibilidade se os Vetores Forem Físicamente Apagados:**
   `DeviceRuntimeState.embeddings.semanticAvailable` já passa pela validação rigorosa de [hybridSearch.ts:getSemanticSearchAvailability()](file:///d:/_dev/obsidian/lina/src/search/hybridSearch.ts#L90), que abre fisicamente o ficheiro (JSONL ou binário) e valida integridade, dimensões e contagem de vetores utilizáveis. Não existe risco de apresentar "disponível" se os ficheiros estiverem ausentes ou corrompidos.
2. **Impacto em Dispositivos Companion:**
   Em nós companion (read-only), a unificação de `getStatusBadgeStyle` assegura que um companion a consumir índices de épocas anteriores vê corretamente os cartões como válidos (verde), sem alarmismo visual injustificado.
3. **Isolamento de Contratos:**
   A correção recomendada não altera nenhum contrato JSON em disco, não modifica schemas de manifesto nem introduz migrações de dados.

---

## 10. Confirmação de Ausência de Alterações

Em estrito cumprimento das instruções da tarefa:
- Nenhuma linha de código de produção ou de testes foi alterada.
- Nenhuma folha de estilos CSS foi modificada.
- Nenhuma string de internacionalização foi alterada.
- Nenhum schema, contrato ou migração foi criado.
- Nenhum commit de git foi executado.
- Foi exclusivamente produzido este documento de auditoria formal.
