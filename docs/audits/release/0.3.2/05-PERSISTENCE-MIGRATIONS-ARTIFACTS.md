# Módulo 5 — Persistência, migrações, índices e integridade de artefactos

```text
MÓDULO
objetivo: confirmar atomicidade, tratamento seguro de artefactos inválidos e ausência de migrações destrutivas.
ficheiros/áreas inspecionadas: src/device/deviceOwnership.ts, src/device/producerState.ts, src/device/deviceState.ts,
  src/index/exclusionPolicyService.ts, src/index/automaticUpdateEvents.ts, src/settings/settingsMigrations.ts,
  docs/audits/sync/LINA-03-IMPLEMENT-SYNC-ARTIFACT-BOUNDARY-001.md, manifest/package/versions.

CONTRATOS ESPERADOS
- Escritas de ficheiros partilhados atómicas com rollback; ficheiros operacionais do índice em .lina/producer/{staging,backups}.
- Migrações de settings idempotentes, não destrutivas, com recusa de downgrade silencioso.
- Artefactos ausentes/inválidos/futuros tratados sem fuga para estado "válido".

EVIDÊNCIA
- Artefactos do índice/embeddings/binário usam staging/backups privados do Producer e nomes determinísticos.
- settingsMigrations: monotónica, idempotente, unsupportedFutureVersion, sem apagar dados legacy.
- readOwnership distingue missing de inválido/futuro; claim inicial só em missing.
- Escritas de ownership.json, producer-state.json, exclusions.json, devices/*.json usam tmp + backup + rename com rollback.
- Eventos de .tmp-/.bak- são filtrados do indexador automático.
- Versões coerentes: manifest/package/package-lock/versions = 0.3.2.

ACHADOS
P0/P1: nenhum.
P2:
  - M5-F1 — saveOwnership (e saveProducerState, exclusions, deviceState) promove com duas renames (canónico -> .bak-*, .tmp-* ->
    canónico). Uma interrupção entre as duas deixa o canónico ausente e um .bak-* órfão sem recuperação automática. Para ownership.json
    o estado resultante é "missing", em que claimInitialOwnership produziria epoch 1 sem consultar .lina/ownership-history/ (risco para
    o invariante de epoch monotónico). Janela de milissegundos; o diagnóstico D2.5.6 deteta missing-manifest.
  - M5-F2 — Os temporários *.tmp-<ts>-<rand> / *.bak-* destes ficheiros ficam na raiz sincronizada .lina/ com nomes aleatórios; órfãos
    de crashes não são limpos nem cobertos pelo protocolo determinístico adotado para o índice (LINA-03/15H). Sem impacto funcional;
    acumulação e ruído de sincronização.
INFO:
  - SQLite/geração publicada (M0-M6) é infraestrutura desativada por omissão; o teste M6 de vault real falha por deriva de contagem
    (ver Módulo 7).

CORREÇÕES
- Nenhuma (alterar o protocolo de persistência excede uma auditoria pré-release).

TESTES / VALIDAÇÃO
- Suite completa; testes de ownership, recovery, persistência e migrações verdes.

DOCUMENTAÇÃO ATUALIZADA
- Nenhuma.

CLASSIFICAÇÃO
PENDÊNCIA NÃO BLOQUEANTE (M5-F1, M5-F2)
```
