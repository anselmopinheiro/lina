# LINA-06-AUDIT-DEVICE-STATE-CONSISTENCY-001
**Auditoria de Consistência de Estado do Dispositivo, Ownership, Embeddings e Pesquisa Semântica**

- **Data:** 28-09-2026
- **Autor:** Arquiteto de Software Sénior
- **Estado:** Concluído
- **Tipo de Documento:** Auditoria de Arquitetura (Sem alterações de código, migrações ou commits)

---

## 1. Resumo Executivo

A presente auditoria foi motivada pela observação de estados contraditórios entre diferentes componentes de interface do Lina:
1. **Divergência de Papel / Producer:** As Settings apresentam `"⏸️ Standby Producer"` enquanto o painel de Diagnóstico apresenta `"Produtor ativo (autorizado a publicar)"`.
2. **Divergência de Embeddings / Pesquisa:** A Search View apresenta `"Embeddings indisponíveis"` ou `"Estado desconhecido"`, ao mesmo tempo que o Diagnóstico lista artefactos físicos de embeddings existentes e válidos no disco.

### Diagnóstico Resumido das Causas-Raiz:
- **Ausência de Resolver Central de Runtime:** Não existe um coordenador unificado de estado em memória (`DeviceStateCoordinator`). Cada superfície consome uma fonte diferente:
  - As **Settings** leem a cache volátil e síncrona `OwnershipGate.getLastDecision()`, que inicializa a `null` e só é preenchida se `evaluate()` for invocado assincronamente.
  - O **Device Diagnostics** lê diretamente `.lina/ownership.json` do disco e força uma avaliação assíncrona fresca (`await gate.evaluate()`).
  - O **Status Card da Sidebar** (`linaSearchView.ts`) continua a injetar `this.plugin.settings.deviceRole` (campo legado e muitas vezes `undefined` no `data.json`) em vez de invocar o resolver local `getLocalDeviceRole()`.
- **Confusão entre Existência Física, Compatibilidade e Prontidão Operacional:**
  - O Diagnóstico reporta a **existência física** dos artefactos em `.lina/index/`.
  - A Pesquisa Semântica requer **compatibilidade estrita do contrato vetorial** (`provider` e `model` idênticos aos da configuração ativa) e **prontidão de carregamento em memória** (`EmbeddingIndexRuntime`).
  - O `EmbeddingWorkStatusController` tem estado inicial `"unknown"` e depende de um ciclo de debounce de 250ms; qualquer leitura imediata de UI antes desse ciclo retorna `"Estado desconhecido"`.

---

## 2. Fontes de Verdade Atuais

O mapeamento exaustivo das fontes de dados persistentes, em memória e legadas revelou a seguinte fragmentação:

| Domínio | Fonte Persistente (Disco) | Fonte em Memória (Runtime) | Fonte Legada / Incorreta |
| :--- | :--- | :--- | :--- |
| **Identidade Local** | `.lina/devices/<deviceId>.json` (`LocalDeviceState`) | `plugin.localDeviceState` | `settings.deviceId` (sincronizada mas mantida) |
| **Papel do Dispositivo** | `.lina/devices/<deviceId>.json` (`configuredRole`) | `plugin.getLocalDeviceRole()` / `resolveDeviceRole()` | `plugin.settings.deviceRole` (em `data.json` — **obsoleto**) |
| **Ownership do Vault** | `.lina/ownership.json` (`activeProducerId`, `epoch`) | `OwnershipGate.lastDecision` (cache volátil inicializada a `null`) | Leitura direta ad-hoc de `ownership.json` sem gate |
| **Artefactos Canónicos** | `.lina/index/text-manifest.json`, `chunks.jsonl` | `IndexStore` | Leitura manual de ficheiros na UI |
| **Embeddings Publicados** | `.lina/index/embeddings.jsonl` ou `.bin` | `EmbeddingIndexRuntime` (`Float32Array` lazy) | Suposição de que ficheiro no disco = pronto para pesquisa |
| **Trabalho Pendente** | `.lina/producer/staging/` e `.lina/index/` | `EmbeddingWorkStatusController` (`status`, `reason`) | Inicialização em `"unknown"` sem forçar sync inicial |

---

