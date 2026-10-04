# RELATÓRIO DE EXECUÇÃO: FASE M0 — CONTRATOS E PATH RESOLVER DO PRODUCER LOCAL STORE

**Documento:** `docs/architecture/M0-CONTRATOS-PRODUCER-LOCAL-STORE-001.md`  
**Referência:** `PROMPT-LINA-M0-CONTRATOS-PRODUCER-LOCAL-STORE-001`  
**Autoridade:** 1. `AGENTS.md` · 2. Decisões Arquiteturais Documentadas · 3. Contratos/Schemas Atuais · 4. `ARQUITETURA-PERSISTENCIA-PUBLICACAO-EMBEDDINGS-001.md` · 5. Auditorias Anteriores · 6. Prompt M0  
**Estado:** Relatório de Conclusão da Fase M0  
**Data:** Outubro de 2026  

---

## 1. Objetivo da Fase M0

A Fase M0 é estritamente preparatória e introduz os contratos, tipos, paths e abstrações mínimas necessárias para suportar no futuro o `ProducerLocalStore` SQLite privado fora do Vault, **sem ativar SQLite em runtime, sem criar dual-write, sem migrar dados, sem alterar ownership, sincronização, pesquisa ou papéis de dispositivo**.

---

## 2. Fontes de Autoridade e Decisões Preservadas

