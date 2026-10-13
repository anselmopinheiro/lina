# Módulo 2 — Producer, Companion, ownership e sincronização

```text
MÓDULO
objetivo: confirmar que o Companion não substitui o Producer, que o refresh de freshness não depende só de eventos de pasta oculta e que o
  lifecycle é limpo.
ficheiros/áreas inspecionadas: src/companion/producerStateRefresh.ts, src/device/producerState.ts, src/device/deviceOwnership.ts,
  src/device/ownershipGate.ts, src/search/linaSearchView.ts (onOpen/onClose), main.ts (onunload, updateProducerState),
  docs/release-notes-0.3.2.md, docs/manual.md (sincronização).

CONTRATOS ESPERADOS
- Apenas o Active Producer escreve .lina/producer-state.json e publica artefactos; epoch monotónico.
- Companion consome em modo read-only; freshness atualiza sem depender só de eventos de vault.
- Timers/listeners limpos; documentação não impõe ferramenta de sync.

EVIDÊNCIA
- updateProducerState exige activeProducerId === deviceId; saveProducerState valida activeProducerId e producerEpoch contra o manifesto
  autoritativo antes de escrever. A falha do estado do Producer nunca reverte a publicação primária (apenas console.warn).
- Refresh: eventos create/modify/delete/rename filtrados + debounce por caminho + stat periódico (30 s, 1 stat de 1 ficheiro, single-flight,
  baseline na 1.ª observação, falha de stat não move a baseline) + active-leaf-change (linaSearchView.ts ~1983-2020).
- Limpeza: registerEvent/registerInterval geridos pelo Obsidian; viewGeneration invalida callbacks tardios; onClose cancela o debouncer;
  onunload dispõe motor de manutenção, cópia binária, cache runtime, controlador de trabalho e coordenador de escrita.
- Documentação: "any synchronisation application"; "no particular tool is required"; sincronizar a pasta .lina inteira.

ACHADOS
P0: nenhum.
P1: nenhum.
P2:
  - M2-F1 — PRODUCER_STATE_FILE_PATH definido em dois módulos (device/producerState.ts e companion/producerStateRefresh.ts). Valores
    idênticos hoje; risco de divergência.
INFO:
  - O poll por stat só corre com o painel visível; consumidores fora do painel leem o estado a pedido.

CORREÇÕES
- Nenhuma.

TESTES / VALIDAÇÃO
- Suite completa sem falhas neste módulo (ownership, producer-state, companion, refresh).

DOCUMENTAÇÃO ATUALIZADA
- Nenhuma necessária.

CLASSIFICAÇÃO
OK — PENDÊNCIA NÃO BLOQUEANTE: M2-F1.
```