## 3. Fluxo de Dados Atual por Consumidor

### 3.1. Settings Hub (`src/settings.ts`)
```text
[Abertura das Settings]
       │
       ▼
LinaSettingTab.display()
       │
       ├──> plugin.getLocalDeviceRole()  ──> Retorna "producer" (OK)
       │
       └──> plugin.getOwnershipGate().getLastDecision()
                   │
                   ├── Se null (arranque ou sem evaluate prévio):
                   │       └──> decision?.allowed === undefined
                   │       └──> isActiveProducer = false
                   │       └──> UI Renderiza: "⏸️ Standby Producer" (FALSO NEGATIVO!)
                   │
                   └── Se evaluate() foi corrido previamente:
                           └──> decision?.allowed === true
                           └──> UI Renderiza: "✅ Produtor Ativo"
```

### 3.2. Device Diagnostics (`src/device/deviceDiagnostics.ts`)
```text
[Abertura do Modal de Diagnóstico / Comando]
       │
       ▼
readDeviceDiagnostics(vault, localDeviceId, gate, ...)
       │
       ├──> loadOwnership(vault) ──> Lê .lina/ownership.json diretamente do disco
       │
       ├──> gate.evaluate(localDeviceId, localRole, ...) ──> Força avaliação assíncrona fresca
       │
       └──> isActiveProducer = (ownership.activeProducerId === localDeviceId)
                   │
                   └──> UI Renderiza: "Produtor ativo (autorizado a publicar)" (CORRETO)
```

### 3.3. Sidebar Status Card (`src/search/linaSearchView.ts`)
```text
[Renderização da Sidebar de Pesquisa]
       │
       ▼
buildSidebarStatusViewModel(...)
       │
       ├──> Recebe: this.plugin.settings.deviceRole  <── [BUG CRÍTICO: CAMPO LEGADO!]
       │       └── Se undefined em data.json:
       │               └──> Interpreta como papel não configurado ou fallback incorreto
       │
       └──> Consulta EmbeddingWorkStatusController.getStatus()
               └── Se ainda não decorreu o debounce de 250ms:
                       └──> status === "unknown"
                       └──> UI Renderiza: "Estado desconhecido"
```

### 3.4. Motor de Pesquisa (`src/search/hybridSearch.ts`)
```text
[Execução de Pesquisa Semântica]
       │
       ▼
getSemanticSearchAvailability(...)
       │
       ├── 1. Verifica se manifest.embeddings existe no disco (Existência Física)
       ├── 2. Valida Vector Contract:
       │        localConfig (provider, model, dimensions)
       │        vs.
       │        publishedManifest (provider, model, dimensions)
       │        └── Se houver divergência:
       │                └──> Retorna: { available: false, reason: "incompatible" }
       │                └──> UI Renderiza: "Embeddings indisponíveis"
       └── 3. Valida se EmbeddingIndexRuntime tem vetores carregados (Prontidão)
```

---

## 4. Divergências Encontradas e Análise Detalhada

### Divergência 1: "Standby Producer" (Settings) vs. "Produtor Ativo" (Diagnostics)
- **Ocorrência:** Ao abrir as Settings imediatamente após iniciar o Obsidian, o utilizador vê o banner de "Standby Producer". Se abrir o modal de Diagnóstico, vê "Produtor ativo".
- **Ficheiros Envolvidos:**
  - `src/settings.ts` (linhas 805, 834, 1152)
  - `src/device/ownershipGate.ts` (linhas 31, 55, 112)
  - `src/device/deviceDiagnostics.ts` (linhas 45–90)
- **Mecanismo da Falha:**
  `OwnershipGate` instancia-se com `private lastDecision: OwnershipGateDecision | null = null`.
  O método síncrono `getLastDecision()` devolve `null` até que alguém execute `await gate.evaluate()`.
  No ciclo de vida do plugin, `gate.evaluate()` **não é invocado no arranque** nem no início de `LinaSettingTab.display()`. As Settings limitam-se a fazer `gate.getLastDecision()`. Como é `null`, o ternário assume `false`, exibindo Standby. O Diagnóstico, por sua vez, é assíncrono e invoca explicitamente `await gate.evaluate()`, populando a decisão e exibindo o estado real.

