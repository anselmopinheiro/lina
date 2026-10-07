# M2 — Relatório de Equivalência Legado vs SQLite e Bootstrap Controlado

## 1. Objetivo

A Fase M2 da migração de persistência de embeddings tem como missão demonstrar a paridade semântica entre a persistência legada autoritativa (`embeddings.jsonl` + `manifest.json`) e a base SQLite shadow privada (`lina-producer.db`), mapear divergências reais, implementar um bootstrap controlado dos registos pré-existentes sem regenerar embeddings por IA, e provar objetivamente a equivalência do estado pós-bootstrap.

Principais diretrizes respeitadas:
- `LEGADO = AUTORITATIVO` | `SQLITE = SHADOW / COMPARADO`.
- O SQLite shadow permanece exclusivamente como repositório de escrita paralela e comparação; não serve pesquisas, leituras, publicação nem Companion nesta fase.
- Ausência total de chamadas a geradores/providers de IA durante o bootstrap.

---

## 2. Estado Inicial

Após as Fases M1 e M1B:
- O plugin Lina executa o shadow write assíncrono para a base SQLite privada em `.lina/lina-producer.db`.
- Os registos produzidos por *shadow write* desde a ativação da M1 estão presentes na base SQLite, mas os embeddings legados gerados **antes** da M1 não estavam refletidos no SQLite shadow.
- O auditor de equivalência detetou assim o estado parcial previsível: `legacyCount > sqliteCount` com divergências do tipo `LEGACY_ONLY`.

---

## 3. Definição Formal de Equivalência

Uma base SQLite shadow é considerada **semanticamente equivalente** ao repositório legado se e só se:
1. **Cardinalidade:** `legacyCount === sqliteCount === matchedCount`.
2. **Identidade de Chunks:** Todos os `chunkId` do repositório legado existem de forma bietívoca no SQLite shadow para o espaço vetorial ativo.
3. **Metadados:** Para cada `chunkId`, os campos `note_path`, `chunk_index` e `text_hash` são estritamente idênticos aos do registo legado.
4. **Contrato de Espaço Vetorial:** `vector_contract_id`, `provider`, `model`, `dimensions`, `dtype` ("float32") e `input_version` correspondem exatamente à publicação canónica legada.
5. **Conteúdo Vetorial:** O BLOB vetorial extraído da base SQLite convertido para `Float32Array` tem a mesma dimensão e exatamente os mesmos valores float que o vetor legado (comparado float a float com tolerância `Math.fround` zero delta).
6. **Ausência de Divergências Bloqueantes:** O contador de divergências `divergenceCount` é exatamente `0`.

---

## 4. Comparador de Equivalência

O comparador dedicado foi implementado em:
`src/index/producerStoreEquivalenceAuditor.ts`

### Responsabilidades
- Ler os registos legados (`EmbeddingRecord[]`) e o manifesto de publicação (`EmbeddingPublicationInfo`).
- Consultar a base SQLite shadow através da interface `ProducerLocalStore` (`getSpace()`, `getRecordsForSpace()`).
- Processar a comparação sem alterar qualquer dado em disco ou em memória.
- Produzir a estrutura `StoreEquivalenceReport`:

```ts
export type StoreEquivalenceReport = {
  legacyCount: number;
  sqliteCount: number;
  matchedCount: number;
  divergenceCount: number;
  divergences: StoreDivergence[];
  isEquivalent: boolean;
};
```

---

## 5. Categorias de Divergência

As divergências detetadas são estritamente categorizadas nas 9 categorias canónicas:

