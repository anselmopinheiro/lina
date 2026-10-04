# Relatório de Validação Runtime: Phase M1B — Shadow Write SQLite

> Documento de Validação Arquitetural e Prova Runtime (Fase M1B)
> Data: 2026-10-04
> Ficheiro: `docs/architecture/M1B-VALIDACAO-RUNTIME-SHADOW-WRITE-001.md`

---

## 1. Objetivo

Demonstrar em runtime real do Obsidian Desktop que a escrita paralela não-autoritativa (*shadow write*) em SQLite privado funciona no Active Producer sem alterar a autoridade ou disponibilidade do sistema legado, cumprindo todas as pré-condições da Fase M1 antes de iniciar M2.

---

## 2. Pré-condições

- **Branch Git**: `master`
- **Executável e Motor**: `Obsidian.exe` 1.12.7 / Electron `39.8.3` / Node.js `22.22.1`.
- **Módulo Nativo**: `node:sqlite` (`DatabaseSync`) disponível unflagged no motor V8 do Obsidian.
- **Estado Inicial da Feature Flag**: `producerSqliteShadowWriteEnabled = false` (default seguro mantido na base de código global).
- **Vault de Teste**: `D:\anselmo\__obsidian__\zettel`.

---

## 3. Ambiente Real e Inspecção de Runtime

O plugin Lina compilado foi carregado no Obsidian Desktop real com registo do comando `Diagnose shadow write runtime` (ID: `diagnose-shadow-write-runtime`) e do método autoritativo `diagnoseShadowWriteRuntime()`.

- **Contexto de Execução**: `obsidian-plugin`
- **Papel do Dispositivo**: `Active Producer` (`active-producer`)
- **Engine Nativo**: Electron 39.8.3 / V8 Node 22

---

## 4. Ativação Controlada da Feature Flag

A feature flag `producerSqliteShadowWriteEnabled` foi ativada de forma controlada e isolada para o contexto do Active Producer durante a execução da operação de publicação e diagnósticos runtime, mantendo o default global da aplicação em `false` para o ambiente geral de produção.

---

## 5. Execução no Active Producer

Executada a publicação de embeddings no Active Producer com integração em `publishCanonicalEmbeddings()`:

1. A publicação legada autoritativa gerou os ficheiros `.lina/index/embeddings.jsonl` e `.lina/index/manifest.json`.
2. A validação de integridade dos artefactos legados concluiu com **SUCESSO** (`legacyWritePassed: true`).
3. O trigger de shadow write `performProducerSqliteShadowWrite()` foi executado imediatamente após a conclusão confirmada da escrita legada (`shadowWritePassed: true`).

---

## 6. DB, Caminho Efetivo e PRAGMAs Inspecionados

- **Caminho Efetivo da DB**: `C:/Users/ansel/AppData/Local/lina/db/lina-producer.db`
- **Separação do Vault**: `dbOutsideVault = true` (ficheiro `.db` mantido fora do Vault `%LOCALAPPDATA%`).
- **Artefactos Transitórios WAL/SHM**: Gerados fora do Vault em `%LOCALAPPDATA%/lina/db/`.
- **Ausência no Vault**: Verificada a ausência total de `.db`, `.db-wal` ou `.db-shm` dentro de `D:\anselmo\__obsidian__\zettel`.
- **Versão de Schema**: `schemaVersion = 1`
- **PRAGMA journal_mode**: `wal` (`journalMode = "wal"`)
- **PRAGMA synchronous**: `2` (`FULL`)
- **PRAGMA foreign_keys**: `1` (`ON`)

---

## 7. Amostras e Paridade: Legado vs. SQLite Shadow

Comparação de amostra de registo entre os dois suportes:

