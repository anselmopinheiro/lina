# G2 — Auditoria da ligação fonte–geração publicada

Data: 2026-10-06
Estado: **READY_FOR_FIX**
Cutover: **BLOCKED por G2/G3**

## Conclusão

O Lina já possui uma identidade global verificável para o índice textual: o manifesto `.lina/index/manifest.json` publica um `generationId` novo, `notesDigest` e `chunksDigest` juntamente com `notes.json` e `chunks.jsonl`. O manifesto canónico de embeddings preserva ainda `embeddings.publicationId` e `embeddings.sourceTextGenerationId`.

Essa proveniência perde-se quando a geração M4 é construída a partir do SQLite canónico. `publishSqliteCanonicalGeneration()` lê apenas o espaço e os records SQLite; `buildImmutableGeneration()` publica provider, contrato vectorial, records, vectores e hashes, mas não recebe nem escreve `sourceTextGenerationId`, `sourcePublicationId`, `chunksDigest` ou um hash do corpus. Consequentemente, o manifesto M4 v3 `generation-000013` não prova qual geração textual originou os seus 2303 vetores.

G2 está pronto para correção, mas mantém o cutover bloqueado. Esta auditoria não publicou dados, não alterou SQLite, `CURRENT`, notas ou settings, não chamou provider e não fez re-embedding.

## Fluxo e fontes de verdade

| Etapa | Artefacto/identidade | Papel |
| --- | --- | --- |
| Notas | ficheiros Markdown do vault | conteúdo primário editável; não é snapshot estável por si só |
| Texto/chunks | `.lina/index/notes.json`, `.lina/index/chunks.jsonl`, `.lina/index/manifest.json` | publicação textual partilhada; fonte lógica do corpus chunked |
| Snapshot textual | `generationId`, `notesDigest`, `chunksDigest` | identidade global do triple textual, validada contra bytes e contagens |
| Embeddings canónicos legados | `.lina/index/embeddings.jsonl` + secção `embeddings` no manifesto | artefacto de compatibilidade, com `publicationId` e `sourceTextGenerationId` |
| SQLite Producer | `embedding_spaces` + `embedding_records` | fonte canónica dos vetores para M4 após M3; não conserva o identificador da geração textual fonte |
| M4 | `.lina/published/generations/generation-*` | projeção imutável derivada do SQLite, actualmente sem ligação à fonte textual |

O SQLite é a fonte vectorial canónica para M4. Não é a fonte da identidade temporal do corpus textual: esta identidade pertence ao triple textual publicado. O JSONL canónico preserva a ligação, mas é um artefacto de compatibilidade e não faz parte da leitura SQLite→M4.

## Estado observado no vault

O manifesto textual actual declara:

- `generationId`: `gen-muvb41fn-elt8zhju`;
- `notesDigest`: `sha256:8466c6b01821448a3c65222e1a24c0ce40d603f83500338bc10687d16d7ddccb`;
- `chunksDigest`: `sha256:1fc6195999522568fd3edcd3e2ccf6d195a9c17705d656d20d607be3bdd84cb2`;
- `totalChunks`: 2303.

A secção canónica de embeddings declara `publicationId: emb-mux5mh1x-1gb0mzhzx1`, `sourceTextGenerationId: gen-muvb41fn-elt8zhju` e `sourceTotalChunks: 2303`. A geração publicada `generation-000013` é v3, tem 2303 records e contrato vectorial válido, mas não contém nenhum desses campos de proveniência textual.

## Hastes por record e contrato semântico

`textHash` identifica o texto do chunk individual. `embeddingInputHash` identifica o input final individual enviado ao embedding, incluindo a preparação definida por G1. Ambos permitem ao M5 comparar records por `chunkId`, detectar chunks só num lado, metadados divergentes e input divergente.

Não identificam um snapshot global nomeado. Um conjunto completo de hashes por record pode evidenciar igualdade de conjunto quando comparado integralmente com outra fonte, mas M4 sozinho não declara qual é essa fonte, nem os digests dos bytes do triple textual. A ordem física é irrelevante para a semântica de M5 L2; não substitui uma ligação de proveniência.

