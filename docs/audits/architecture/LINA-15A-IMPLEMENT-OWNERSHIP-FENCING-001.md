# LINA-15A — Implementação de Ownership Fencing

**Data:** 2026-10-01  
**Finding de origem:** `L15A-F01` e `L15A-F02` em `LINA-15A-AUDIT-OWNERSHIP-FENCING-001.md`.

## Resultado

Implementado o fencing de ownership para as fronteiras duráveis do pipeline de embeddings. Uma operação passa a capturar o par imutável `{ producerDeviceId, epoch }`; cada mutação volta a provar esse par no manifesto actual. Sem prova actual, a operação não escreve nem publica.

## Arquitetura escolhida

`OwnershipGate` continua a ser a fonte de autorização. Foram adicionados `acquireFence()` e `assertFence(token)`, sem novo snapshot, modelo paralelo ou estado runtime adicional. O host injecta uma porta mínima `EmbeddingWriteFence` na geração; persistence apenas chama `assertCurrent()` e não conhece device state, lifecycle ou I/O de ownership.

```text
OwnershipGate.acquireFence()
  -> { producerDeviceId, epoch }
  -> Generator
  -> Persistence assertCurrent() antes de cada promoção mutável
```

## Pontos protegidos

- recovery mutável de artefactos de embeddings;
- staging e promoção de checkpoints;
- promoção do JSONL canónico e do manifest canónico;
- republicação e remoção pelo purge de embeddings órfãos.

`BinaryWorker` continua a receber handoff apenas depois de uma publicação com sucesso; logo um fence recusado não inicia manutenção binária.

## Semântica de ownership e epoch

`readOwnership()` agora distingue `missing`, `valid`, `invalid`, `unsupported-schema` e `unreadable`. Apenas `missing` permite o claim inicial. `claimInitialOwnership` e `transferOwnership` também recusam estado existente que seja inválido, futuro ou ilegível, evitando que uma mutação de ownership transforme incerteza em epoch 1.

O token exige simultaneamente o mesmo produtor e o mesmo epoch. Assim, troca para outro dispositivo e troca de epoch mantendo o mesmo dispositivo invalidam a operação anterior.

## Perda de ownership e recovery

Uma recusa antes de checkpoint ou rename falha a operação sem promover artefactos. A recuperação mutável retorna sem alterar ficheiros quando o fence é recusado. O rollback transacional, staging e backups pré-existentes foram preservados. Diagnósticos e leitores continuam read-only.

## Compatibilidade e decisões não tomadas

Não há migração de schema nem alteração de formato de `ownership.json`, checkpoints ou manifestos. `loadOwnership()` mantém a API histórica para leitores compatíveis; os caminhos de autorização e mutação usam o novo resultado classificado. Não foi introduzido lock distribuído, lease, watcher, segundo lifecycle snapshot ou mecanismo shadow; sincronização offline continua a ter a limitação inerente de só poder ser fenced depois de o manifesto actualizado estar observável localmente.

## Testes adicionados

- vazio, truncado, JSON inválido e schema futuro não desencadeiam auto-claim;
- falha de leitura bloqueia a gate;
- token de A/1 é recusado após transferência para B/2;
- checkpoint com fence revogado não cria par de checkpoint;
- publicação com fence revogado não promove embeddings nem manifesta estado de embeddings.

## Critérios de aceitação

- [x] Producer sem prova actual não publica pelo percurso activo de embeddings.
- [x] Epoch e identidade são revalidados antes de fronteiras duráveis.
- [x] Manifesto inválido/futuro/ilegível não desencadeia auto-claim.
- [x] Atomicidade, rollback e formato persistido permanecem inalterados.
- [x] Não foi criada segunda fonte de verdade de lifecycle ou ownership.
- [x] Documentação arquitetural e `AGENTS.md` registam a garantia permanente.

## Quality gates

| Gate | Resultado |
|---|---|
| Testes focados ownership/persistence | 89 testes verdes |
| `npm test` | 147 ficheiros / 1 947 testes verdes |
| `npm run typecheck` | verde |
| `npm run lint:obsidian:strict` | verde, sem warnings |
| `npm run build` | verde; `main.js` reconstruído e copiado para o vault de testes local |
| `npm run release-check` | verde (`0.3.1`) |
| `git diff --check` | verde |
