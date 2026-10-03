# LINA-15H-G — Decisões finais de arquitetura da persistência

**Data:** 2026-10-03 · **Branch:** `master` · **Base analisada:** `fedf247` (15H-E documental) após `c95f8fd` (15H-F).

## 1. Estado pós-15H-F

As fases 15H-B/C/D/F já garantem, dentro de uma instância autorizada, publicação staged com backups determinísticos, recovery sob fence, validação factual do par, preservação do manifesto partilhado e exclusão entre escritores pelo `IndexWriteCoordinator`.

| Invariante | Estado |
|---|---|
| Publicações parciais não são aceites como `READY` quando a divergência é verificável | garantido |
| Recovery só promove/restaura nomes determinísticos, sob fence | garantido |
| Perda de fence não causa rollback ou cleanup mutável | garantido pela 15H-F |
| Manifesto existente ilegível não é transformado numa identidade `embeddings` vazia | garantido pela 15H-F |
| Exclusão de writers na mesma instância | garantido |
| Exclusão entre instâncias e prova de conteúdo JSONL↔manifesto | não garantido |

O relatório 15H-E foi verificado antes do seu commit documental separado: o SHA-256 é `808C60296757671C947B48A00CFFC90E230DCB4E051C5CDF1C70F5CB589062E9`, igual ao valor registado antes da 15H-F. O commit documental é `fedf247` e não contém alteração funcional.

## 2. N-02 — concorrência entre instâncias

### Evidência do código atual

`LinaPlugin.onload()` cria o `MaintenanceEngine` e o `IndexWriteCoordinator` é uma propriedade de cada instância. O coordinator (`src/index/indexWriteCoordinator.ts`) é exclusivamente memória local: não persiste token, owner de runtime nem lease. Assim, dois objetos `LinaPlugin` distintos têm coordinators independentes.

`onunload()` remove listeners e chama `dispose()` do engine, workers, scheduler e coordinator. O `EmbeddingWorker.dispose()` solicita cancelamento do `EmbeddingOperationManager`; scheduler e `TextIndexWorker` limpam timers. Isto impede novo dispatch pela instância descarregada, mas `onunload()` é síncrono e não aguarda as promises já iniciadas. Binary/reconciliation/text workers não recebem uma revogação de ownership ou de epoch no unload.

A fence valida apenas `{ producerDeviceId, epoch }` contra `.lina/ownership.json`. Duas instâncias do mesmo Producer partilham ambos os valores; portanto, enquanto o ownership não mudar, as duas fences continuam válidas. A fence é autoridade, não exclusão por instância. Os probes P3/P4 da 15H-E demonstraram a sobreposição de dois coordinators em memória.

### Cenários distintos

| Cenário | Estado factual | Consequência |
|---|---|---|
| A — reload normal do plugin | Há cancelamento/desativação, mas não uma barreira persistida nem espera pelas promises pendentes | não prova exclusão entre instância antiga e nova |
| B — duas instâncias no mesmo processo/vault | Não há produto/UI que o apresente como modo suportado, mas o código não o impede | dois coordinators e fences iguais podem escrever em paralelo |
| C — dois dispositivos | Ownership/epoch reduz a autoridade depois de uma leitura atual do manifesto; Syncthing/Obsidian Sync pode atrasar a observação | não é resolvido por um coordinator ou lease local; continua limite de sincronização externa |

### Decisão N-02

**N-02-C — deve ser suportado e exige exclusão persistente para o escopo local de um vault.**

O reload é um ciclo de vida normal, não pode ser declarado um uso inválido. A ausência de uma garantia de que a instância antiga cessou antes de a nova escrever impede fechar a persistência. O suporte a duas instâncias deliberadamente carregadas não é um objetivo de UX, mas a exclusão persistente deve igualmente recusar esse estado em vez de permitir duas escritas.

O limite explícito permanece: esta exclusão não promete serialização distribuída perante cópias divergentes propagadas por Syncthing/Obsidian Sync. A sincronização externa continua fora do contrato de lock e deve falhar fechado quando os artefactos não convergem.