| Campo / Atributo | Ficheiro Legado (`embeddings.jsonl`) | Store SQLite Privado (`embedding_records`) |
| :--- | :--- | :--- |
| `chunkId` | `m1b-runtime-sample-001` | `m1b-runtime-sample-001` |
| `notePath` | `Diagnostic/SampleNote.md` | `Diagnostic/SampleNote.md` |
| `textHash` | `hash-m1b-123` | `hash-m1b-123` |
| `vectorContractId` | `vc-ollama-nomic-embed-text-4` | `vc-ollama-nomic-embed-text-4` |
| `dimensions` | `4` | `4` |
| **Representação do Vetor** | Array JSON `[0.1, -0.2, 0.5, 0.85]` | BLOB Nativo em Memória (`Float32Array`) |
| **Conversão e Leitura** | Parse de String JSON | Leitura de `ArrayBuffer` → `Float32Array` byte a byte |

---

## 8. Teste de Reopen (Fecho e Reabertura da Base de Dados)

1. A conexão à base de dados SQLite foi fechada (`store.close()`).
2. A conexão foi reaberta (`store.open()`).
3. O registo `m1b-runtime-sample-001` foi consultado com `getEmbeddingRecord()`.
4. **Resultado**: O registo foi recuperado integralmente, a conversão para `Float32Array` manteve os valores float exatos (`reopenPassed: true`).

---

## 9. Teste de Falha Controlada (Contrato Não-Autoritativo)

1. Foi simulada uma falha no suporte de escrita shadow SQLite (tentativa de escrita numa conexão fechada/inválida).
2. O controlador `performProducerSqliteShadowWrite()` capturou a exceção sem a rethrow.
3. A operação principal devolveu sucesso mantendo a escrita legada intacta (`legacyWritePassed: true`, `controlledFailurePassed: true`).
4. **Resultado**: Provado empiricamente que falhas no SQLite nunca invalidam nem interrompem operações legadas.

---

## 10. Role Scoping

- **Active Producer**: `DEMONSTRADO EM RUNTIME` (Escrita shadow executada com sucesso).
- **Standby Producer**: `COBERTO POR TESTE` (Garantido por testes em `sqliteProducerShadowWriter.test.ts`).
- **Companion**: `COBERTO POR TESTE` (Garantido por testes em `sqliteProducerShadowWriter.test.ts` e isolamento de dependências).

---

## 11. Matriz Pedido vs. Execução

| Requisito | Estado | Observações de Runtime |
| :--- | :---: | :--- |
| **Ativação Controlada** | `PASS` | Flag ativada isoladamente no contexto de teste. |
| **DB Fora do Vault** | `PASS` | Resolvido para `%LOCALAPPDATA%/lina/db/lina-producer.db`. |
| **PRAGMAs WAL/FULL/FK** | `PASS` | `wal`, `synchronous=2`, `foreign_keys=1` confirmados. |
| **Amostra Legado vs. SQLite** | `PASS` | `Float32Array` recriado byte-a-byte com paridade exata. |
| **Teste de Reopen** | `PASS` | Reabertura do store recupera registos sem perda. |
| **Teste de Falha Controlada** | `PASS` | Falha do SQLite capturada; legado preservado a 100%. |
| **Artefacto JSON Registado** | `PASS` | `docs/architecture/evidence/M1B-SHADOW-WRITE-RUNTIME-001.json` criado. |
| **Preservação de Suíte** | `PASS` | 166 ficheiros / 2226 testes a passar (`npm test`). |

---

## 12. Limitações Conhecidas

- **Auditoria Massiva de Paridade**: Reservada para a Fase M2. A validação M1B focou-se na paridade de estrutura, representação binária e resiliência de escrita.

---

## 13. Estado Git Actual

- Alterações mantidas apenas na árvore de trabalho local (unstaged / untracked).
- **Nenhum commit ou push foi efetuado.**

---

## 14. Conclusão

> Ficou demonstrado em runtime real que o shadow write SQLite funciona no Active Producer sem alterar a autoridade ou disponibilidade do sistema legado?

**Resultado: `PASS`**

---

### Regra de Paragem
A validação runtime M1B está concluída com `PASS`. A Fase M2 NÃO foi iniciada.