A execução respeitou integralmente as decisões já fechadas:
- SQLite local como futura fonte canónica exclusiva do Active Producer;
- Base de dados fora do Vault (`~/.lina/db/` ou `%APPDATA%/lina/db/`);
- Ficheiros de base de dados (`.db`, `-wal`, `-shm`) 100% não sincronizados;
- Embeddings em BLOB `Float32Array` contíguo binário;
- [`.lina/ownership.json`](file:///d:/_dev/obsidian/lina/src/device/deviceOwnership.ts) e [`.lina/exclusions.json`](file:///d:/_dev/obsidian/lina/src/index/exclusionPolicy.ts) preservados como `shared-canonical`;
- [`.lina/producer-state.json`](file:///d:/_dev/obsidian/lina/src/device/producerState.ts) inalterado em M0;
- Checkpoints e persistência legada no Vault inalterados em M0;
- Consumer/Companion sem qualquer dependência de SQLite;
- Zero alteração em notas de utilizador.

---

## 3. Alterações Realizadas

Foram criados **exclusivamente 3 ficheiros novos**, permanecendo 100% inertes em runtime de produção:

1. [`src/index/producerLocalStoreTypes.ts`](file:///d:/_dev/obsidian/lina/src/index/producerLocalStoreTypes.ts): Contratos de interface, tipos de dados e constantes de schema.
2. [`src/index/producerLocalStorePathResolver.ts`](file:///d:/_dev/obsidian/lina/src/index/producerLocalStorePathResolver.ts): Resolução determinística e multiplataforma do diretório externo e validação estrita de fronteira do Vault.
3. [`tests/index/producerLocalStorePathResolver.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/producerLocalStorePathResolver.test.ts): Suíte de testes unitários isolados com 16 testes cobrindo todas as plataformas e cenários de isolamento.

---

## 4. Contratos Criados

O ficheiro [`src/index/producerLocalStoreTypes.ts`](file:///d:/_dev/obsidian/lina/src/index/producerLocalStoreTypes.ts) define:

- **`PRODUCER_STORE_SCHEMA_VERSION = 1`:** Versão inicial do schema local.
- **`PRODUCER_STORE_DEFAULT_DB_NAME = "lina-producer.db"`:** Nome de ficheiro padrão da base SQLite privada.
- **`EmbeddingSpaceRecord`:** Representação de um espaço vetorial associado a provider, modelo, dimensões e [`VectorContractV1`](file:///d:/_dev/obsidian/lina/src/index/vectorContract.ts).
- **`ProducerEmbeddingRecord`:** Representação nativa de um chunk incorporado com identificador estável `${path}:${index}`, `textHash`, `inputHash` e vetor binário em `Float32Array | ArrayBuffer`.
- **`ProducerOperationCheckpoint`:** Tipo candidato provisório para metadados de lote de geração local.
- **`ProducerStoreMigration`:** Contrato de migração de schema com versionamento monotónico.
- **`ProducerLocalStore`:** Interface mínima de lifecycle (`isOpen`, `getStorePath()`, `getSchemaVersion()`, `open()`, `close()`).
- **`VaultPathSeparationResult` & `ProducerLocalStorePathResolution`:** Contratos de resultado de análise de caminhos e separação do Vault.

---

## 5. Path Resolver e Validação de Separação do Vault

O módulo [`src/index/producerLocalStorePathResolver.ts`](file:///d:/_dev/obsidian/lina/src/index/producerLocalStorePathResolver.ts) implementa:

1. **`resolveDefaultStoreDirectory`:**
   - **Windows (`win32`):** `%APPDATA%/lina/db` (fallback: `~/.lina/db`).
   - **macOS (`darwin`):** `~/Library/Application Support/lina/db` (fallback: `~/.lina/db`).
   - **Linux / Outros:** `$XDG_CONFIG_HOME/lina/db` (fallback: `~/.config/lina/db` ou `~/.lina/db`).
2. **`checkPathSeparationFromVault`:**
   - Canonicaliza os caminhos normalizando separadores e segmentos relativos (`.` e `..`).
   - Respeita a insensibilidade a maiúsculas/minúsculas no Windows e macOS.
   - Deteta categoricamente se o alvo está dentro da raiz do Vault, no diretório raiz do Vault ou em subpastas.
3. **`DefaultProducerLocalStorePathResolver`:**
   - Permite injeção de contexto de ambiente (`platform`, `env`, `homedir`) para testes determinísticos sem side effects.
   - **Zero I/O em runtime:** Não cria pastas (`mkdir`) nem ficheiros durante a resolução.

---

## 6. Feature Flag

Conforme orientado na secção 4.4 da prompt M0, uma flag em runtime não foi ativada nem injetada nas Settings, pois a infraestrutura SQLite em M0 é puramente tipada e declarativa. A flag de controle `enableSqliteProducerShadow` será introduzida na Fase M1, momento em que o pipeline shadow de escrita será implementado.

---

## 7. Ficheiros Não Alterados Funcionalmente

Confirmou-se que nenhum dos seguintes ficheiros sofreu qualquer alteração funcional:
- `src/device/deviceOwnership.ts`
- `src/index/writeFence.ts`
- `src/index/exclusionPolicy.ts`
- `src/index/exclusionPolicyService.ts`
- `src/device/producerState.ts`
- `src/index/embeddingPersistence.ts`
- `src/index/embeddingBinaryStorage.ts`
- `src/index/embeddingBinaryCopyController.ts`
- `src/companion/companionConsumptionState.ts`
- `src/search/runtimeEmbeddingIndex.ts`
- `src/settings.ts`
- Nenhum ficheiro de pesquisa ou manutenção.

---

## 8. Testes e Validações

1. **Testes Unitários de M0:**  
   [`tests/index/producerLocalStorePathResolver.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/producerLocalStorePathResolver.test.ts) — **16 testes passaram (100% verde)** cobrindo:
   - Resolução em Windows, macOS e Linux;
   - Detecção de caminhos internos vs externos ao Vault;
   - Case-insensitivity no Windows;
   - Suporte a caminhos customizados de diretório e ficheiro `.db`;
   - Ausência de side effects (não cria pastas nem ficheiros no disco).
2. **Suíte Completa do Lina:**  
   **165 ficheiros de teste, 2215 testes executados — 100% aprovados.** Zero regressões em toda a base de testes existente.
3. **Lint:** `npm run lint` (`eslint main.ts "src/**/*.ts" --max-warnings=0`) — **0 erros, 0 avisos.**
4. **Typecheck:** `tsc --noEmit` — **0 erros.**
5. **Build:** `npm run build` — compilação esbuild em modo produção concluída com sucesso.
6. **Git diff check:** `git diff --check` — limpo, sem erros de formatação.

---

## 9. Matriz Pedido → Execução

| Requisito da Prompt M0 | Secção no Relatório | Evidência / Ficheiro | Estado |
|---|---|---|---|
| Contratos e tipos do Store | Secção 4 | [`producerLocalStoreTypes.ts`](file:///d:/_dev/obsidian/lina/src/index/producerLocalStoreTypes.ts) | Conforme |
| Path Resolver fora do Vault | Secção 5 | [`producerLocalStorePathResolver.ts`](file:///d:/_dev/obsidian/lina/src/index/producerLocalStorePathResolver.ts) | Conforme |
| Sem ativação de SQLite em runtime | Secção 3, 6 | Nenhum import ou chamada a `node:sqlite` no runtime | Conforme |
| Sem alteração em ownership/exclusions | Secção 7 | `deviceOwnership.ts` e `exclusionPolicy.ts` intactos | Conforme |
| Sem alteração em Producer/Companion | Secção 7 | Pipelines de escrita e leitura intactos | Conforme |
| Testes unitários de path e contratos | Secção 8 | [`producerLocalStorePathResolver.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/producerLocalStorePathResolver.test.ts) | Conforme |
| Suíte de testes completa verde | Secção 8 | 165 test files / 2215 tests aprovados | Conforme |
| Lint estrito com zero avisos | Secção 8 | `eslint --max-warnings=0` aprovado | Conforme |
| Sem commit / push | Secção 11 | Validação Git | Conforme |
| Regra de paragem | Fim | Paragem imediata pós-M0 | Conforme |

---

## 10. Desvios Identificados

Nenhum desvio funcional ou arquitetural em relação às especificações de M0.

---

## 11. Estado Git e Validações Finais

- **Branch Atual:** `master`
- **Ficheiros Criados:**
  1. `src/index/producerLocalStoreTypes.ts`
  2. `src/index/producerLocalStorePathResolver.ts`
  3. `tests/index/producerLocalStorePathResolver.test.ts`
  4. `docs/architecture/M0-CONTRATOS-PRODUCER-LOCAL-STORE-001.md`
- **Ficheiros Modificados de Produção:** Nenhum.
- **Confirmação:** **Não foi realizado qualquer commit ou push.**

---

## 12. Conclusão

> **M0 introduziu apenas estrutura preparatória, sem alterar comportamento funcional do Lina?**

### Resultado: `PASS`

A Fase M0 encontra-se concluída com sucesso e em conformidade estrita com todos os contratos e invariantes arquiteturais do projeto. A execução cessa aqui em cumprimento da Regra de Paragem para revisão e aprovação antes de iniciar a Fase M1.
