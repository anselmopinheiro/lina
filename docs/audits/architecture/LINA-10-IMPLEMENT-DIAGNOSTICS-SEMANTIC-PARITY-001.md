# LINA-10-IMPLEMENT-DIAGNOSTICS-SEMANTIC-PARITY-001

## 1. Causa Corrigida

No painel de Diagnóstico do Lina persistiam duas incongruências semânticas e visuais:

1. **Linha `Artefactos:` com `Embeddings indisponíveis` apesar de `semanticAvailable === true`:**
   Em `src/device/deviceDiagnosticsModal.ts`, a linha avaliava `hasEmbeddings` através de `runtimeEmbeddings ? runtimeEmbeddings.exists : this.diagnostics.companionSearch.embeddingsAvailable`. Esta propriedade `.exists` derivava de `embeddingsDeclared` em `src/device/deviceRuntimeState.ts`, a qual era marcada como `invalid` por `src/companion/companionConsumptionState.ts` caso houvesse desfasamento de digest/geração de texto (`manifestGenId !== embeddingSourceGenId`), mesmo quando os vetores estavam íntegros, compatíveis e operacionais para pesquisa semântica.
2. **Assimetria visual nos badges de artefactos válidos com proveniência de época anterior (`stale`):**
   Em `src/device/deviceDiagnosticsModal.ts`, `getStatusBadgeText()` já devolvia `✓ Válido` para `valid` e `stale` (implementado em LINA-08), mas `getStatusBadgeStyle()` continuava a distinguir os dois casos, atribuindo fundo verde a `valid` e cinzento neutro (`var(--background-modifier-border)`) a `stale`. Isso criava a falsa impressão visual de degradação quando os embeddings pertenciam a uma época anterior.

Ambas as causas foram eliminadas.

---

## 2. Fonte Final da Linha `Artefactos`

Em [src/device/deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L273-L288), a verificação de disponibilidade de embeddings na secção de Capacidade de Pesquisa foi unificada diretamente com a capacidade operacional de runtime:

```typescript
const hasTextIndex = runtimeEmbeddings
  ? runtimeEmbeddings.textIndexAvailable
  : this.diagnostics.companionSearch.textIndexAvailable;

const hasEmbeddings = runtimeEmbeddings
  ? runtimeEmbeddings.semanticAvailable
  : Boolean(
      this.diagnostics.companionSearch.operationalSemanticAvailable ??
      this.diagnostics.companionSearch.embeddingsAvailable
    );
```

### Comportamento resultante:
- Quando `semanticAvailable === true` (e modo `full`), a linha apresenta incondicionalmente:
  ```text
  Artefactos: Índice textual disponível • Embeddings disponíveis
  ```
- Quando `semanticAvailable === false`, a linha apresenta:
  ```text
  Artefactos: Índice textual disponível • Embeddings indisponíveis
  ```
  acompanhada da respetiva razão operacional no campo `Observações:`.

---

## 3. Regra Final de Badges

Em [src/device/deviceDiagnosticsModal.ts](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnosticsModal.ts#L521-L533), a função `getStatusBadgeStyle()` foi alinhada com `getStatusBadgeText()`:

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

### Matriz de Apresentação Funcional e Visual:

| Estado funcional | Proveniência | Badge Texto | Badge Cor | Estilo CSS |
|---|---|---|---|---|
| **valid** | época ativa | `✓ Válido` | **Verde** | `var(--background-modifier-success)` |
| **valid** | época anterior (`stale`) | `✓ Válido` | **Verde** | `var(--background-modifier-success)` |
| **future** | época futura | `⚡ Futuro` | **Acento** | `var(--text-accent)` |
| **unknown / missing / invalid** | desconhecida | `❓ Desconhecido` | **Neutro** | `var(--background-modifier-border)` |

A proveniência histórica permanece intacta e explícita na linha dedicada `Proveniência:` logo abaixo dos detalhes do cartão (ex.: `Proveniência: Época anterior (época 1 vs época ativa 3)`), garantindo total transparência sem corromper o badge de integridade funcional.

---

## 4. Testes

1. **`tests/device/deviceDiagnosticsModal.test.ts`:**
   - Adicionada suite dedicada `LINA-10: Diagnostics Semantic Parity and Badge Styles` cobrindo:
     - **Caso 1 — Full semantic capability:** `semanticAvailable: true`, `effectiveMode: "full"`, simulando `embeddingsDeclared: false` legado e validando a presença de `Estado: Disponível`, `Modo: Pesquisa Completa (Texto + Vetores)` e `Artefactos: Índice textual disponível • Embeddings disponíveis`.
     - **Caso 2 — Prior epoch válido:** Artefacto com `status: "stale"`, verificando que o badge recebe texto `✓ Válido`, estilo `var(--background-modifier-success)` (verde), e que o detalhe preserva `Época anterior (época 1 vs época ativa 3)`.
     - **Caso 3 — Indisponibilidade real:** `semanticAvailable: false`, validando a apresentação de `Artefactos: Índice textual disponível • Embeddings indisponíveis` com a razão explicativa no campo `Observações:`.
2. **`tests/search/semanticAvailabilityDiagnosticsAlignment.test.ts`:**
   - Atualizado o Caso 6 para alinhar a asserção com a semântica canónica de que `semanticAvailable === false` produz `Embeddings indisponíveis` na linha de capacidade operacional.

---

## 5. Validações

Todas as validações técnicas foram executadas com sucesso:

- `npm test`: **123 ficheiros de teste aprovados (1670 testes)**
- `npm run typecheck`: **0 erros de tipagem TypeScript (`tsc --noEmit`)**
- `npm run lint:obsidian:strict`: **0 erros, 0 avisos (`eslint --max-warnings=0`)**
- `npm run build`: **Build de produção completada e sincronizada com o test-vault**
- `npm run release-check`: **Verificação de release aprovada**
- `git diff --check`: **Sem conflitos, whitespace residual ou avisos de diff**

---

## 6. Riscos Residuais

- **Risco nulo de regressão de disponibilidade:** `semanticAvailable` reflete a validação concreta de ficheiros físicos e prontidão de runtime por `getSemanticSearchAvailability()`.
- **Risco nulo de conflito de proveniência:** Dispositivos companheiros ou produtores que operem sobre artefactos de épocas anteriores exibem o badge verde de operacionalidade acompanhado do histórico na linha descritiva.
- **Risco nulo de mutação de estado:** O modal de diagnóstico mantém a sua garantia absoluta de ser uma superfície de leitura (`read-only`).

---

## 7. Confirmação de Ausência de Alterações Arquiteturais Proibidas

Confirma-se estritamente que:
- Não foram alterados schemas JSON em disco.
- Não foram alterados contratos de dados ou metadados de proveniência.
- Não foi alterado o subsistema de storage nem o `VectorContract`.
- Não foi alterado `DeviceRuntimeState`.
- Não foram criadas novas propriedades ou migrações.
- Todas as alterações ficaram circunscritas a `src/device/deviceDiagnosticsModal.ts` e às respetivas suites de teste.
