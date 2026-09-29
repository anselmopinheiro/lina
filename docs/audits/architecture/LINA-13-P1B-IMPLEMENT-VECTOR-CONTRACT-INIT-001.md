# LINA-13-P1B-IMPLEMENT-VECTOR-CONTRACT-INIT-001 — Relatório de Implementação

## 1. Problema Identificado

Durante a auditoria arquitetural `LINA-13-P0` e a formalização em `LINA-13-P1-AB-AUDIT-IMPLEMENTATION-PLAN-001` (achado **B3**), foi identificada uma anomalia na ordem de inicialização do plugin durante `loadDataFromDisk()`:

```
loadDataFromDisk()
        ↓
refreshDeviceRuntimeState()      ← Avalia capacidade semântica (getSemanticSearchAvailability)
        ↓
initializeExclusionPolicy()
        ↓
loadCanonicalVectorContract()    ← Contrato vetorial só era carregado aqui!
```

### Impacto
Em dispositivos com papel `Companion`, a configuração de embeddings (`getEffectiveEmbeddingConfig()`) depende exclusivamente do `VectorContract` publicado pelo `Producer` no manifesto canónico (`.lina/index/manifest.json` ou `embeddings.binary.manifest.json`).

Como o contrato vetorial ainda não tinha sido carregado no momento em que `refreshDeviceRuntimeState()` executava, o `Companion` avaliava `provider: ""` e `model: ""`. Consequentemente, `getSemanticSearchAvailability()` marcava o estado de compatibilidade como `incompatible` ou `missing`, e o `DeviceRuntimeState.embeddings.semanticAvailable` ficava incorretamente a `false` no arranque inicial, necessitando de uma abertura posterior de diagnósticos ou reconfiguração para se atualizar.

---

## 2. Ficheiros Alterados

1. **[`main.ts`](file:///d:/_dev/obsidian/lina/main.ts)**:
   - Nos dois ramos de `loadDataFromDisk()` (ramo `unsupportedFutureVersion` e ramo normal), moveu-se `await this.loadCanonicalVectorContract();` para antes de `await this.refreshDeviceRuntimeState();`.
   - A sequência canónica passou a ser:
     ```
     await this.getOwnershipGate().evaluate();
     await this.loadCanonicalVectorContract();
     await this.refreshDeviceRuntimeState();
     await this.initializeExclusionPolicy();
     ```
2. **[`tests/device/vectorContractStartupOrder.test.ts`](file:///d:/_dev/obsidian/lina/tests/device/vectorContractStartupOrder.test.ts)** *(Novo)*:
   - Teste unitário e de integração que valida a ordem de invocação e os efeitos de disponibilidade semântica em nós Companion e Producer.
3. **[`AGENTS.md`](file:///d:/_dev/obsidian/lina/AGENTS.md)**:
   - Registo de conclusão da Fase P1-B.
4. **[`CHANGELOG.md`](file:///d:/_dev/obsidian/lina/CHANGELOG.md)**:
   - Registo da correção da ordem de carregamento do contrato vetorial.

---

## 3. Decisão Técnica

- **Grafo de Dependências Acíclico**: O método `loadCanonicalVectorContract()` não depende de `ownership`, papéis, definições do utilizador ou `DeviceRuntimeState`. Lê exclusivamente os manifestos de índice publicados. Por sua vez, `refreshDeviceRuntimeState()` consome o contrato carregado para derivar a configuração efetiva do Companion.
- **Isolamento de Responsabilidades**: A chamada a `loadCanonicalVectorContract()` foi antecipada sem alterar assinaturas de métodos, sem criar novas caches nem alterar a semântica de `refreshDeviceRuntimeState()`.
- **Preservação dos dois ramos**: Ambos os fluxos de arranque em `loadDataFromDisk` (versões futuras de schema e inicialização padrão) partilham rigorosamente a mesma ordem canónica.

---

## 4. Impacto

- **Companion no arranque**: Dispositivos Companion com manifesto e contrato vetorial válidos passam a avaliar imediatamente `semanticAvailable === true` e `runtimeState === "ready"` no `DeviceRuntimeState` logo no primeiro ciclo de inicialização do plugin.
- **Producer no arranque**: Mantém o comportamento inalterado, uma vez que a sua configuração deriva dos settings locais.
- **Zero Migrations & Zero Schema Changes**: Não houve alterações a formatos de ficheiro, schemas, `VectorContract` ou `DeviceRuntimeState`.

---

## 5. Testes Executados

### 5.1 Testes Focados (`tests/device/vectorContractStartupOrder.test.ts`)
- **Caso 1 (Ordem normal)**: `loads the vector contract before resolving runtime state (normal branch)` — valida que a ordem de chamada de `loadCanonicalVectorContract` é inferior à de `refreshDeviceRuntimeState`.
- **Caso 2 (Ordem ramo futuro)**: `loads the vector contract before resolving runtime state (future-settings-version branch)` — valida a mesma invariante sob versionamento futuro.
- **Caso 3 (Companion com contrato válido)**: `companion runtime state evaluates semantic availability correctly on startup without requiring manual diagnostics open` — valida que `semanticAvailable === true`, `runtimeState === "ready"` e `effectiveMode === "full"`.
- **Caso 4 (Producer)**: `producer runtime state does not depend on vector contract resolution order` — assegura paridade e robustez para o papel Producer.
- **Caso 5 (Resiliência)**: `startup tolerates missing or invalid manifest cleanly without throwing`.
- **Caso 6 (Isolamento de políticas)**: `startup order preserves exclusion policy initialization`.

### 5.2 Validação Global
- `npm test`: **126 ficheiros / 1693 testes passaram** (100% verde).
- `npm run typecheck`: Sucesso sem erros.
- `npm run lint:obsidian:strict`: Sucesso com 0 erros e 0 avisos.
- `npm run build`: Sucesso na compilação do bundle.
- `npm run release-check`: Validação de release aprovada.
- `git diff --check`: Limpo.

---

## 6. Limitações e Âmbito

- Esta fase resolveu estritamente **P1-B** (ordem de inicialização no arranque).
- A invalidação e deteção em tempo de execução de novos contratos vetoriais publicados durante uma sessão aberta sem reinício do Obsidian pertence a fases posteriores (P1-d / LINA-14).
- O pré-gate de pesquisa semântica da UI pura pertence à fase **P1-A**.

---

## 7. Próximos Passos

1. Executar a Fase **P1-A** (`LINA-13-P1-A`): remover o pré-gate na pesquisa semântica pura que bloqueava consultas baseando-se no `DeviceRuntimeState` stale em vez do índice runtime fresco.
