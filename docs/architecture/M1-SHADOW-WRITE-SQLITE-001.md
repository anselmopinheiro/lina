# Relatório de Implementação: Phase M1 — Shadow Write SQLite Privado

> Documento de Arquitetura e Relatório de Execução (Fase M1)
> Data: 2026-10-04
> Ficheiro: `docs/architecture/M1-SHADOW-WRITE-SQLITE-001.md`

---

## 1. Objetivo

Implementar um `ProducerLocalStore` privado em SQLite funcional e integrar uma escrita paralela não-autoritativa (*shadow write*) no pipeline do Active Producer, mantendo o sistema legado (`embeddings.jsonl` e `manifest.json`) como única fonte de autoridade e sem alterar qualquer comportamento de leitura, pesquisa, publicação, Companion ou sincronização.

---

## 2. Runtime Proof

O preflight e a verificação empírica no plugin real do Obsidian Desktop (conforme registado em `docs/architecture/M1-RUNTIME-PROOF-OBSIDIAN-001.md` e no artefacto `docs/architecture/evidence/M1-RUNTIME-PROOF-OBSIDIAN-001.json`) confirmaram:

- **`node:sqlite`**: `AVAILABLE (PASS)`
- **Node.js**: `22.22.1`
- **Electron**: `39.8.3`
- **Chromium Engine**: `Chrome/142.0.7444.265`
- **`DatabaseSync`**: Nativo e disponível unflagged no executável `Obsidian.exe`.

---

## 3. Implementação do Store (`SqliteProducerLocalStore`)

Implementada a classe `SqliteProducerLocalStore` (`src/index/sqliteProducerLocalStore.ts`) sobre a interface `ProducerLocalStore`:

- **Carregamento Nativo Seguro**: Prova a disponibilidade de `node:sqlite` (`DatabaseSync`) no Electron do Obsidian sem pacotes npm externos.
- **Configuração de PRAGMAs**:
  - `PRAGMA journal_mode = WAL;`
  - `PRAGMA synchronous = FULL;`
  - `PRAGMA foreign_keys = ON;`
- **Interface e Operações**:
  - `open()` / `close()` idempotentes.
  - `upsertEmbeddingSpace(space)`
  - `upsertEmbeddingRecord(record)`
  - `upsertEmbeddingBatch(space, records)` (em transação explícita).
  - `getEmbeddingRecord(chunkId)` (com reconversão transparente para `Float32Array`).
  - `countRecords(spaceId?)`
  - `diagnose()` (estado, schema version, contagem de registos e diagnóstico).

---

## 4. Path Resolution e Decisão Linux/XDG

Atualizada a resolução de diretórios de armazenamento (`src/index/producerLocalStorePathResolver.ts`):

- **Windows**: `%LOCALAPPDATA%/lina/db/lina-producer.db` (fora da directoria Roaming para impedir sincronização de ficheiros WAL/SHM).
- **macOS**: `~/Library/Application Support/lina/db/lina-producer.db`
- **Linux / BSD**: `$XDG_STATE_HOME/lina/db/lina-producer.db` com fallback para `~/.local/state/lina/db/lina-producer.db`.
- **Separação do Vault**: `DefaultProducerLocalStorePathResolver` valida rigorosamente que o ficheiro `.db` e os seus artefactos temporários (`.db-wal`, `.db-shm`) residem estritamente fora da árvore de directoria do Vault.

---

## 5. Schema M1 Mínimo e Migrations

Implementadas as tabelas relacionais em SQLite:

1. **`schema_migrations`**:
   - `version` (INTEGER PRIMARY KEY)
   - `applied_at` (TEXT NOT NULL)
   - `description` (TEXT NOT NULL)
2. **`embedding_spaces`**:
   - `space_id` (TEXT PRIMARY KEY)
   - `vector_contract_id` (TEXT NOT NULL)
   - `provider` (TEXT NOT NULL)
   - `model` (TEXT NOT NULL)
   - `dimension` (INTEGER NOT NULL)
   - `dtype` (TEXT NOT NULL)
   - `input_version` (INTEGER NOT NULL)
   - `created_at`, `updated_at` (TEXT NOT NULL)
3. **`embedding_records`**:
   - `chunk_id` (TEXT PRIMARY KEY)
   - `space_id` (TEXT NOT NULL, FOREIGN KEY)
   - `note_path` (TEXT NOT NULL)
   - `chunk_index` (INTEGER NOT NULL)
   - `text_hash` (TEXT NOT NULL)
   - `vector_contract_id` (TEXT NOT NULL)
   - `embedding_blob` (BLOB NOT NULL — representação binária direta de `Float32Array`)
   - `created_at`, `updated_at` (TEXT NOT NULL)