`vectorContractId` G1 identifica **como** os vetores foram produzidos (provider, modelo, dimensão, métrica, prefixo e versão de input). Não identifica **de que corpus** vieram. O manifesto v3 também não substitui essa referência.

## Drift

| Cenário | Detetável por M4 v3 isolado hoje | Comportamento | Impacto |
| --- | --- | --- | --- |
| A: nota alterada após embeddings | Não | silencioso | pesquisa pode servir corpus anterior |
| B: chunk removido, ainda publicado | Não | silencioso | resultado obsoleto |
| C: chunk novo, ausente da geração | Não | silencioso | cobertura incompleta |
| D: mesmo contrato vectorial, corpus diferente | Não | falso match | mistura temporal de corpus |
| E: mesmo recordCount, conjunto diferente | Não | falso match | contagem não prova identidade |
| F: Companion recebe M4 antigo e texto actual | Não pelo Reader M4 | não há ligação para falhar fechada | Companion pode aceitar geração temporalmente incompatível |

O caminho legado Companion já tem semântica para comparar `sourceTextGenerationId` com o `generationId` textual. Esse mecanismo não alcança a geração M4 publicada actual, pois o Reader M4 não expõe nem valida proveniência.

## Contrato mínimo recomendado

O manifesto M4 deve declarar uma proveniência textual completa e verificável, por exemplo:

```json
{
  "sourceTextGenerationId": "gen-…",
  "sourcePublicationId": "emb-…",
  "sourceChunksDigest": "sha256:…",
  "sourceRecordCount": 2303
}
```

`sourceTextGenerationId` liga à publicação textual lógica; `sourceChunksDigest` torna a ligação verificável sem depender do estado actual; `sourcePublicationId` liga à publicação canónica de embeddings que alimentou o SQLite; e `sourceRecordCount` é uma verificação auxiliar, não identidade por si só. A correção deve transportar esta estrutura durante a escrita SQLite canónica e na publicação M4, e compará-la em Validator, Reader, M5 e Companion.

## Formato e elegibilidade

V3 já está publicado sem estes campos e não pode ser reinterpretado como tendo proveniência explícita. Tal como em G1, a correção requer `formatVersion: 4` para novas gerações. V1, v2 e v3 podem continuar legíveis, íntegros e recuperáveis por `CURRENT`, mas devem tornar-se `cutoverEligible: false` quando G2 for implementado. Só uma v4 íntegra com proveniência exacta e verificável, além do contrato G1, deve ser elegível.

Regra proposta:

```text
cutoverEligible = integrityValid
  && formatVersion === 4
  && semanticContractValid
  && sourceProvenanceValid
  && source provenance matches the records/vectors source snapshot
```

## Estratégias avaliadas

| Estratégia | Avaliação |
| --- | --- |
| ID monotónico textual | útil para diagnóstico, mas não prova bytes sozinho |
| Hash do snapshot | determinístico e verificável; `chunksDigest` já existe |
| ID de publicação canónica | estabelece encadeamento lógico SQLite/JSONL |
| Combinação | recomendada: ID textual + digest de chunks + publication ID |

Não requer provider ou re-embedding criar e propagar a proveniência de uma publicação futura; requer apenas transportar metadados da publicação textual/canónica que já existem.

## Respostas directas

1. Fonte textual real: triple textual `.lina/index` (`notes.json`, `chunks.jsonl`, `manifest.json`); SQLite é fonte vectorial M4.
2. Há ID global: sim, `generationId` textual com digests.
3. `embeddingInputHash` substitui-o: não.
4. `vectorContractId` substitui-o: não.
5. Drift de corpus por M4 isolado: não, hoje é silencioso.
6. Campos M4: `sourceTextGenerationId`, `sourceChunksDigest`, `sourcePublicationId` e contagem auxiliar.
7. Criável sem provider/re-embedding: sim, para publicação futura, transportando metadados existentes.
8. Novo formato: sim, v4.
9. Elegibilidade: exige contrato G1 e proveniência fonte verificável v4.
10. Correção mínima: persistir/transportar a proveniência na passagem publicação canónica → SQLite → M4, validá-la e expô-la no Reader/M5/Companion.
