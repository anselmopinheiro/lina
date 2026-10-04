# AUDITORIA ARQUITETURAL DE SEGUNDA ORDEM: ESTADOS DE PERSISTÊNCIA, OWNERSHIP E FRONTEIRA CANÓNICA NO LINA



**Documento:** `docs/architecture/AUDITORIA-ESTADOS-PERSISTENCIA-OWNERSHIP-001.md`  
**Referência:** `PROMPT-LINA-AUDITORIA-ESTADOS-PERSISTENCIA-OWNERSHIP-001`  
**Predecessor Imediato:** [`docs/architecture/AUDITORIA-INTEGRACAO-SQLITE-LINA-001.md`](file:///d:/_dev/obsidian/lina/docs/architecture/AUDITORIA-INTEGRACAO-SQLITE-LINA-001.md)  
**Autoridade:** 1. `AGENTS.md` · 2. Decisões Arquiteturais Documentadas · 3. Schemas/Contratos Existentes · 4. `ARQUITETURA-PERSISTENCIA-PUBLICACAO-EMBEDDINGS-001.md` · 5. Auditoria de Integração SQLite 001  
**Estado:** Relatório de Auditoria e Consolidação Documental (Exclusivamente de Análise — Sem Alterações de Código)  
**Data:** Outubro de 2026  

---

## 1. Sumário Executivo

A presente auditoria de segunda ordem fecha formalmente as ambiguidades sobre persistência de estado, autoridade de *ownership*, sincronização de ficheiros, ciclo de vida de *checkpoints* e a fronteira exata entre o código existente e as fases futuras M0–M7.

### 1.1 Principais Descobertas e Decisões Fechadas

1. **`ownership.json` é a Autoridade Global Canónica Única:**  
   - *Estado Atual:* O ficheiro [`.lina/ownership.json`](file:///d:/_dev/obsidian/lina/src/device/deviceOwnership.ts) é partilhado no Vault e coordenado por *epoch fencing* estrito. Apenas o Active Producer autorizado pode publicar no índice partilhado.  
   - *Decisão:* **Permanece `shared-canonical`**. Não é alterado por M0 nem substituído por SQLite.
2. **`exclusions.json` é Configuração Funcional do Utilizador Partilhada:**  
   - *Estado Atual:* [`.lina/exclusions.json`](file:///d:/_dev/obsidian/lina/src/index/exclusionPolicy.ts) armazena regras declarativas de exclusão com hashing SHA-256 e revisão monotónica, sincronizada para que todos os nós (Producer e Companions) excluam as mesmas pastas/conteúdos.  
   - *Decisão:* **Permanece `shared-canonical`**.
3. **`producer-state.json` é Redundante no Consumer e Desacoplado no Producer:**  
   - *Estado Atual:* [`.lina/producer-state.json`](file:///d:/_dev/obsidian/lina/src/device/producerState.ts) existe no Vault, mas no runtime real de produção o Producer publica metadados diretamente no [`manifest.json`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts) (`publicationId`, timestamps, contagens). O Companion inspeciona `producer-state.json` apenas como diagnóstico secundário opcional.  
   - *Decisão:* **Classificado como `producer-private` no futuro.** Não deve ser dependência mandatória de consumo no Consumer e não deve receber escritas frequentes de *heartbeat* no Vault para evitar `.sync-conflict`.
4. **Checkpoints no Vault são Transitórios e Vulneráveis:**  
   - *Estado Atual:* Checkpoints de lote de embeddings são gravados em [`.lina/producer/checkpoints/embeddings.checkpoint.jsonl`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L24-L25).  
   - *Decisão:* **Classificados como `legacy-to-remove` no Vault.** Checkpoints são estritamente locais ao processo gerador e serão migrados na íntegra para SQLite privado fora do Vault na fase M3.
5. **Identidades e Contratos Estáveis:** As identidades de Chunk (`path:index`), Nota (`path`), Vector Contract (`VectorContractV1`), Dispositivo (`deviceId` UUID v4) e Epoch (`epoch`) já existem e estão formalmente validadas; o DDL de M0 deve reutilizar estritamente estes contratos sem inventar novos esquemas de identificação.

---

## 2. Regra Metodológica: Separação de Estados

Para garantir rigor absoluto e eliminar confusão entre o que existe hoje e o que está planeado, este documento aplica a seguinte taxonomia:

- **[ESTADO ATUAL]:** O comportamento, ficheiro, função ou contrato que existe **hoje** no código de produção do repositório.
- **[ARQUITETURA-ALVO]:** O comportamento pretendido a longo prazo após a conclusão do roadmap M0–M7.
- **[PROPOSTA CANDIDATA]:** Hipótese de trabalho ou DDL sob avaliação técnica, suscetível de ajuste antes da implementação na respetiva fase.

---

## 3. Inventário Obrigatório de Ficheiros e Estados

### 3.1 Tabela de Inventário Factual

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   INVENTÁRIO DE ESTADOS DO LINA                                        │
├──────────────────────────────────────────────────┬─────────────────────────────┬───────────────────────┤
│ Caminho / Identificador                          │ Módulo Responsável          │ Natureza Factual      │
├──────────────────────────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ .lina/ownership.json                             │ deviceOwnership.ts          │ Autoridade e Fencing  │
│ .lina/exclusions.json                            │ exclusionPolicyService.ts   │ Regras de Exclusão    │
│ .lina/producer-state.json                        │ producerState.ts            │ Freshness Observada   │
│ .lina/devices/<deviceId>.json                    │ deviceState.ts              │ Hardware/Papel Local  │
│ .lina/index/manifest.json                        │ indexStore.ts               │ Manifesto Central     │
│ .lina/index/notes.json                           │ indexStore.ts               │ Metadados de Notas    │
│ .lina/index/chunks.jsonl                         │ indexStore.ts               │ Chunks Textuais       │
│ .lina/index/embeddings.jsonl                     │ embeddingPersistence.ts     │ Vetores JSONL Legado  │
│ .lina/index/embeddings.vectors.f32               │ embeddingBinaryStorage.ts   │ Cópia Binária Float32 │
│ .lina/index/embeddings.meta.jsonl                │ embeddingBinaryStorage.ts   │ Metadados da Cópia    │
│ .lina/index/embeddings.manifest.json             │ embeddingBinaryStorage.ts   │ Manifesto Binário     │
│ .lina/producer/checkpoints/*                     │ embeddingPersistence.ts     │ Checkpoints no Vault  │
│ .lina/producer/staging/*                         │ embeddingPersistence.ts     │ Ficheiros .tmp        │
│ .lina/producer/backups/*                         │ embeddingPersistence.ts     │ Ficheiros .backup     │
│ LocalStorage ("lina_device_id")                  │ deviceIdentity.ts           │ UUID Local do Dispos. │
│ app.secretStorage                                │ secretStorage.ts            │ API Keys no SO        │
│ .obsidian/plugins/lina/data.json                 │ settings.ts                 │ Settings Globais      │
│ ~/.lina/db/lina-producer.db (Fora do Vault)      │ target M0 (ProducerStore)   │ SQLite Privado Alvo   │
└──────────────────────────────────────────────────┴─────────────────────────────┴───────────────────────┘
```

---

## 4. Matriz de Classificação de Estados e Ficheiros

| Ficheiro / Estado                      | Escritor(es) Atuais               | Leitor(es) Atuais     | Localização Atual         | Sincronizado? | Classe Atual                  | Classe Alvo                                        | Risco de Conflito             | Evidência no Código                                                                                                  |
| -------------------------------------- | --------------------------------- | --------------------- | ------------------------- | ------------- | ----------------------------- | -------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.lina/ownership.json`                 | Active Producer (sob fence)       | Todos os dispositivos | Vault (`.lina/`)          | Sim           | `shared-canonical`            | `shared-canonical`                                 | Baixo (epoch fencing)         | [`deviceOwnership.ts#L210-L263`](file:///d:/_dev/obsidian/lina/src/device/deviceOwnership.ts#L210-L263)              |
| `.lina/exclusions.json`                | Active Producer (via UI Settings) | Producer e Companion  | Vault (`.lina/`)          | Sim           | `shared-canonical`            | `shared-canonical`                                 | Baixo (autoridade central)    | [`exclusionPolicyService.ts#L143-L200`](file:///d:/_dev/obsidian/lina/src/index/exclusionPolicyService.ts#L143-L200) |
| `.lina/producer-state.json`            | Active Producer                   | Companion (opcional)  | Vault (`.lina/`)          | Sim           | `shared-canonical`            | `producer-private` (metadados vão p/ geração)      | Médio (se escrito em loop)    | [`producerState.ts#L380-L457`](file:///d:/_dev/obsidian/lina/src/device/producerState.ts#L380-L457)                  |
| `.lina/devices/<id>.json`              | Dispositivo `<id>` exclusivamente | Todos (diagnóstico)   | Vault (`.lina/devices/`)  | Sim           | `device-local` (no vault)     | `device-local` (no vault)                          | Nulo (namespace por ID)       | [`deviceState.ts#L48-L56`](file:///d:/_dev/obsidian/lina/src/device/deviceState.ts#L48-L56)                          |
| `.lina/index/manifest.json`            | Active Producer                   | Todos os dispositivos | Vault (`.lina/index/`)    | Sim           | `shared-canonical`            | `legacy-to-remove` (substituído por `generation/`) | Alto (janela c/ JSONL)        | [`indexStore.ts#L152`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L152)                                   |
| `.lina/index/notes.json`               | Active Producer                   | Todos os dispositivos | Vault (`.lina/index/`)    | Sim           | `shared-canonical`            | `shared-canonical`                                 | Médio                         | [`indexStore.ts#L153`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L153)                                   |
| `.lina/index/chunks.jsonl`             | Active Producer                   | Todos os dispositivos | Vault (`.lina/index/`)    | Sim           | `shared-canonical`            | `shared-canonical`                                 | Médio                         | [`indexStore.ts#L154`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L154)                                   |
| `.lina/index/embeddings.jsonl`         | Active Producer                   | Todos os dispositivos | Vault (`.lina/index/`)    | Sim           | `shared-canonical`            | `legacy-to-remove` (removido em M7)                | Alto (grande volume de I/O)   | [`embeddingPersistence.ts#L22`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L22)                 |
| `.lina/index/embeddings.vectors.f32`   | Active Producer                   | Companion / Search    | Vault (`.lina/index/`)    | Sim           | `shared-canonical`            | `legacy-to-remove` (encapsulado em `gen/`)         | Médio                         | [`embeddingBinaryStorage.ts#L37`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts#L37)             |
| `.lina/index/embeddings.meta.jsonl`    | Active Producer                   | Companion / Search    | Vault (`.lina/index/`)    | Sim           | `shared-canonical`            | `legacy-to-remove` (encapsulado em `gen/`)         | Médio                         | [`embeddingBinaryStorage.ts#L36`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts#L36)             |
| `.lina/index/embeddings.manifest.json` | Active Producer                   | Companion / Search    | Vault (`.lina/index/`)    | Sim           | `shared-canonical`            | `legacy-to-remove` (encapsulado em `gen/`)         | Médio                         | [`embeddingBinaryStorage.ts#L25`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts#L25)             |
| `.lina/producer/checkpoints/*`         | Active Producer                   | Active Producer       | Vault (`.lina/producer/`) | Sim           | `producer-private` (no vault) | `legacy-to-remove` (vai p/ SQLite fora)            | Alto (ficheiros transitórios) | [`embeddingPersistence.ts#L24-L29`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L24-L29)         |
| `.lina/producer/staging/*`             | Active Producer                   | Active Producer       | Vault (`.lina/producer/`) | Sim           | `producer-private` (no vault) | `legacy-to-remove` (staging privado)               | Médio                         | [`embeddingPersistence.ts#L30-L33`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L30-L33)         |
| `LocalStorage ("lina_device_id")`      | Dispositivo local                 | Dispositivo local     | Navegador / Electron      | Não           | `device-local`                | `device-local`                                     | Zero                          | [`deviceIdentity.ts#L35-L48`](file:///d:/_dev/obsidian/lina/src/device/deviceIdentity.ts)                            |
| `app.secretStorage`                    | Dispositivo local                 | Dispositivo local     | SO Keychain               | Não           | `device-local`                | `device-local`                                     | Zero                          | [`secretStorage.ts#L9-L43`](file:///d:/_dev/obsidian/lina/src/device/secretStorage.ts#L9-L43)                        |
| `.obsidian/plugins/lina/data.json`     | Dispositivo local                 | Dispositivo local     | Vault (`.obsidian/`)      | Configurável  | `device-local`                | `device-local`                                     | Baixo                         | [`settings.ts#L116-L160`](file:///d:/_dev/obsidian/lina/src/settings.ts#L116-L160)                                   |
| `.lina/index/CURRENT`                  | Active Producer                   | Todos os dispositivos | Vault (`.lina/index/`)    | Sim           | Inexistente (Alvo M4)         | `shared-canonical`                                 | Baixo (apontador atómico)     | Proposta Alvo M4                                                                                                     |
| `.lina/index/generations/*`            | Active Producer                   | Todos os dispositivos | Vault (`.lina/index/`)    | Sim           | Inexistente (Alvo M4)         | `consumer-readable`                                | Zero (pastas imutáveis)       | Proposta Alvo M4                                                                                                     |
| `~/.lina/db/lina-producer.db`          | Active Producer                   | Active Producer       | SO AppData (fora Vault)   | Não           | Inexistente (Alvo M0)         | `producer-private`                                 | Zero (fora do Vault)          | Proposta Alvo M0                                                                                                     |

---

## 5. Auditoria Específica de `producer-state.json`

### 5.1 Onde é Criado e Quem Escreve

- **[ESTADO ATUAL]:** O módulo [`src/device/producerState.ts`](file:///d:/_dev/obsidian/lina/src/device/producerState.ts) define o contrato [`ProducerStateV1`](file:///d:/_dev/obsidian/lina/src/device/producerState.ts#L62-L70) e a função [`saveProducerState`](file:///d:/_dev/obsidian/lina/src/device/producerState.ts#L380-L457). A escrita exige validação estrita de autoridade (`ownership.activeProducerId === state.activeProducerId` e `ownership.epoch === state.producerEpoch`).
- **[FACTO CRÍTICO AUDITADO]:** Na execução real de produção, [`EmbeddingPersistence.publishCanonicalEmbeddings`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L919) e [`indexStore.saveTextIndex`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L300) **não chamam `saveProducerState` automaticamente**. O estado de publicação (`publicationId`, timestamps, `vectorContract`, `totalEmbeddings`) é gravado diretamente no [`manifest.json`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts).

### 5.2 Quem Lê e Quando

- **[ESTADO ATUAL]:** O módulo [`companionConsumptionState.ts`](file:///d:/_dev/obsidian/lina/src/companion/companionConsumptionState.ts#L147-L156) tenta ler `producer-state.json` através de `loadProducerState` para calcular métricas de frescura (`producerFreshness`, `producerHeartbeatFreshness`). No entanto, se o ficheiro estiver ausente (`null`), o Companion continua 100% operacional, obtendo os metadados diretamente do `manifest.json`.

### 5.3 Natureza do Conteúdo: Transitório vs Canónico

- O `ProducerStateV1` mistura dois tipos de dados:
  1. **Metadados Canónicos de Publicação:** `textIndex.lastSuccessfulPublicationAt`, `embeddings.publicationId`, `embeddings.vectorContractId`. (Estes dados são estritamente redundantes com o `manifest.json`).
  2. **Metadados Operacionais Transitórios:** `maintenance.status` (`"idle" | "running" | "backoff" | "error"`), `maintenance.lastError`, `maintenance.lastRunAt`.

### 5.4 Decisão Arquitetural para a Arquitetura-Alvo

- **[ARQUITETURA-ALVO]:** O `producer-state.json` **não deve ser mantido como dependência canónica de sincronização**.
- Os dados canónicos de geração passam a residir exclusivamente na pasta imutável `generation-XXXXXX/manifest.json`.
- O estado de manutenção transitório do Producer (`maintenance.status`, erros, progresso de batches) pertence ao **SQLite privado local** do Producer (`~/.lina/db/lina-producer.db`).
- **Classificação Alvo:** `producer-private` (eliminando a escrita deste ficheiro no Vault nas fases futuras).

---

## 6. Auditoria Específica de `ownership.json`

### 6.1 Writer Autorizado e Fencing

- **[ESTADO ATUAL]:** [`saveOwnership`](file:///d:/_dev/obsidian/lina/src/device/deviceOwnership.ts#L213-L263) é a única função autorizada a gravar em `.lina/ownership.json`.
- A escrita é protegida por transição de *epoch* monotónica.
- Cada operação de escrita no Vault captura um [`IndexWriteFence`](file:///d:/_dev/obsidian/lina/src/index/writeFence.ts#L7-L11) contendo `{ producerDeviceId, epoch }`. Antes de qualquer mutação física (`write`, `rename`, `remove`), o adapter interceptor executa [`assertIndexWriteFence`](file:///d:/_dev/obsidian/lina/src/index/writeFence.ts#L15-L19), relendo o `ownership.json` factual. Se outro nó tiver incrementado o epoch ou reclamado ownership, a operação falha imediatamente com [`OwnershipFenceRejectedError`](file:///d:/_dev/obsidian/lina/src/index/writeFence.ts#L13).

### 6.2 Comportamento Offline e Transições

- Dispositivos Standby ou Companion operam estritamente como leitores (`loadOwnership` / `readOwnership`).
- Se um Producer estiver offline, continua a trabalhar localmente; ao reconectar, a sua autoridade é validada contra o epoch sincronizado. Se o epoch divergir, o Producer entra em estado de perda de autoridade sem corromper o índice partilhado.

### 6.3 Decisão Arquitetural para a Arquitetura-Alvo

- **[ARQUITETURA-ALVO]:** `ownership.json` **deve permanecer `shared-canonical` no Vault**.
- A base SQLite local do Producer não substitui a autoridade distribuída do Vault. O SQLite local do Producer valida o seu *ownership fence* antes de iniciar compilações e publicações para o Vault.

---

## 7. Auditoria Específica de `exclusions.json`

### 7.1 Writer e Leitores

- **[ESTADO ATUAL]:** [`ExclusionPolicyService.saveExclusionPolicy`](file:///d:/_dev/obsidian/lina/src/index/exclusionPolicyService.ts#L143-L200) escreve `.lina/exclusions.json` apenas quando o utilizador altera as pastas/termos excluídos nas Settings e o dispositivo detém autoridade (`gate.canPublish() === true`).
- Leitores: Todos os dispositivos (Producer ao ler/chunkar notas; Companion ao filtrar resultados de pesquisa local com [`evaluateExclusionPolicyCompatibility`](file:///d:/_dev/obsidian/lina/src/index/exclusionPolicy.ts#L30)).

### 7.2 Natureza: Configuração Funcional Partilhada

- As regras de exclusão definem o âmbito do conhecimento do Vault (e.g. ignorar pasta `Privado/` ou notas com tag `#segredo`).
- Se não fossem partilhadas, um Companion realizaria pesquisas em chunks que o Producer pretendia ocultar, violando a política de privacidade do utilizador.

### 7.3 Decisão Arquitetural para a Arquitetura-Alvo

- **[ARQUITETURA-ALVO]:** `exclusions.json` **deve permanecer `shared-canonical` no Vault**.
- O SQLite local do Producer armazena uma cópia espelhada da política ativa para filtrar queries SQL, mas a fonte da verdade da política do Vault continua a ser `.lina/exclusions.json`.

---

## 8. Checkpoints e Estado Transitório

### 8.1 Inventário de Checkpoints no Estado Atual

```text
.lina/producer/
  checkpoints/
    embeddings.checkpoint.jsonl       <-- [ESTADO ATUAL: Vetores parciais gerados em lote]
    embeddings.checkpoint.meta.json   <-- [ESTADO ATUAL: Metadados do lote e progresso]
  staging/
    embeddings.publish.tmp            <-- [ESTADO ATUAL: Ficheiro temporário pré-renomeação]
    manifest.publish.tmp              <-- [ESTADO ATUAL: Manifesto temporário pré-renomeação]
  backups/
    embeddings.publish.backup         <-- [ESTADO ATUAL: Backup de segurança para rollback]
    manifest.publish.backup           <-- [ESTADO ATUAL: Backup de segurança para rollback]
```

### 8.2 Análise de Necessidade e Localização

| Estado Transitório / Checkpoint   | Necessário após Restart?     | Necessário entre Dispositivos? | Derivável / Descartável?   | Classificação Atual           | Classificação Alvo                       |
| --------------------------------- | ---------------------------- | ------------------------------ | -------------------------- | ----------------------------- | ---------------------------------------- |
| `embeddings.checkpoint.jsonl`     | Sim (retoma batch longo)     | **NÃO (estritamente local)**   | Descartável (recalculável) | `producer-private` (no vault) | **`legacy-to-remove` (vai p/ SQLite)**   |
| `embeddings.checkpoint.meta.json` | Sim (valida compatibilidade) | **NÃO (estritamente local)**   | Descartável                | `producer-private` (no vault) | **`legacy-to-remove` (vai p/ SQLite)**   |
| `staging/*.tmp`                   | Não (lixo após crash)        | **NÃO**                        | Descartável                | `producer-private` (no vault) | **`legacy-to-remove` (staging privado)** |
| `backups/*.backup`                | Sim (durante recovery)       | **NÃO**                        | Transitório                | `producer-private` (no vault) | **`legacy-to-remove` (staging privado)** |

### 8.3 Conclusão de Checkpoints

- **[ARQUITETURA-ALVO]:** Todos os ficheiros em `.lina/producer/*` são anomalias históricas por residirem dentro do Vault. Sincronizadores externos transmitem frequentemente `.checkpoint.jsonl` incompletos de centenas de megabytes para telemóveis.
- Na fase M3, a tabela `operation_checkpoints` e as tabelas de dados em SQLite assumem 100% desta responsabilidade, eliminando a pasta `.lina/producer/` do Vault.

---

## 9. Escritores Múltiplos e Risco de `.sync-conflict`

| Ficheiro no Vault     | Pode ser escrito por 2 dispositivos? | Cenário de Risco Concreto                                               | Risco Real  | Proteção Atual Existente                                                     | Gap Arquitetural                                                    |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ownership.json`      | Sim                                  | 2 nós tentam reclamar ownership inicial ao mesmo tempo em vaults vazios | Baixo       | `claimInitialOwnership` valida `exists`; epoch fencing serializa pós-criação | Sincronização externa pode atrasar observação do ficheiro inicial   |
| `producer-state.json` | Não (em teoria)                      | Se 2 nós assumirem papel producer incorretamente                        | Médio       | Valida `activeProducerId` e `epoch` do `ownership.json`                      | Ficheiro é gravado com frequência no Vault                          |
| `exclusions.json`     | Não                                  | Apenas o Active Producer autorizado grava                               | Muito Baixo | Gating por `canPublish()` e staged rename                                    | Nenhum                                                              |
| `manifest.json`       | Não                                  | Apenas Active Producer grava                                            | Alto        | Renomeação atómica e backup                                                  | Não-atómico com `embeddings.jsonl`                                  |
| `embeddings.jsonl`    | Não                                  | Apenas Active Producer grava                                            | Muito Alto  | Renomeação com retry                                                         | Ficheiro monolítico de dezenas de MB; sync parcial corrompe leitura |
| `checkpoints/*`       | Não                                  | Apenas Active Producer grava                                            | Alto        | Limpeza e validação                                                          | Ficheiros transitórios sincronizados desnecessariamente             |
| `devices/<id>.json`   | **NÃO**                              | Cada nó grava estritamente no seu ficheiro `<meu-id>.json`              | **Zero**    | Namespace por UUID v4                                                        | Nenhum (design perfeito)                                            |

---

## 10. Auditoria de Compatibilidade do DDL Candidato

### 10.1 Avaliação Tabela a Tabela

#### 1. `schema_migrations`

- **Classificação:** `CONFIRMADA COMO NECESSÁRIA`.
- **Justificação:** Padrão obrigatório para evolução de bases de dados locais sem perda de dados.
- **Campos:** `version INTEGER PRIMARY KEY`, `applied_at TEXT`, `description TEXT`.

#### 2. `embedding_spaces`

- **Classificação:** `CONFIRMADA COMO NECESSÁRIA`.
- **Justificação:** Isola modelos de IA distintos (`provider`, `model`, `dimensions`, `vector_contract_id`). Corresponde exatamente à interface [`VectorContractV1`](file:///d:/_dev/obsidian/lina/src/index/vectorContract.ts#L10-L18).
- **Mapeamento:** Alimenta-se diretamente das configurações de provider/modelo e do manifesto de embeddings.

#### 3. `embedding_records`

- **Classificação:** `CONFIRMADA COMO NECESSÁRIA`.
- **Justificação:** Tabela central de persistência dos vetores. Substitui `embeddings.jsonl`.
- **Mapeamento de Identificadores:**
  - `chunk_id` (`TEXT PRIMARY KEY`): Corresponde a `record.chunkId` (`path:index`).
  - `space_id` (`TEXT`): FK para `embedding_spaces`.
  - `note_path` (`TEXT`): Corresponde a `record.path`.
  - `chunk_index` (`INTEGER`): Corresponde a `record.index`.
  - `text_hash` (`TEXT`): Corresponde a `record.textHash` (SHA-256 do chunk).
  - `input_hash` (`TEXT`): Corresponde a `record.embeddingInputHash` (SHA-256 do texto formatado).
  - `embedding_blob` (`BLOB`): Vetor `Float32Array` contíguo binário (tamanho exato: `dimensions * 4` bytes).

#### 4. `operation_checkpoints`

- **Classificação:** `PLAUSÍVEL MAS PROVISÓRIA`.
- **Revisão Necessária:** Não necessita de armazenar chunks individuais redundantes; o progresso é derivado diretamente da presença dos registos em `embedding_records` associados ao `space_id` e `operation_id`.
- **Ajuste:** Manter como tabela leve de metadados de execução (`operation_id`, `space_id`, `status`, `started_at`, `completed_at`, `total_chunks`, `error`).

#### 5. `published_generations`

- **Classificação:** `PLAUSÍVEL MAS PROVISÓRIA`.
- **Revisão Necessária:** Serve como catálogo e auditoria local do Producer para saber que gerações foram compiladas e exportadas para o Vault. A fonte da verdade para o Consumer continua a ser a pasta física `generations/` no Vault.

---

## 11. Identidades e Ciclo de Vida do Sistema

| Entidade                  | Identificador Canónico Real  | Tipo / Formato                       | Origem / Contrato no Código                                                                            | Estado da Identidade |
| ------------------------- | ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------- |
| **Nota / Ficheiro**       | `path`                       | String normalizada                   | `TFile.path` (Obsidian Vault)                                                                          | Existente e Estável  |
| **Chunk**                 | `chunkId`                    | `${path}:${index}`                   | [`Chunk.id`](file:///d:/_dev/obsidian/lina/src/index/chunker.ts)                                       | Existente e Estável  |
| **Hash do Chunk**         | `textHash`                   | `sha256:<hex>`                       | [`hashContent`](file:///d:/_dev/obsidian/lina/src/index/noteHasher.ts)                                 | Existente e Estável  |
| **Input Formatado**       | `embeddingInputHash`         | `sha256:<hex>`                       | [`buildEmbeddingInput`](file:///d:/_dev/obsidian/lina/src/index/embeddingGenerator.ts)                 | Existente e Estável  |
| **Contrato Vetorial**     | `vectorContractId`           | `vc-<prov>-<mod>-<dim>-<met>-v<ver>` | [`createVectorContract`](file:///d:/_dev/obsidian/lina/src/index/vectorContract.ts)                    | Existente e Estável  |
| **Dispositivo**           | `deviceId`                   | UUID v4                              | LocalStorage `lina_device_id`                                                                          | Existente e Estável  |
| **Active Producer**       | `activeProducerId` + `epoch` | UUID v4 + Inteiro $\ge 1$            | [`OwnershipManifest`](file:///d:/_dev/obsidian/lina/src/device/deviceOwnership.ts)                     | Existente e Estável  |
| **Geração de Texto**      | `generationId`               | `gen-<base36>-<rand>`                | [`createTextGenerationId`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L71)                  | Existente e Estável  |
| **Publicação Embeddings** | `publicationId`              | `emb-<base36>-<rand>`                | [`createEmbeddingPublicationId`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L106) | Existente e Estável  |
| **Geração Alvo M4**       | `generationId`               | `gen-<epoch>-<timestamp>-<rand>`     | Proposta Alvo M4                                                                                       | A formalizar em M4   |

*Regra Invariante:* Nenhuma nova identidade artificial deve ser criada na fase M0. O store local deve operar estritamente com `chunkId`, `note_path`, `textHash` e `vectorContractId`.

---

## 12. Impacto no Roadmap M0–M7

| Descoberta da Auditoria                                    | Fase Afetada | Ajuste Arquitetural Concreto                                                                          | Bloqueante para M0? |
| ---------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- | ------------------- |
| `producer-state.json` não é atualizado no loop do Producer | M3, M4       | M3/M4 não precisam de sincronizar `producer-state.json` no Vault; metadados vão direto para a geração | **Não**             |
| Checkpoints do Vault são redundantes                       | M3           | M3 remove totalmente a escrita em `.lina/producer/checkpoints/*`                                      | **Não**             |
| `exclusions.json` tem de ser partilhado                    | M0, M3       | SQLite não substitui `exclusions.json` no Vault; apenas lê regras para queries locais                 | **Não**             |
| Identidade de Chunk é `${path}:${index}`                   | M0           | Tabela `embedding_records` usa exatamente `chunk_id TEXT PRIMARY KEY`                                 | **Não** (Alinhado)  |
| `CURRENT` precisa de escrita atómica                       | M4           | Especificação de M4 deve usar escrita temporária + renomeação para o ficheiro `CURRENT`               | **Não**             |

---

## 13. Decisões Arquiteturais Consolidadas

### 13.1 Decisões Fechadas

1. **`ownership.json` Permanece `shared-canonical` no Vault:** É a âncora de autoridade e consenso entre múltiplos nós.
2. **`exclusions.json` Permanece `shared-canonical` no Vault:** Garante que todos os dispositivos aplicam as mesmas regras de privacidade.
3. **`devices/<deviceId>.json` Permanece `device-local` no Vault:** Mantém o isolamento de configurações de hardware por nó.
4. **`producer-state.json` Desacoplado do Consumo Canónico:** Não é fonte de verdade para o Consumer; metadados canónicos pertencem à geração publicada.
5. **Checkpoints Eliminados do Vault:** Toda a persistência intermediária de lotes de embeddings passa a residir exclusivamente em SQLite privado fora do Vault (`producer-private`).
6. **Zero SQLite no Consumer:** Dispositivos Companion (e Mobile) nunca instanciam SQLite nem `node:sqlite`; consomem apenas os buffers binários exportados pelo Producer no Vault.
7. **Zero Mutação de Notas do Utilizador:** O plugin continua estritamente proibido de alterar ficheiros Markdown sem autorização explícita.

### 13.2 Decisões Abertas (Para Fases Posteriores)

1. **Política de Retenção de Gerações no Vault (Fase M4):** Definir se o Producer mantém 2 ou 3 pastas de geração antigas no Vault antes de executar limpeza (`purge`).
2. **Formato de Metadados na Geração (Fase M4):** Confirmar se `records.json` dentro da pasta de geração será JSON simples ou JSONL compactado.
3. **Mapeamento de Múltiplos Espaços no UI (Fase M6):** Definir como a interface de settings apresentará a alternância entre múltiplos modelos de IA guardados no SQLite.

---

## 14. O Que NÃO Alterar na Fase M0

Para garantir segurança máxima e total ausência de regressões, a Fase M0 fica estritamente delimitada:

- ❌ **NÃO alterar** `src/device/deviceOwnership.ts` ou `src/index/writeFence.ts`.
- ❌ **NÃO alterar** `src/index/exclusionPolicy.ts` ou `src/index/exclusionPolicyService.ts`.
- ❌ **NÃO alterar** `src/device/producerState.ts`.
- ❌ **NÃO alterar** `src/index/embeddingPersistence.ts` ou `src/index/indexStore.ts`.
- ❌ **NÃO alterar** `src/index/embeddingGenerator.ts`, `src/maintenance/embeddingWorker.ts` ou `src/index/embeddingOperationManager.ts`.
- ❌ **NÃO alterar** o pipeline de leitura do Consumer ([`companionConsumptionState.ts`](file:///d:/_dev/obsidian/lina/src/companion/companionConsumptionState.ts) ou [`runtimeEmbeddingIndex.ts`](file:///d:/_dev/obsidian/lina/src/search/runtimeEmbeddingIndex.ts)).
- ❌ **NÃO alterar** as configurações do plugin em `src/settings.ts`.
- ❌ **NÃO criar** ficheiros dentro do Vault.

**Âmbito Exclusivo de M0:** Implementar de forma 100% isolada e inerte a classe `ProducerLocalStore` (com `node:sqlite` / `DatabaseSync`), o schema SQL em diretório externo fora do Vault e a respetiva suíte de testes unitários.

---

## 15. Matriz Pedido → Evidência

| Exigência da Prompt                      | Secção no Relatório   | Evidência e Contratos Auditados                     | Estado   |
| ---------------------------------------- | --------------------- | --------------------------------------------------- | -------- |
| 1. Ficheiros partilhados/sincronizados   | Secção 3.1, 4         | Tabela completa de caminhos e sincronização         | Conforme |
| 2. Ficheiros com múltiplos escritores    | Secção 4, 9           | Análise de `ownership.json`, `devices/*.json`, etc. | Conforme |
| 3. Classificação em 5 categorias         | Secção 4              | Matriz com `device-local`, `producer-private`, etc. | Conforme |
| 4. Papel real de `producer-state.json`   | Secção 5              | Auditoria aprofundada de `producerState.ts`         | Conforme |
| 5. Papel real de `ownership.json`        | Secção 6              | Auditoria de `deviceOwnership.ts` e `writeFence.ts` | Conforme |
| 6. Papel real de `exclusions.json`       | Secção 7              | Auditoria de `exclusionPolicyService.ts`            | Conforme |
| 7. Checkpoints atuais no Vault           | Secção 8              | Mapeamento de `.lina/producer/checkpoints/*`        | Conforme |
| 8. Checkpoints apenas locais             | Secção 8.2            | Migração total para SQLite privado                  | Conforme |
| 9. Estados que causam `.sync-conflict`   | Secção 9              | Análise por ficheiro e mitigação                    | Conforme |
| 10. Separação Atual vs Alvo vs Candidato | Secção 2 e todo o doc | Tags `[ESTADO ATUAL]`, `[ARQUITETURA-ALVO]`         | Conforme |
| 11. Compatibilidade do DDL               | Secção 10             | Auditoria tabela a tabela contra código real        | Conforme |
| 12. DDL provisório vs confirmado         | Secção 10.1           | Classificação formal de cada tabela                 | Conforme |
| 13. Identidades e Lifecycle              | Secção 11             | Tabela com 10 identidades reais auditadas           | Conforme |
| 14. Impacto no roadmap M0–M7             | Secção 12             | Tabela de impactos sem redesenho cego               | Conforme |
| 15. Decisões fechadas e abertas          | Secção 13             | Listagem clara e inequívoca                         | Conforme |
| 16. Não alterar em M0                    | Secção 14             | Delimitação estrita de barreiras para M0            | Conforme |
| 17. Evidência factual com links          | Todas                 | Links com protocolo `file:///` e números de linha   | Conforme |
| 18. Validações e Git                     | Secção 16             | Sem commit, sem push, relatório de status           | Conforme |
| 19. Regra de Paragem                     | Fim                   | Parar após criação do documento                     | Conforme |

---

## 16. Estado do Repositório e Confirmação Git

- **Branch Atual:** `master`
- **Ficheiros Criados nesta Sessão:**
  1. [`docs/architecture/AUDITORIA-INTEGRACAO-SQLITE-LINA-001.md`](file:///d:/_dev/obsidian/lina/docs/architecture/AUDITORIA-INTEGRACAO-SQLITE-LINA-001.md)
  2. [`docs/architecture/AUDITORIA-ESTADOS-PERSISTENCIA-OWNERSHIP-001.md`](file:///d:/_dev/obsidian/lina/docs/architecture/AUDITORIA-ESTADOS-PERSISTENCIA-OWNERSHIP-001.md)
- **Alterações de Código de Produção:** Nenhuma.
- **Validações Executadas:** `git status` e `git diff --check`.
- **Confirmação:** **Não foi efetuado qualquer commit ou push.** A execução cessa aqui em cumprimento estrito da Regra de Paragem.