### Divergência 2: Fuga do campo legado `settings.deviceRole` na Sidebar
- **Ocorrência:** O card de estado da barra lateral comporta-se de forma inconsistente relativamente ao papel do dispositivo configurado nas Settings.
- **Ficheiros Envolvidos:**
  - `src/search/linaSearchView.ts` (linhas 2694, 2704, 2717)
  - `src/device/deviceState.ts`
- **Mecanismo da Falha:**
  Na migração da arquitetura Producer/Companion (Lina 0.2.x -> 0.3.x), o papel do dispositivo foi deslocalizado de `data.json` (`settings.deviceRole`) para o armazenamento local de dispositivo `.lina/devices/<deviceId>.json` (`localDeviceState.configuredRole`), acedido através de `plugin.getLocalDeviceRole()`.
  Contudo, em `linaSearchView.ts`:
  ```typescript
  // Linha 2694:
  deviceRole: this.plugin.settings.deviceRole,
  // Linha 2704:
  const role = this.plugin.settings.deviceRole;
  // Linha 2717:
  deviceRole: this.plugin.settings.deviceRole,
  ```
  Passa-se o campo obsoleto `settings.deviceRole`, que frequentemente tem o valor `undefined` ou um valor não sincronizado com o dispositivo local.

### Divergência 3: "Estado Desconhecido" e Falso Alarme de Indisponibilidade de Embeddings
- **Ocorrência:** O utilizador vê "Estado desconhecido" na sidebar logo após o carregamento, ou "Embeddings indisponíveis" na pesquisa, mesmo após uma geração com sucesso reportada no Diagnóstico.
- **Ficheiros Envolvidos:**
  - `src/embeddings/embeddingWorkStatusController.ts` (linhas 60–85)
  - `src/search/hybridSearch.ts` (função `getSemanticSearchAvailability`)
  - `src/search/embeddingStatusViewModel.ts`
- **Mecanismo da Falha:**
  1. O `EmbeddingWorkStatusController` arranca em estado `status: "unknown"` e usa um temporizador debounced de 250ms antes de emitir o primeiro cálculo real.
  2. O Diagnóstico reporta a **presença no sistema de ficheiros** (`chunks.jsonl` possui campos de embedding).
  3. A Pesquisa Semântica requer a **validação estrita do Contrato Vetorial**: se o utilizador alterou o modelo nas definições (ex.: mudou de `nomic-embed-text` para `bge-m3`) sem regenerar o índice, os ficheiros físicos continuam no disco, mas o contrato falha com incompatibilidade de modelo. A UI sumariza isso genericamente como "indisponível", induzindo o utilizador em erro ao achar que os ficheiros desapareceram.

---

## 5. Causa Provável Sistémica

A causa sistémica reside na **leitura direta e não coordenada de camadas arquiteturais distintas por parte dos consumidores de apresentação**:

```text
CAMADAS ARQUITETURAIS:

[ Camada 1: Persistência Canónica ]
   .lina/ownership.json  |  .lina/devices/<id>.json  |  .lina/index/text-manifest.json

[ Camada 2: Runtime Derivado & Invalidação ]
   OwnershipGate  |  EmbeddingWorkStatusController  |  EmbeddingIndexRuntime

[ Camada 3: Apresentação ]
   Settings Hub  |  Device Diagnostics  |  Status Card  |  Search View
```

Actualmente, a Camada 3 consome indiferenciadamente a Camada 1 e a Camada 2:
1. `Settings` consulta a cache da Camada 2 (que pode estar vazia).
2. `Diagnostics` consulta a Camada 1 diretamente no disco e actualiza a Camada 2.
3. `SearchView` consulta propriedades mortas em `settings` e interpola com a Camada 2.
4. `Search` consulta contratos vetoriais da Camada 2 sem expor o motivo da incompatibilidade ao Diagnóstico.

Não existe um ciclo unificado de **Bootstrap de Estado de Runtime** no momento do arranque do plugin (`onload`).

---

## 6. Proposta de Arquitetura Futura

Para erradicar definitivamente as divergências, deve ser introduzido um coordenador central de estado de dispositivo e capacidades:

### 6.1. Contrato do Coordenador Único (`DeviceStateCoordinator`)

