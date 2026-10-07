# M6 preflight — B1 a B3

B1: o Reader exige `embeddingInputHash` para v2–v5, alinhado com o Validator.

B2: o arranque normal deixou de chamar `diagnoseRuntimeSqlite()` e
`diagnoseM3Canonical()`. Os diagnósticos continuam apenas por comandos
explícitos; um Companion já não executa estas operações mutáveis no startup.

B3: `consumerPublishedGenerationEligibility.ts` introduz uma policy pura e
read-only que separa integridade/contrato de provenance de corpus e Producer.
Classifica `MATCH`, `STALE`, `FUTURE`, `UNKNOWN` e `MISMATCH`; apenas o par de
provenances `MATCH` é elegível para consumo autoritativo.

B1, B2 e B3 estão implementados. B4 permanece pendente de autorização para
checkpoint Git; M6 e cutover não foram iniciados.