### Especificação fechada da futura 15H-H

1. Introduzir uma lease durável única, por exemplo `.lina/producer/index-write.lease`, pertencente ao writer canónico; o coordinator em memória passa a ser apenas a primeira barreira.
2. O payload deve incluir schema/version, `producerDeviceId`, `epoch`, `instanceId` aleatório por `onload`, `leaseId` aleatório por aquisição, `operationKind`, `acquiredAt` e `expiresAt`. Nunca guardar segredos.
3. A aquisição exige primeiro uma ownership fence atual. Só o mesmo `producerDeviceId` e epoch pode renovar/remover a sua lease. A persistência de qualquer artefacto canónico exige simultaneamente fence atual e lease atual do mesmo `leaseId`.
4. A criação tem de usar uma primitiva de criação exclusiva/compare-and-swap comprovadamente disponível no `DataAdapter` alvo. Ler-"se ausente"-escrever não é admissível. Se Desktop ou Mobile não puderem provar criação exclusiva, a operação deve recusar com estado diagnosticável; não pode fazer fallback silencioso para o coordinator em memória.
5. A lease tem TTL curto e renovação antes de cada publicação/recovery mutável. Uma lease expirada só pode ser roubada após releitura de ownership e uma regra de takeover atómica; uma lease não expirada bloqueia. O valor deve ser conservador perante suspensão mobile.
6. Unload, cancelamento e sucesso removem apenas a lease cujo `leaseId` ainda coincide; nunca removem lease de uma instância posterior. Crash deixa lease recuperável após TTL e validação de epoch.
7. A fase deve testar: reload com operação pendente, dois plugins no mesmo adapter, lease stale, tentativa de limpeza tardia, mudança de epoch, Companion/Standby, desktop/mobile adapters e recusa quando não há primitive exclusiva. O recovery fica coberto pela mesma lease.
8. A lease não é instrumento de coordenação de Syncthing. Artefactos de sync externo continuam tratados pelos validadores/recovery existentes e a documentação deve declarar esta fronteira.

Critério de encerramento de N-02: nenhuma operação mutável canónica inicia sem uma lease durável exclusiva atual; uma instância antiga não consegue renovar, publicar, limpar ou remover lease de uma nova; o caminho sem suporte de exclusão atómica recusa antes de escrever.

## 3. N-04 — prova JSONL ↔ manifesto

### Evidência e impacto

`publishCanonicalEmbeddings()` cria `publicationId`, e `validateCanonicalContent()`/`inspectCanonicalPair()` verificam `totalEmbeddings`, dimensão, provider, modelo, vetores, chunkIds, input identity e vector contract. O `publicationId` é marcador de publicação do manifesto e identifica cópias binárias derivadas; `totalEmbeddings` deteta truncagem e divergência de cardinalidade.

Nenhum desses campos prova que os bytes ou a sequência de registos de `embeddings.jsonl` são os que originaram aquele manifesto. JSONL A e manifesto B podem ter mesma contagem, provider, modelo, dimensão e contract; o par é classificado `consistent`, como reproduzido em P1 da 15H-E.

Não existe outra prova equivalente: os digests de `embeddingBinaryStorage` cobrem metadata/vectors binários, não o JSONL canónico. Consequências:

- pesquisa JSONL pode produzir resultados semânticos de A apresentados como B;
- uma cópia binária B pode ser aceite pelo mesmo `publicationId` enquanto o JSONL A também é aceite, consoante a preferência de runtime;
- lifecycle, recovery e diagnóstico podem classificar o par como saudável apesar da identidade física errada;
- não foi demonstrada perda de notas, mas existe erro funcional e semântico material.

### Decisão N-04

**N-04 — implementação necessária: digest criptográfico canónico do JSONL no manifesto.**

### Especificação fechada da futura 15H-I

