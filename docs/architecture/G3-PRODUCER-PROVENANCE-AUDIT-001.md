# G3 — Auditoria de proveniência do Producer

## Resultado

**READY_FOR_FIX (auditória); PASS (implementação subsequente).** O bloqueador era real: `generation-000014` é íntegra, tem
contrato semântico e proveniência do corpus, mas não declara a autoridade do
Producer que a publicou. G3 permanece o único bloqueador de cutover.

## Autoridade existente

| Etapa | Fonte e contrato |
| --- | --- |
| Identidade local | `src/device/deviceIdentity.ts`, `getOrCreatePersistentDeviceId()`: UUID persistido no local storage do Obsidian. É estável por instalação, local e não sincronizado. |
| Papel | `.lina/devices/<deviceId>.json`; o papel `producer` é capacidade, não autoridade. |
| Autoridade | `.lina/ownership.json`, `OwnershipManifest.activeProducerId` e `epoch`, lidos por `src/device/deviceOwnership.ts`. |
| Fence | `OwnershipGate.acquireFence()` devolve `{ producerDeviceId, epoch }`; `assertFence()` relê ownership e exige ambos iguais. |
| Escrita | `performProducerSqliteCanonicalWrite()` grava SQLite, projeta o par canónico e chama `publishSqliteCanonicalGeneration()`; esta última constrói e promove M4/CURRENT sem fence. |

O identificador canónico é, portanto, o `deviceId` persistido localmente e
referenciado em `ownership.json` como `activeProducerId`. Pode mudar apenas se
a instalação perder/resetar o local storage; não deve ser inventado outro ID.
O epoch authoritative é `OwnershipManifest.epoch`: começa em 1, aumenta em
transferência e relinquish, e é persistido atomicamente. Não existe token
adicional: o `OwnershipFenceToken` é exatamente o par ID + epoch.

## Estado de generation-000014

O manifesto v4 declara `formatVersion`, `createdAt`, contrato vetorial,
`sourcePublicationId`, `sourceTextGenerationId`, `sourceChunksDigest` e
`sourceRecordCount`. Não declara `publicationId`, `producerDeviceId`,
`producerEpoch`, `ownerDeviceId`, `ownerEpoch` nem `fenceToken`.

Assim, uma geração pode ter `integrityValid = true`, compatibilidade semântica
e proveniência G2 válidas sem provar que foi autorizada pelo Producer vigente.

## Riscos atuais

| Cenário | Detetável hoje | Resultado |
| --- | --- | --- |
| Producer antigo publica após perder ownership | Só se o chamador externo usar fence; M4 não usa | Pode passar silenciosamente. |
| Dois Producers temporariamente ativos | Ownership reduz a janela, mas M4 não carrega fence | Conteúdo pode parecer válido. |
| Epoch muda entre SQLite/build/promotion | Não há revalidação M4 | TOCTOU aberto. |
| Geração de Producer stale | Sem campo no manifesto | Não distinguível. |
| Companion recebe proveniência desconhecida | Companion já lê ownership/provenance de artefactos canónicos, não da M4 | Deve expor como desconhecida/não elegível. |
| Recovery encontra duas gerações válidas de epochs diferentes | Recovery só valida estrutura e monotonia | Escolhe a maior; não avalia autoridade. |

## Contrato mínimo recomendado

Criar **formatVersion 5**, sem reutilizar v4, com:

```ts
producerDeviceId: string
producerEpoch: number
```

Estes são os dois valores do fence autoritativo já existente. `createdAt` já
existe; não há `ownershipPublicationId`, digest ou assinatura canónicos que
acrescentem prova dentro do modelo de confiança atual. Uma assinatura/MAC não é
necessária: os artefactos e `ownership.json` partilham o mesmo vault confiado e
o problema é fencing/TOCTOU, não autenticidade contra um atacante que altera o
vault.

Captura recomendada: adquirir `OwnershipFenceToken` antes da leitura SQLite
(opção B) e derivar os campos exclusivamente desse token. Revalidar o mesmo
token antes do commit SQLite, antes da projeção canónica e imediatamente antes
da promoção final/CURRENT (opção D). Uma falha deve abandonar a publicação e
nunca promover a geração. Não usar settings, `lastDecision`, `CURRENT` ou
runtime posterior como fonte.

Não é necessária migração SQLite para G3: a proveniência é da autorização do
ato de publicação e pode viajar no pedido de publicação e no manifesto v5.
Também não requer provider nem reembedding.

## Recovery e Companion

Recovery continua a classificar integridade estrutural e pode manter apontáveis
gerações v1–v4; elas tornam-se `cutoverEligible = false`. Uma v5 estruturalmente
íntegra também é recuperável, mas só é elegível após verificar o par
`producerDeviceId`/`producerEpoch` contra ownership atual válido. Se ownership
avançar, a geração anterior é stale e deixa de ser elegível até uma publicação
do Producer/epoch corrente. Monotonia por si só não substitui esta prova.

O Companion pode ler `ownership.json` sincronizado e expor a comparação; não
precisa de SQLite, estado local do Producer nem provider. Ausência ou conflito
de provenance deve degradar a elegibilidade/diagnóstico, não iniciar escrita.

## Regra de cutover proposta

`cutoverEligible` requer integridade G6, contrato G1, fonte G2 e G3: manifesto
v5 bem-formado + proveniência do Producer igual ao fence/ownership authoritative
validado. A correção mínima é injectar uma porta de fence em publication service
e writer, incluir os dois campos em v5 e revalidar antes de cada promotion.
Depois de uma implementação/teste/prova runtime G3 verde, o bloqueador técnico
pré-cutover fica removido; esta auditoria não autoriza cutover.