```typescript
export interface DeviceRuntimeState {
  // Identidade e Papel
  deviceId: string;
  deviceName: string;
  configuredRole: DeviceRole;
  effectiveRole: DeviceRole;

  // Ownership e Cluster
  activeProducerId: string | null;
  isActiveProducer: boolean;
  epoch: number;
  ownershipStatus: "active_producer" | "standby_producer" | "companion" | "unassigned";

  // Capacidades de Embeddings e Pesquisa
  embeddings: {
    physicalArtifactExists: boolean;
    vectorCount: number;
    contractCompatible: boolean;
    operationalReady: boolean;
    incompatibilityReason?: string;
  };

  // Prontidão
  isInitialized: boolean;
}
```

### 6.2. Princípios de Governação do Estado:
1. **Inicialização no Startup (`onload`):** O plugin deve executar um `await deviceStateCoordinator.initialize()` determinístico antes de disponibilizar as UIs.
2. **Avaliação Preditiva de Ownership:** `OwnershipGate.evaluate()` deve ser garantido durante a inicialização, garantindo que `getLastDecision()` nunca seja `null` em execução normal.
3. **Subscrição Reativa Única:** As Settings, Diagnostics, Status Card e Search View devem subscrever o mesmo `DeviceStateCoordinator`.
4. **Remoção Absoluta de `settings.deviceRole`:** Eliminar qualquer referência a `plugin.settings.deviceRole` no código de visualização e substituí-lo por `coordinator.getState().configuredRole`.
5. **Diferenciação Visual de Embeddings em 3 Níveis:**
   - *Físico:* Artefacto encontrado no disco.
   - *Contrato:* Compatível com a configuração atual de IA.
   - *Operacional:* Pronto para responder a queries semânticas.

---

## 7. Riscos Arquiteturais

| Risco | Impacto | Mitigação Arquitetural |
| :--- | :--- | :--- |
| **I/O Bloqueante no Startup** | Atraso no carregamento do Obsidian em mobile (Android). | O `DeviceStateCoordinator` deve ler apenas manifestos leves (`ownership.json` e `<deviceId>.json`). Os vetores (`Float32Array`) mantêm-se em carregamento lazy. |
| **Sincronização Externa (Obsidian Sync / iCloud / Git)** | Ficheiro `ownership.json` alterado externamente durante a execução. | Manter watcher de ficheiros em `.lina/ownership.json` para disparar reavaliação no `DeviceStateCoordinator` e notificar as UIs abertas. |
| **Race Conditions na Abertura de Modais** | Modal aberto enquanto o gate está a avaliar. | O `DeviceStateCoordinator` expõe `getState()` com flag `isInitialized: boolean`. A UI exibe skeleton/loading se for acedida durante o arranque. |

---

## 8. Resposta Inequívoca à Condição de Paragem

> **Pergunta:** *Qual é a única fonte que deve alimentar Settings, Diagnostics e Search?*

### **Resposta Inequívoca:**

A única fonte de verdade que deve alimentar todas as superfícies de interface (Settings, Diagnostics, Status Card e Search) é o **Estado de Runtime Consolidado do Dispositivo** (materializado através do `DeviceStateCoordinator` ou da função central de resolução de estado `resolveDeviceRuntimeState()`), o qual é derivado estrita e exclusivamente de dois ficheiros canónicos persistentes:

1. **Autoridade do Vault (Cluster):** `.lina/ownership.json`
   - Define unicamente: `activeProducerId`, `epoch`, `transferredAt` e integridade do lease/fencing token.
2. **Configuração Local do Dispositivo:** `.lina/devices/<deviceId>.json` (`LocalDeviceState`)
   - Define unicamente: `deviceId`, `deviceName` e `configuredRole` deste nó específico.

**Nenhum componente de apresentação deve voltar a consultar:**
- A cache inicializável a nulo `gate.getLastDecision()` de forma isolada;
- A propriedade obsoleta `settings.deviceRole` em `data.json`;
- Leituras manuais ad-hoc do sistema de ficheiros em `.lina/index/`.

Todos os componentes visuais devem consumir exclusivamente o snapshot emitido por este coordenador central, garantindo total paridade e coerência semântica em todo o sistema.
