# M3 — SQLite Canónico no Active Producer com Projeção Legada Reversível

## 1. Objetivo

A Fase M3 da migração de persistência de embeddings no repositório Lina implementou o cutover controlado de autoridade de persistência no Active Producer. A base SQLite privada (`lina-producer.db`) passa a ser a **fonte canónica de persistência** dos embeddings no Active Producer quando a flag `producerSqliteCanonicalEnabled` está ativa, mantendo a estrutura legada (`embeddings.jsonl` + `manifest.json`) como projeção de compatibilidade temporária e reconstruível, sem alterar o contrato consumido por dispositivos Companion nem remover artefactos legados.

---

## 2. Pré-condições de Cutover

Antes de efetuar qualquer escrita em modo canónico:
1. Execução do auditor de equivalência M2 (`auditStoreEquivalence`).
2. Confirmação estrita: `isEquivalent === true` e `divergenceCount === 0`.
3. Validação do schema SQLite suportado.
4. Confirmação do runtime `node:sqlite`.
5. Validação do papel de dispositivo `Active Producer` (`deviceRole === "producer"`).

Se qualquer pré-condição falhar, o sistema rejeta a transição canónica e opera explicitamente em `LEGACY_MODE`.

---

## 3. Modelo de Autoridade (Antes vs Depois)

### Antes de M3 (Fases M1/M2)
- **Persistência Autoritativa:** Ficheiros legados `embeddings.jsonl` e `manifest.json`.
- **SQLite:** Shadow store de comparação paralela.

### Depois de M3 (Modo Canónico Ativo)
- **Persistência Canónica:** Base SQLite privada `lina-producer.db` no Active Producer.
- **Estrutura Legada:** Projeção / publicação de compatibilidade derivável a partir do SQLite.
- **Companion:** Continua a consumir o contrato de publicação sem aceder ao SQLite.

---

## 4. Feature Flag de Cutover

Adicionada a flag centralizada em `src/settings.ts`:
- **`producerSqliteCanonicalEnabled`** (default: `false`)
- Ativação explícita, independente da flag de shadow write.
- Permite rollback imediato para modo legado ao ser redefinida para `false`.

---

## 5. Ordem Obrigatória do Write Path

Quando `producerSqliteCanonicalEnabled = true`:

```text
Embedding Calculado / Atualizado
            ↓
SQLite Canonical Transaction
            ↓ (PASS)
Projeção Legada / Compatibility Publication
```

O SQLite é o **primeiro commit durável**.

---

## 6. Read Path de Persistência Interna

Operações internas de persistência e diagnóstico no Active Producer consultam a interface `ProducerLocalStore` (`getAllRecords`, `getSpace`, `getEmbeddingRecord`).

---

## 7. Projeção Legada & Compatibilidade

A publicação de compatibilidade gera `embeddings.jsonl` e `manifest.json` para consumo continuado pelo Companion. A projeção é gerada/atualizada apenas após a confirmação do commit no SQLite.

---

## 8. Política de Erros

- **SQLite Write Falha (Antes do Commit):**
  - A operação canónica falha imediatamente.
  - A projeção legada **não** é atualizada.
  - Nenhum estado inconsistente é publicado.
- **SQLite Commit PASS + Projeção Legada Falha:**
  - O commit no SQLite **permanece válido e canónico** (não há rollback da base SQLite).
  - O estado da projeção é sinalizado como degradado.
  - É permitido o retry da projeção a partir do SQLite sem recalcular vetores de IA.

---

## 9. Reconstrução e Reprojeção Sem IA

Implementado o módulo:
`src/index/sqliteProducerCanonicalWriter.ts`

- Função `reprojectLegacyFromSqlite(app, store, info)`:
  1. Lê os registos e metadados do SQLite via `store.getAllRecords()`.
  2. Reconstrói os ficheiros legados `embeddings.jsonl` e `manifest.json`.
  3. Prova técnica: Executa a reconstrução completa com **0 chamadas a providers de IA** e 0 recalculações vetoriais.

---

## 10. Semântica de Delete e Update

- **Remoção de Nota:** `deleteProducerNoteEmbeddings` elimina os registos correspondentes na tabela `embedding_records` em SQLite (`deleteRecordsForNote`) e atualiza a projeção legada.
- **Alteração / Rechunk:** `replaceAllRecords` ou `upsertEmbeddingRecord` atualiza a base SQLite e a projeção legada em conformidade.

---

## 11. Ownership e Write Fence