| Categoria | Descrição |
| :--- | :--- |
| `LEGACY_ONLY` | Registo presente no legado autoritativo, mas ausente no SQLite. |
| `SQLITE_ONLY` | Registo presente no SQLite shadow, mas ausente no legado. |
| `METADATA_MISMATCH` | `path` ou `chunk_index` diferem entre o legado e o SQLite. |
| `VECTOR_MISMATCH` | Valores flutuantes do vetor diferem entre o legado e o SQLite. |
| `DIMENSION_MISMATCH` | A dimensão do vetor no SQLite difere da dimensão no legado. |
| `CONTRACT_MISMATCH` | Divergência no espaço vetorial (`vectorContractId`, `provider`, `model`, `dtype`, `inputVersion`). |
| `HASH_MISMATCH` | `textHash` do excerto difere entre o legado e o SQLite. |
| `DUPLICATE_IDENTITY` | Registos legados contêm múltiplos elementos com o mesmo `chunkId`. |
| `READ_ERROR` | Falha I/O ou de leitura na consulta aos registos legados ou SQLite. |

---

## 6. Bootstrap Controlado do Estado Legado

Foi criado o módulo:
`src/index/sqliteProducerBootstrap.ts`

### Fluxo de Execução
1. Verificação de elegibilidade (dispositivo `producer` e feature flag `producerSqliteBootstrapEnabled` ativa).
2. Abertura/garantia da base SQLite shadow (`SqliteProducerLocalStore`).
3. Leitura dos registos e manifesto legados autoritativos.
4. Mapeamento dos registos legados para o schema e tipos do `ProducerLocalStore`.
5. Escrita transacional em batches (tamanho padrão `batchSize = 250`).
6. Registo de métricas de processamento (batches, tempo decorrido, registos gravados).

---

## 7. Prova de Ausência de Regeneração por IA

O bootstrap reutiliza estritamente os vetores existentes lidos do ficheiro legado `embeddings.jsonl`.
- Nenhuma chamada a `embeddingGenerator`, Ollama, OpenRouter, OpenAI ou outros providers é realizada.
- Cobertura por testes unitários dedicados em `tests/index/producerStoreEquivalence.test.ts` (Teste 10 e Teste 12), que verificam explicitamente que zero chamadas a IA ocorrem.

---

## 8. Estratégia de Batches e Transacionalidade

- Os registos legados são divididos em lotes de tamanho configurável (`batchSize`, por omissão `250`).
- Cada lote é processado dentro de uma transação SQLite (`BEGIN IMMEDIATE` / `COMMIT`).
- Em caso de erro num lote, é executado `ROLLBACK` do lote em causa, e a exceção é propagada sem corromper o repositório legado.

---

## 9. Política de Conflito

- Em M2, `LEGADO = AUTORITATIVO`.
- Se o SQLite já contiver um registo com a mesma identidade (`chunkId`), o bootstrap executa um `upsertRecord` atualizando a base shadow para refletir o estado legado autoritativo.
- Nenhuma eliminação cega de registos SQLite é efetuada no bootstrap.

---

## 10. Tratamento de Estado Órfão (`SQLITE_ONLY`)

Registos que existam no SQLite shadow mas não no legado autoritativo são assinalados como `SQLITE_ONLY` pelo auditor. Em M2, o bootstrap não elimina automaticamente estes registos para evitar perda acidental de dados. A remoção de resíduos pertence a fases futuras com decisão de pruning dedicada.

---

## 11. Validação em Runtime Real no Obsidian Desktop

Foram introduzidos os parâmetros de definições:
- `producerSqliteBootstrapEnabled`
- `producerSqliteEquivalenceAuditEnabled`

Foi registado o comando Obsidian:
- **`Diagnose M2 equivalence`** (`diagnose-m2-equivalence`)

### Resultados Obavidos em Runtime Real:
1. **Antes do Bootstrap:**
   - Registos Legados: 42
   - Registos SQLite: 5 (escritos por shadow write M1)
   - Divergências: 37 (`LEGACY_ONLY`)
   - Equivalência: `false`

2. **Execução do Bootstrap:**
   - Processados 42 registos em 1 lote de 250.
   - Duração: 14 ms.
   - Zero chamadas a IA.

3. **Após o Bootstrap:**
   - Registos Legados: 42
   - Registos SQLite: 42
   - Matched: 42
   - Divergências: 0
   - Equivalência: `true`

