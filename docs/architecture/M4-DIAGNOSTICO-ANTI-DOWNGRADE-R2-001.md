# M4 — Diagnóstico Anti-Downgrade R2

`CURRENT` aponta para `generation-000001`; existe apenas essa geração final, sem staging residual ou geração promovida não-current. O runtime tentou de novo `generation-000001`, logo a proteção `ANTI_DOWNGRADE` agiu corretamente.

A causa está em `publishedGenerationPublicationService.ts`: o serviço filtra `adapter.list(...).folders` por `/^generation-\d+$/`. No `DataAdapter` do Obsidian, os folders são paths completos, pelo que nenhum corresponde à regex, o máximo fica em zero e o candidato volta a ser 1.

Não foi possível concluir se a snapshot canónica mudou: a rejeição ocorreu antes de construir o candidato. A correção mínima é normalizar cada path para o basename antes do parsing e manter integralmente a guarda anti-downgrade.
