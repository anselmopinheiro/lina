# LINA-06-IMPLEMENT-DEVICE-RUNTIME-STATE-001
**Implementação da Arquitetura de Estado Runtime Consolidado do Dispositivo**

- **Data:** 28-09-2026
- **Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian
- **Estado:** Concluído com Sucesso
- **Tipo de Documento:** Relatório de Arquitetura e Implementação (Sem criação de novas fontes persistentes, sem alterações de schemas ou contratos de armazenamento)

---

## 1. Resumo da Implementação

Esta intervenção implementou a arquitetura unificada de **Estado Runtime do Dispositivo** (`DeviceRuntimeState`), erradicando as divergências identificadas na auditoria `LINA-06-AUDIT-DEVICE-STATE-CONSISTENCY-001`:
1. **Divergência de Papel / Producer:** Eliminada a dependência direta de `OwnershipGate.getLastDecision()` nas Settings, que gerava falsos alarmes de `"⏸️ Standby Producer"`.
2. **Fuga de Estado Legado:** Erradicado o campo obsoleto `settings.deviceRole` (armazenado em `data.json`) da barra lateral (`linaSearchView.ts`) e dos comandos em `main.ts`, passando a consultar o papel configurado e efetivo do dispositivo local.
3. **Desacoplamento e Alinhamento de Embeddings e Pesquisa:** Separadas com clareza as quatro camadas de capacidade:
   - **Existência física:** Artefacto declarado e presente no disco (`embeddingsDeclared`, `vectorFileState`).
   - **Compatibilidade de Contrato:** Provider, modelo e dimensões validados contra a configuração ativa (`contractState: "compatible" | "mismatch" | "none"`).
   - **Prontidão de Runtime:** Estado de carregamento ou verificação semântica em curso (`runtimeState: "ready" | "checking" | "unavailable"`).
   - **Disponibilidade Operacional:** Prontidão total para responder a consultas híbridas e semânticas (`semanticAvailable`, `effectiveMode: "full" | "text-only" | "unavailable"`).

---

## 2. Princípio Arquitetural e Fluxo de Dados

As fontes persistentes oficiais continuam a ser estritamente as únicas autoridades no sistema de ficheiros:
- **Autoridade do Vault (Cluster):** `.lina/ownership.json` (`activeProducerId`, `epoch`, lease/fencing).
- **Identidade Local do Dispositivo:** `.lina/devices/<deviceId>.json` (`deviceId`, `deviceName`, `configuredRole`).
- **Publicação Canónica:** `.lina/index/manifest.json` e artefactos vetoriais.

O novo módulo `src/device/deviceRuntimeState.ts` opera como o **consolidador único em memória**:

```text
       [ .lina/ownership.json ]         [ .lina/devices/<id>.json ]
                  │                                   │
                  └───────────────┬───────────────────┘
                                  ▼
                    resolveDeviceRuntimeState(...)
                                  │
                                  ▼
                         DeviceRuntimeState
                                  │
         ┌────────────────┬───────┴────────┬────────────────┐
         ▼                ▼                ▼                ▼
    Settings Hub     Diagnostics     Sidebar Status    Search View
  (src/settings.ts)  (Modal & API)  (Status Card UX)  (hybridSearch)
```

Nenhum componente de UI ou serviço de apresentação volta a tentar calcular ownership de forma ad-hoc ou consultar caches parciais em momentos indeterminados.

---

## 3. Consumidores Migrados

### 3.1. Settings Hub (`src/settings.ts`)
- **Problema Anterior:** `getGroupSummary("general")`, `getGroupSummary("producer")` e `onChangeDeviceRole()` consultavam síncronamente `this.plugin.getOwnershipGate().getLastDecision()`. Se o modal fosse aberto antes de um `evaluate()` explícito, `lastDecision` era `null` e a UI exibia Standby Producer mesmo sendo o nó proprietário.
- **Migração:** Todas as consultas migraram para `this.plugin.getDeviceRuntimeState()`. A determinação de `isActiveProducer`, `isStandbyProducer` e `deviceName` é imediata, determinística e imutável.

### 3.2. Sidebar Status Card (`src/search/linaSearchView.ts`)
- **Problema Anterior:** Injetava `this.plugin.settings.deviceRole` (campo legado de `data.json`, frequentemente `undefined`) e fazia avaliações ad-hoc do gate com fallback condicional sobre `settings.deviceRole === "producer"`.
- **Migração:**
  - `effectiveRole` e `deviceRole` são obtidos de `runtimeState.configuredRole ?? runtimeState.effectiveRole`.
  - `isAuthorizedProducer` e `isStandbyProducer` vêm diretamente de `runtimeState.isActiveProducer` e `runtimeState.isStandbyProducer`.
  - O campo `settings.deviceRole` foi **100% erradicado** de `src/search/linaSearchView.ts`.

