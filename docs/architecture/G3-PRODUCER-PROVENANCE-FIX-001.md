# G3 — Producer Provenance Fix

G3 introduz `formatVersion: 5`. A geração publicada inclui `producerDeviceId`
e `producerEpoch`, capturados exclusivamente do `OwnershipFenceToken` adquirido
antes da operação. O serviço requer uma revalidação do fence antes de construir
e o writer revalida antes da promoção final e da substituição de `CURRENT`.
Qualquer alteração de ownership falha fechada com `OWNERSHIP_FENCE_REJECTED`.

V1–v4 mantêm leitura e recovery por integridade, mas são inelegíveis para
cutover. V5 valida G1, G2, G3 e G6; o leitor e o comparador expõem/avaliam a
proveniência do Producer separadamente de contrato, fonte e vetores.

No vault `zettel`, a prova `OBSIDIAN_RUNTIME` publicou `generation-000015`
com 2303 registos, Producer igual ao `activeProducerId`, epoch 3, zero provider
e zero reembedding. O shadow M5 L2 passou sem divergências. Evidência:
`docs/architecture/evidence/G3-PRODUCER-PROVENANCE-FIX-001.json`.

G3 = PASS; G1/G2/G3/G6 estão verdes e os bloqueadores pré-cutover estão
tecnicamente limpos. Esta fase não executa cutover.