1. Acrescentar `manifest.embeddings.contentDigest` com formato `sha256:<64 hex>`. É alteração de schema do manifesto e deve ser tratada como tal, sem mudar o formato JSONL nem `data.json`.
2. A representação é os **bytes UTF-8 exatos** de `embeddings.jsonl` publicado, incluindo o newline final obrigatório das publicações com `publicationId`. Não há normalização de linhas, ordenação, parse/re-serialize ou omissão de whitespace: a prova corresponde ao artefacto que é lido.
3. O publisher calcula o digest da string candidata antes de staging, grava-o no manifesto candidato e valida depois da publicação relendo/recalculando sobre o JSONL canónico. Recovery, purge e qualquer republicação recalculam e validam a mesma prova antes de considerar o par consistente.
4. A validação de digest junta-se a `validateCanonicalContent()`; mismatch produz `inconsistent`, fecha pesquisa semântica, bloqueia binário derivado e encaminha para recovery/rebuild confirmado. Nunca é reparado escrevendo apenas um novo digest sobre conteúdo não provado.
5. Manifestos antigos sem `contentDigest` ficam em estado explícito `unverifiable-content` (ou extensão equivalente, não `consistent`): leitura semântica, binário e publicação incremental ficam bloqueados. A única transição para estado verificável é full rebuild/publicação autorizada que cria JSONL e manifesto novos. Não há migração silenciosa nem aceitação temporária.
6. A implementação deve usar hash incremental sobre UTF-8, sem criar uma segunda cópia integral em `ArrayBuffer`. O `DataAdapter` atual fornece leitura textual integral; portanto, dentro do Resource Guard o hash pode iterar sobre a string já lida. Acima do guard, não se lê nem se calcula digest e o resultado preserva `resource-limit-exceeded`, não "válido". Desktop e Mobile devem partilhar a mesma implementação determinística e vetorizada por chunks.
7. O manifesto binário mantém `sourcePublicationId`, mas a sua aceitação passa a exigir que o par JSONL↔manifesto atual tenha digest válido. Não é necessário duplicar o digest nos três ficheiros binários: os seus próprios digests já provam integridade interna; o digest canónico prova a fonte a que `sourcePublicationId` se refere.
8. Testes exigidos: P1 com mesma contagem/conteúdo diferente; newline/CRLF e unicode UTF-8; staging/publish/recovery/purge; legado sem digest; resource guard; runtime JSONL e binary; mismatch de digest sem mutação; Desktop/Mobile fixtures.

Critério de encerramento de N-04: `consistent` só é possível quando `publicationId`, campos estruturais e `contentDigest` validam o JSONL publicado; par antigo sem digest nunca é apresentado como verificável; nenhum derivado binário é aceite de uma fonte canónica sem prova válida.

## 4. Matriz de riscos, compatibilidade e plataformas

| Risco | Estado após 15H-G | Compatibilidade | Desktop/Mobile | Recovery/sync |
|---|---|---|---|---|
| N-01 fence→rollback | fechado | sem schema | igual | recovery autorizado |
| N-03 manifesto ilegível | fechado | sem schema | igual | fail-closed |
| N-02 duas instâncias | requer 15H-H | nova lease, sem `data.json` | exige primitive exclusiva comprovada | lease local; sync externo fora do lock |
| N-04 JSONL igual-contagem errado | requer 15H-I | novo campo manifesto; legado unverificável | hash incremental sob Resource Guard | digest validado em recovery; sync parcial falha fechado |
| fsync/TOCTOU/multi-rename | residual aceite | inalterado | dependente do adapter | backups/fence mitigam |

## 5. Decisão final

```text
N-01 → FECHADO
N-03 → FECHADO
N-02 → N-02-C, REQUER 15H-H (lease durável com exclusão atómica)
N-04 → REQUER 15H-I (digest SHA-256 UTF-8 do JSONL canónico)

Persistência:
REQUER DUAS IMPLEMENTAÇÕES

Próxima ação:
IMPLEMENTAR 15H-H; depois IMPLEMENTAR 15H-I.
```

Não foram alterados TypeScript, testes funcionais, schemas, JSONL, manifestos, ownership, Scheduler, Worker, Operation Manager, providers ou artefactos de vault nesta auditoria.