### 3.3. Device Diagnostics (`src/device/deviceDiagnostics.ts`)
- **Migração:** A função pura `buildDeviceDiagnostics` agora delega a resolução de identidade, papel, ownership e capacidades a `resolveDeviceRuntimeState`. O snapshot retornado inclui a propriedade canónica `runtime: DeviceRuntimeState`, garantindo alinhamento matemático exato entre o que é diagnosticado e o que os restantes componentes consomem.

### 3.4. Ciclo de Vida e Comandos (`main.ts`)
- **Migração:**
  - Adicionado `deviceRuntimeState` em memória.
  - Implementado `getDeviceRuntimeState(): DeviceRuntimeState` com fallback síncrono seguro (nunca devolve `null` ou `undefined`, mesmo no primeiro instante do plugin).
  - Implementado `refreshDeviceRuntimeState(): Promise<DeviceRuntimeState>` chamado em `loadDataFromDisk()`, em `changeDeviceRole()` e na execução de `getDeviceDiagnostics()`.
  - O comando `mostrar-diagnostico-dispositivo` migrou da verificação legada para `runtimeState.isStandbyProducer` e `runtimeState.isCompanion`.

---

## 4. Testes e Validação

### 4.1. Testes Unitários Dedicados (`tests/device/deviceRuntimeState.test.ts`)
Foi criada uma suíte de testes com 9 cenários abrangendo:
1. **Producer Ativo:** Confirma que quando o dispositivo local tem papel `"producer"` e coincide com `ownership.activeProducerId`, o estado é `isActiveProducer: true`, `canPublish: true`, `transferEligibilityReason: "already-active-producer"`.
2. **Standby Producer:** Confirma que quando outro nó detém a autoridade, o estado é `isActiveProducer: false`, `isStandbyProducer: true`, `canTransferOwnership: true`, `transferEligibilityReason: "ready"`.
3. **Companion:** Confirma que o dispositivo permanece como consumidor estrito (`canPublish: false`, `canTransferOwnership: false`, `transferEligibilityReason: "companion-role"`).
4. **Transferência de Ownership:** Valida que a transição de Standby para Ativo atualiza atomicamente todas as propriedades (incluindo incremento de `epoch`).
5. **Primeiro Arranque sem Cache (Unclaimed / Missing Ownership):** Confirma a estabilidade e segurança defensiva caso o ficheiro `.lina/ownership.json` ainda não exista.
6. **Separação de Camadas de Embeddings:**
   - Existência física vs. Incompatibilidade de modelo (`embeddingsDeclared: true`, `contractState: "mismatch"`, `semanticAvailable: false`, `effectiveMode: "text-only"`).
   - Verificação em runtime (`runtimeState: "checking"`, `reasonCode: "runtime-checking"`).
   - Prontidão e Disponibilidade total (`semanticAvailable: true`, `effectiveMode: "full"`).
7. **Paridade com DeviceDiagnostics:** Compara campo a campo as saídas de `buildDeviceDiagnostics` e `resolveDeviceRuntimeState`, confirmando consistência absoluta.

### 4.2. Resultados dos Comandos Obrigatórios

| Comando | Resultado | Notas |
| :--- | :--- | :--- |
| `npm test` | **123 passed (123 ficheiros, 1652 testes)** | 0 falhas em toda a suíte. |
| `npm run typecheck` | **Código 0** | Sem erros de tipagem TypeScript. |
| `npm run lint:obsidian:strict` | **Código 0 (0 erros, 0 avisos)** | Todas as regras estritas da comunidade Obsidian satisfeitas. |
| `npm run build` | **Código 0** | Build de produção gerada e instalada no vault de teste local. |
| `git diff --check` | **Código 0** | Sem conflitos ou espaços em branco órfãos. |
| `git branch --show-current` | `master` | Trabalho realizado exclusivamente na branch master. |

---

## 5. Riscos e Mitigações

1. **Risco de Leituras Síncronas antes do Primeiro I/O:**
   - *Mitigação:* `getDeviceRuntimeState()` implementa resolução síncrona defensiva baseada no estado já residente em memória, garantindo que o Settings Hub ou Sidebar nunca encontrem propriedades nulas ou lancem exceções se forem acedidos imediatamente após a inicialização.
2. **Risco de Dessincronização após Alteração de Papel:**
   - *Mitigação:* Qualquer mutação (`changeDeviceRole`, concessão ou revogação de ownership) invoca `await this.refreshDeviceRuntimeState()` de forma determinística antes de atualizar os listeners de eventos e a UI.
3. **Risco de Impacto de Performance Mobile (Android):**
   - *Mitigação:* A resolução de `DeviceRuntimeState` é puramente baseada em metadados de manifestos leves, não carregando os vetores numéricos (`Float32Array`) para a memória principal.

---

## 6. Conclusão

A arquitetura de estado runtime consolidado está plenamente implementada e operacional. As discrepâncias entre Settings, Diagnostics, Sidebar Status e Search foram definitivamente resolvidas, mantendo a integridade estrita das regras e contratos do Lina.