- `IndexWriteFence`, `deviceOwnership` e a autoridade do Active Producer mantêm-se integralmente ativas.
- Dispositivos `Standby` e `Companion` continuam fora do path de escrita e não abrem a base SQLite.
- A base SQLite permanece restrita a `.lina/producer/lina-producer.db`, fora do Vault e excluída de sincronização.

---

## 12. Validação em Runtime Real no Obsidian Desktop

Comando registado: **`Diagnose m3 canonical`** (`diagnose-m3-canonical`).

### Resultados de Validação:
1. **Verificação de Elegibilidade:** `SQLITE_CANONICAL_MODE` ativado com sucesso após auditoria de equivalência M2.
2. **Escrita Canónica SQLite:** Commit em SQLite executado em primeiro lugar com sucesso.
3. **Projeção Legada:** Ficheiros `embeddings.jsonl` e `manifest.json` gerados a partir do commit canónico.
4. **Isolamento de Falha:** Erro provocado na escrita legada confirmou a durabilidade do commit SQLite sem corrupção.
5. **Reprojeção:** Reconstrução integral efetuada com `providerCallsCount = 0`.
6. **Reopen:** Abertura e re-execução confirmaram a integridade do repositório canónico SQLite.

Evidência em formato JSON gravada em:
`docs/architecture/evidence/M3-SQLITE-CANONICO-PRODUCER-001.json`

---

## 13. Testes Executados

Suite dedicada em `tests/index/producerSqliteCanonicalWriter.test.ts` (12/12 `PASS`):
1. Default `false` de `producerSqliteCanonicalEnabled` (`PASS`)
2. Preservação de modo legado quando a flag está desativada (`PASS`)
3. Rejeição de papéis Companion e Standby (`PASS`)
4. Pré-condição de equivalência pre-cutover (`PASS`)
5. Ordem de escrita SQLite-first (`PASS`)
6. Bloqueio de publicação legada quando o SQLite falha (`PASS`)
7. Preservação do commit SQLite em caso de falha na projeção legada (`PASS`)
8. Reprojeção direta a partir do SQLite com 0 chamadas a IA (`PASS`)
9. Retry de projeção sem recalculação vetorial (`PASS`)
10. Preservação de dados pós-reopen do SQLite (`PASS`)
11. Remoinção/deleção por nota em SQLite e projeção legada (`PASS`)
12. Atualização de registos por rechunk (`PASS`)

Suite completa: `169` ficheiros / `2.264` testes executados e aprovados com `PASS`.

---

## 14. Matriz de Pedido vs Execução

| Requisito M3 | Estado | Componente / Evidência |
| :--- | :---: | :--- |
| Feature Flag `producerSqliteCanonicalEnabled` | `CONCLUÍDO` | `src/settings.ts` (default `false`) |
| Pré-condição de Equivalência M2 | `CONCLUÍDO` | `evaluateCanonicalWriteEligibility` |
| Ordem de Escrita SQLite-First | `CONCLUÍDO` | `performProducerSqliteCanonicalWrite` |
| Failure Isolation | `CONCLUÍDO` | Commit SQLite intacto se projeção falhar |
| Reprojeção Legada Sem IA | `CONCLUÍDO` | `reprojectLegacyFromSqlite` (0 chamadas IA) |
| Semântica de Delete / Update | `CONCLUÍDO` | `deleteProducerNoteEmbeddings` / `replaceAllRecords` |
| Preservação de Fencing e Ownership | `CONCLUÍDO` | Active Producer apenas |
| Validação em Runtime Obsidian | `CONCLUÍDO` | Comando `Diagnose m3 canonical` em `main.ts` |
| Relatório e Evidência JSON | `CONCLUÍDO` | `M3-SQLITE-CANONICO-PRODUCER-001.md` / `.json` |

---

## 15. Limitações

- Ficheiros legados continuam a ser projetados nesta fase para assegurar a compatibilidade com o Companion (a descontinuação dos ficheiros legados pertence a fases futuras).
- Dispositivos Companion continuam a ler a publicação legada.

---

## 16. Estado Git

- Nenhuma alteração foi commitada ou enviada via `push`.
- Todos os ficheiros criados/modificados mantêm-se locais em staging/working tree.

---

## 17. Conclusão e Resposta ao Objetivo de M3

> **Questão:** O SQLite privado tornou-se a única fonte canónica de persistência de embeddings no Active Producer, mantendo o legado apenas como projeção compatível e reconstruível?

### **Resultado: PASS**

---

## 18. Critério de Passagem para M4

A Fase M3 cumpriu integralmente todos os requisitos técnicos e arquiteturais. A transição para a **Fase M4** está devidamente fundamentada, mas **NÃO é iniciada nesta etapa**, respeitando escrupulosamente a regra de paragem de M3.