---

## 6. Integração no Write Path (Shadow Write)

Criado o módulo `src/index/sqliteProducerShadowWriter.ts` e integrado em `publishCanonicalEmbeddings()` (`src/index/embeddingPersistence.ts`):

```text
cálculo de embedding
        ↓
persistência legada autoritativa (embeddings.jsonl + manifest.json)
        ↓ PASS
shadow write SQLite (performProducerSqliteShadowWrite)
        ↓
PASS → registo/métrica
FAIL → diagnóstico capturado; publicação legada mantida como SUCESSO
```

---

## 7. Feature Flag e Política de Erro

- **Flag Técnica**: `producerSqliteShadowWriteEnabled` (com default seguro `false`).
- **Política de Erro e Isolamento**:
  - `LEGADO = AUTORITATIVO` | `SQLITE = SHADOW`.
  - Qualquer exceção no SQLite é capturada e logada sem afetar a escrita autoritativa no sistema legado.
  - Se a persistência legada falhar, a shadow write SQLite não é executada.
  - Se o SQLite estiver indisponível no arranque, o Lina continua normalmente pelo pipeline legado.

---

## 8. Escopo Active Producer / Standby / Companion

- **Active Producer**: Único agente que executa shadow writes no SQLite privado local.
- **Standby Producer**: Zero escritas no SQLite.
- **Companion**: Zero abertura, importação ou dependência no SQLite privado.

---

## 9. Observabilidade

Logging sanitizado adicionado a `performProducerSqliteShadowWrite` e `SqliteProducerLocalStore.diagnose()`:
- Caminho da DB, versão de schema, número de registos e resultado da escrita (PASS/FAIL).
- **Conteúdo de notas, vetores completos e credenciais nunca são expostos em logs.**

---

## 10. Matriz Pedido vs. Execução

| Requisito do Prompt | Estado | Notas de Implementação |
| :--- | :---: | :--- |
| **Fechar Prova de Runtime** | `PASS` | `M1-RUNTIME-PROOF-OBSIDIAN-001.md` atualizado + `M1-RUNTIME-PROOF-OBSIDIAN-001.json` criado. |
| **Shadow Write Não-Autoritativo** | `PASS` | Executado estritamente após PASS da publicação legada. |
| **Linux XDG_STATE_HOME** | `PASS` | Resolvido para `$XDG_STATE_HOME/lina/db` com fallback `~/.local/state/lina/db`. |
| **Schema M1 Mínimo** | `PASS` | Tabelas `schema_migrations`, `embedding_spaces` e `embedding_records` com `Float32Array` BLOB. |
| **Idempotência de Migrations** | `PASS` | Migração v1 executada dentro de transação atómica em `open()`. |
| **Zero Dep. npm Externa** | `PASS` | Utilização exclusiva de `node:sqlite` (`DatabaseSync`). |
| **Esbuild Externalization** | `PASS` | `"node:sqlite"` mantido no array `external` do `esbuild.config.mjs`. |
| **Role Scoping** | `PASS` | Apenas Active Producer escreve; Companion e Standby ignoram o SQLite. |
| **Suíte de Testes M1** | `PASS` | 11 testes unitários novos em `sqliteProducerLocalStore.test.ts` + 16 testes em `producerLocalStorePathResolver.test.ts`. |
| **Preservação de Testes Globais** | `PASS` | 166 ficheiros / 2226 testes a passar a 100% verde (`npm test`). |

---

## 11. Limitações Conhecidas

- **Backfill Incompleto (Por Desenho)**: A Phase M1 cobre apenas novas escritas/reescritas em shadow write. O preenchimento/equivalência total da base de dados privada para registos existentes fica reservado para a Phase M2.

---

## 12. Validações do Repositório

- `npm run typecheck`: **PASS** (0 erros)
- `npm run lint`: **PASS** (0 erros, 0 avisos)
- `npm run build`: **PASS** (Build de produção e sincronização com o vault de teste efetuados)
- `npm test`: **PASS** (166 ficheiros / 2226 testes a passar)
- `git diff --check`: **PASS** (Sem erros de formatação)
- `git status --short`: **PASS** (Sem commits nem push efetuados)

---

## 13. Estado Git Actual

- Alterações e novos ficheiros mantidos exclusivamente na árvore de trabalho local.
- **Nenhum commit ou push foi efetuado.**

---

## 14. Conclusão

> O SQLite privado está funcional como shadow store sem alterar a autoridade ou comportamento do sistema legado?

**Resultado: `PASS`**

---

### Regra de Paragem
A Fase M1 está concluída e validada. A Fase M2 NÃO foi iniciada.
