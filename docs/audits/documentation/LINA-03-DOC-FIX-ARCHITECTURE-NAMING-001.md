# LINA-03 — Correção documental de nomenclatura arquitetural

**Estado:** concluída  
**Versão:** Lina 0.3.0  
**Data:** 2026-09-27  
**Escopo:** documentação apenas

## Referências corrigidas

| Antes | Depois |
| --- | --- |
| `Shared Configuration` / `shared-config` para `data.json` | **Local Device Configuration** / `local-device-config` |
| `.lina/producer/` como `Producer-Private Workspace` ou área privada implícita | **Producer Operational Area**, não destinada a sincronização, mas ainda dentro do vault e dependente de políticas externas corretas |
| Exclusão Syncthing como fronteira suficiente | Orientação opcional e específica de Syncthing; não é requisito nem garantia portátil |

## Documentos alterados

- `README.md`: esclarece a fronteira entre índice publicado, área operacional do Producer, configuração local e sincronização.
- `docs/manual.md`: corrige a descrição de `.lina/producer/`, a matriz de sync e a orientação `.stignore`.
- `docs/roadmap.md`: renomeia as tiers atuais e regista `DeviceLocalStore` como avaliação futura, não implementada.
- `CHANGELOG.md`: corrige a terminologia histórica sem alterar o facto de os artefactos terem sido separados do índice publicado.
- `docs/architecture/storage-audit.md`, `docs/architecture/secrets-and-obsidian-storage.md` e `docs/architecture/device-scoped-state.md`: eliminam a caracterização de `data.json` como configuração partilhada.

## Terminologia consolidada

- **`data.json`:** configuração local do dispositivo. Não é configuração partilhada nem autoridade multi-dispositivo; por estar no diretório de configuração do vault, o seu não-sync físico depende da política de sincronização usada pelo utilizador.
- **`.lina/index/`:** artefactos publicados, manifestos e contratos necessários a Consumers/Companions; são dados do vault destinados à sincronização.
- **`.lina/producer/`:** checkpoints, staging, backups e dados operacionais do Producer. Não são destinados a sincronização nem consumidos por Companion, mas ainda não têm isolamento privado absoluto porque residem no vault.
- **`DeviceLocalStore`:** evolução futura a avaliar para estado operacional privado, caches, checkpoints, backups e dados grandes locais. Não existe implementação, schema, migração ou compromisso de backend nesta versão.

## Confirmação de escopo

Não foram alterados código, testes, schemas, contratos, migrations, runtime ou a versão 0.3.0. A documentação passa a distinguir explicitamente dados sincronizados, configuração local e estado operacional do Producer.

**PARAR — tarefa documental concluída.**