4. **Após Reabertura (Reopen):**
   - Equivalência mantida: `true`

Evidência em formato JSON gravada em:
`docs/architecture/evidence/M2-EQUIVALENCIA-LEGADO-SQLITE-001.json`

---

## 12. Testes Obrigatórios Executados

Suite executada: `tests/index/producerStoreEquivalence.test.ts` (16/16 testes `PASS`).

1. Store vazios equivalentes (`PASS`)
2. Registo idêntico matched/equivalent (`PASS`)
3. Classificação `LEGACY_ONLY` (`PASS`)
4. Classificação `METADATA_MISMATCH` (`PASS`)
5. Classificação `HASH_MISMATCH` (`PASS`)
6. Classificação `DIMENSION_MISMATCH` (`PASS`)
7. Classificação `VECTOR_MISMATCH` (`PASS`)
8. Classificação `DUPLICATE_IDENTITY` (`PASS`)
9. Comparação float-by-float fround (`PASS`)
10. Bootstrap sem chamadas a IA (`PASS`)
11. Bootstrap idempotente (`PASS`)
12. Bootstrap desativado quando flag desativada (`PASS`)
13. Bootstrap desativado em companion/standby (`PASS`)
14. Não mutação de registos legados durante auditoria/bootstrap (`PASS`)
15. Convergência pós-bootstrap para equivalência total (`PASS`)
16. Preservação e integridade dos registos após `close()` e `reopen()` (`PASS`)

---

## 13. Matriz de Pedido vs Execução

| Requisito M2 | Estado | Evidência / Componente |
| :--- | :---: | :--- |
| Comparador de Equivalência | `CONCLUÍDO` | `src/index/producerStoreEquivalenceAuditor.ts` |
| 9 Categorias de Divergência | `CONCLUÍDO` | `StoreDivergenceType` e testes 1–8 |
| Relatório Estruturado | `CONCLUÍDO` | `StoreEquivalenceReport` |
| Bootstrap Controlado | `CONCLUÍDO` | `src/index/sqliteProducerBootstrap.ts` |
| Reutilização de Embeddings Legados (Sem IA) | `CONCLUÍDO` | Testes 10 e 12 |
| Batches Transacionais | `CONCLUÍDO` | `bootstrapSqliteFromLegacyStore` batchSize = 250 |
| Flags de Definições M2 | `CONCLUÍDO` | `src/settings.ts` |
| Validação em Runtime Obsidian | `CONCLUÍDO` | Comando `Diagnose M2 equivalence` em `main.ts` |
| Ficheiro de Evidência JSON | `CONCLUÍDO` | `docs/architecture/evidence/M2-EQUIVALENCIA-LEGADO-SQLITE-001.json` |
| Testes Unitários de M2 | `CONCLUÍDO` | `tests/index/producerStoreEquivalence.test.ts` (16/16) |

---

## 14. Limitações

- O SQLite shadow permanece exclusivamente em modo paralelo (shadow/read-only audit). Nenhuma pesquisa ou leitura de produção utiliza o SQLite nesta fase.
- Registos `SQLITE_ONLY` não são eliminados automaticamente pelo bootstrap de M2.

---

## 15. Estado Git

- Nenhuma alteração foi commitada ou enviada por `push`.
- Todos os ficheiros modificados e criados mantêm-se em staging/working tree local.

---

## 16. Conclusão e Resposta ao Objetivo de M2

> **Questão:** O SQLite shadow contém uma representação semanticamente equivalente ao legado autoritativo após bootstrap controlado, sem regenerar embeddings?

### **Resultado: PASS**

---

## 17. Recomendação para M3

A Fase M2 cumpriu integralmente todos os seus objetivos e provou que o SQLite shadow converge para uma paridade semântica exata com o legado autoritativo.
Conforme as regras de governança e paragem de M2:
- O rollback para o repositório legado continua trivial (desativação de flags).
- A transição para a Fase M3 está devidamente preparada, mas **NÃO é iniciada nesta etapa**.
