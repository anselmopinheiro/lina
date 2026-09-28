# LINA-03 — Auditoria de opções de armazenamento local por dispositivo

**Estado:** concluída — decisão arquitetural, sem implementação  
**Versão avaliada:** Lina 0.3.0  
**Data:** 2026-09-27

## 1. Estado atual

O vault contém os artefactos publicados em `.lina/index/`, a telemetria partilhada em `.lina/producer-state.json` e, desde a separação anterior, o trabalho operacional do Producer em `.lina/producer/{checkpoints,staging,backups}`. Embora seja uma fronteira semântica correta, `.lina/producer/` continua dentro do vault: qualquer motor de sincronização que sincronize o vault pode transmiti-lo.

`src/device/deviceIdentity.ts` já usa `app.loadLocalStorage()` e `app.saveLocalStorage()` para o UUID local `lina_device_id`. As credenciais usam `app.secretStorage` através de `src/device/secretStorage.ts`. As preferências e a configuração local continuam a ser persistidas pelo ciclo `Plugin.loadData()`/`saveData()` em `.obsidian/plugins/lina/data.json`, que também é uma árvore do vault quando o diretório de configuração é sincronizado.

## 2. Problema

Excluir `.lina/producer/` num motor externo reduz o problema, mas não prova que dados privados nunca entram na sincronização. O plugin não controla o Syncthing, Obsidian Sync, Git, iCloud ou cópias manuais; logo uma regra `.stignore` não é uma garantia de produto nem pode ser pressuposta no Android.

O requisito forte é físico: dados privados não podem ser escritos na árvore que o utilizador decidiu sincronizar. Uma pasta `.lina/local/` dentro do vault falharia pelo mesmo motivo e não deve ser criada.

## 3. Alternativas avaliadas

### 3.1 `app.loadLocalStorage()` / `app.saveLocalStorage()`

São a opção oficial já usada para uma pequena chave local estável. A superfície é um mapa chave/valor com valor `unknown`; não expõe ficheiros, streaming, escrita atómica de vários objectos, recuperação de journal, enumeração, quota nem contrato público de tamanho para payloads grandes. Assim, o uso seguro é estado pequeno, serializável e não crítico para recuperação: identidade do dispositivo, flags, preferências estritamente locais e ponteiros/metadados pequenos.

Não há, nas APIs públicas consultadas, um limite numérico documentado que permita tratar esta API como armazenamento de checkpoints ou blobs. O Lina não deve inferir uma quota nem usar esta API para embeddings, staging, backups ou caches grandes. A existência da API no `App` torna-a a melhor opção atual para KV pequeno em Desktop e Android, mas não a transforma num sistema de ficheiros portável.

### 3.2 `Plugin.loadData()` / `saveData()` e `data.json`

Estas APIs são adequadas para settings do plugin, mas o ficheiro fica sob `vault.configDir` (normalmente `.obsidian/plugins/lina/data.json`). Portanto tem semântica local no modelo de Lina, mas não tem isolamento físico perante um sincronizador que inclua a configuração do vault. Não é destino para estado privado que exija a garantia absoluta desta auditoria, nem para actividade frequente, blobs ou recuperação operacional.

### 3.3 Ficheiros fora do vault

No Desktop, uma implementação específica poderia usar APIs Node/Electron e um directório de dados da aplicação. Isso não satisfaz por si só a compatibilidade: as APIs Node/Electron não existem no mobile, a adaptação do vault não deve ser convertida para `FileSystemAdapter` no Android, e o acesso fora do vault exige transparência ao utilizador. No Android, permissões, localização, limpeza pelo SO e recuperação precisam de uma implementação e validação próprias.

Não foi identificada nesta auditoria uma API pública única do Obsidian que ofereça a um plugin um sistema de ficheiros privado, grande, recuperável e com a mesma semântica em Desktop e Android. Não é aceitável introduzir já um caminho AppData desktop-only ou uma suposição sobre IndexedDB/local storage como se fosse um contrato oficial de ficheiros.

### 3.4 `SecretStorage`

`app.secretStorage` é o destino correto para API keys, tokens e credenciais. O Obsidian documenta-o como armazenamento seguro centralizado para segredos, local ao vault, mantendo no settings apenas a referência do segredo. Não é uma solução genérica para ficheiros, checkpoints ou caches e não deve receber configuração operacional não secreta.

### 3.5 `.stignore` / Syncthing

Uma regra `/.lina/producer/` em `.stignore` é uma mitigação válida para utilizadores Syncthing, mas é externa, específica desse motor, pode não existir nos dispositivos e não se aplica a Obsidian Sync, Git, iCloud ou outros fluxos. O Lina não deve criar, alterar ou depender de `.stignore`; a automação dessa configuração não fornece a garantia requerida e criaria dependência de produto num sincronizador opcional.

## 4. Limitações e implicações

Há uma tensão real entre persistência recuperável de trabalho grande e a garantia de não sincronização. Hoje, o Lina consegue garantir a segunda para identidade pequena e segredos através das APIs de aplicação, mas não possui uma abstração de blob/ficheiro privado cross-platform confirmada. Persistir checkpoints em `.lina/producer/` conserva recuperação após falha, porém exige exclusão externa; não os persistir elimina a fuga para sync, mas perde retomada após reinício/falha.

O contracto público exige também manter compatibilidade Android. Qualquer solução baseada em Node, Electron ou caminhos de sistema será necessariamente opcional no Desktop e não pode ser a única fonte de verdade do Producer.

## 5. Matriz de decisão

| Tipo de dado | Local atual | Local recomendado | Sincroniza? | Justificação |
| --- | --- | --- | --- | --- |
| `data.json` | `.obsidian/plugins/lina/data.json` | Settings do plugin apenas; retirar dele estado operacional privado quando houver store local | Não deve ser requisito de sync; fisicamente pode sincronizar | Está dentro do vault/config dir; manter apenas preferências e compatibilidade, sem autoridade multi-dispositivo. |
| Device identity | `app.loadLocalStorage` | `app.loadLocalStorage` / `app.saveLocalStorage` | Não | KV pequeno, por instalação e fora dos ficheiros do vault. |
| Producer config | `deviceSettingsById` em `data.json` | KV local pequeno através de uma futura porta `DeviceLocalStore` | Não | Provider local, endpoint, batch e timeout são específicos do dispositivo; `data.json` não garante isolamento físico. |
| Producer state | `.lina/producer-state.json` | Manter no vault | Sim | Telemetria de publicação/freshness que Companion e produtores devem observar; não contém configuração privada. |
| Checkpoints | `.lina/producer/checkpoints/` | Store local de blobs/ficheiros a definir e validar | Não | Retomada pertence ao Producer local; no vault só é segura com exclusão externa. |
| Staging | `.lina/producer/staging/` | Store local efémero/de blobs a definir | Não | Candidatos nunca publicados não são artefactos de consumo. |
| Backups | `.lina/producer/backups/` | Store local recuperável a definir | Não | Rollback operacional é privado do escritor; requer política de quota e recuperação. |
| Caches | memória e `.lina/producer/` quando persistentes | Memória por defeito; store local limitado se persistência for necessária | Não | Cache deve ser descartável; não merece custo nem conflito de sync. |
| Embeddings finais | `.lina/index/` | Manter no vault | Sim | Artefacto canónico validado que Companion consome. |
| Manifest | `.lina/index/manifest.json` | Manter no vault | Sim | Publica identidade e contrato dos vectores. |
| Contracts | Vector Contract no manifest; exclusões/ownership na `.lina/` | Manter no vault | Sim | São autoridades comuns do vault, não estado privado de um dispositivo. |
| Secrets | `app.secretStorage` | `app.secretStorage` | Não | Segredos locais fora da árvore do vault; nunca serializar em `data.json` ou `.lina/`. |

## 6. Respostas às questões

1. **É possível remover completamente `.lina/producer/` do vault?** Sim como destino arquitetural, mas não com segurança nesta versão sem substituir a persistência de blobs por uma implementação local Desktop+Android validada. Removê-la agora sem substituto remove checkpoints/backups recuperáveis; mantê-la é apenas uma mitigação dependente de exclusões externas.
2. **Existe uma localização local adequada suportada pelo Obsidian?** Para KV pequeno, `app.loadLocalStorage()`/`saveLocalStorage()`; para credenciais, `app.secretStorage`. Não foi confirmada uma localização oficial única para ficheiros grandes privados que seja portável entre Desktop e Android.
3. **Que dados devem continuar sincronizados?** Apenas as autoridades e publicações do vault: índices finais, manifest/Vector Contract, política de exclusões, ownership, device state que o protocolo já tornou público e producer state/freshness.
4. **Que dados devem ser exclusivamente locais?** Identidade, preferências/configuração de execução por dispositivo, segredos, caches e todo o trabalho ainda não publicado: checkpoints, staging e backups.
5. **É necessária uma camada própria?** Sim. A próxima evolução deve definir uma porta `DeviceLocalStore`, com capacidades separadas para KV pequeno e blobs/ficheiros, limites explícitos, recuperação, limpeza e adaptadores por plataforma. A porta não deve ter uma implementação concreta aprovada antes de validação Desktop+Android.

## 7. Recomendação

Adotar a seguinte estratégia em duas etapas:

1. **Agora:** tratar `.lina/producer/` como compatibilidade temporária, documentando que a exclusão pelo sincronizador é mitigação e não garantia. Não criar `.lina/local/`, não automatizar `.stignore` e não prometer zero-sync para estes ficheiros enquanto residirem no vault.
2. **Antes de remover a mitigação:** desenhar e validar uma `DeviceLocalStore` fora do vault. A decisão de backend deve provar, em Desktop e Android, persistência, quotas, limpeza, comportamento offline, recuperação após crash e ausência de escrita sob `vault.configDir` ou `.lina/`. Enquanto não houver backend oficial/validado para blobs, preferir cache/checkpoint em memória para fluxos que aceitem perder retomada a gravá-los num caminho sincronizável quando a garantia for mandatória.

Esta é a única estratégia que satisfaz literalmente «nunca entra na sincronização»: não escrever o dado no vault. Uma regra de sync só filtra depois de o dado ter entrado numa árvore candidata e não substitui esta fronteira.

## 8. Impacto por plataforma

### Desktop

Pode eventualmente receber um backend de ficheiros local, mas apenas atrás da porta comum e sem criar autoridade desktop-only. Acesso fora do vault deve ser declarado ao utilizador e não pode substituir o modo Android. A recuperação pode suportar staging/checkpoint/backups, com quota e limpeza explícitas.

### Android

Mantém `app.loadLocalStorage()` para KV pequeno e `SecretStorage` para credenciais. Não pode depender de Node/Electron nem de casts para adaptadores de filesystem desktop. Até existir backend de blobs comprovado no mobile, o modo seguro é trabalho efémero ou uma funcionalidade de recuperação explicitamente indisponível, nunca uma escrita escondida no vault.

## 9. Migração futura

Uma migração só deve começar depois da prova de backend. Deve ser opt-in/confirmada, copiar e validar o estado local antes de qualquer limpeza, preservar `.lina/producer/` em caso de erro e nunca apagar automaticamente artefactos antigos. A conclusão da cópia, a versão da store e uma opção de limpeza posterior devem ser observáveis; a remoção definitiva da pasta do vault só acontece numa fase separada e reversível.

Não há alteração nesta auditoria a schemas, `VectorContract`, `ProducerState`, ownership ou à versão 0.3.0.

## 10. Próximos passos

1. Abrir uma fase de desenho/protótipo para `DeviceLocalStore`, sem migrar dados de produção.
2. Confirmar com testes manuais Desktop e Android as capacidades reais do backend escolhido, incluindo reinício, falta de espaço, permissões e recuperação.
3. Definir política de quota, TTL e limpeza para caches/staging/backups; checkpoints precisam de identidade e validação, mas não de sincronização.
4. Só então criar migração não destrutiva e retirar `.lina/producer/` da árvore do vault.

## Fontes consultadas

- [Obsidian — Secret storage](https://docs.obsidian.md/plugins/guides/secret-storage)
- [Obsidian — Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)
- [Obsidian — Plugin self-critique](https://docs.obsidian.md/oo/plugin)
- [Obsidian — Developer policies](https://docs.obsidian.md/community-directory/developer-policies)

## Conclusão

**Estratégia correta:** dados privados só têm garantia de não sincronização quando são escritos fora da árvore do vault através de armazenamento local da aplicação. No Lina atual, usar `loadLocalStorage` para KV pequeno e `SecretStorage` para credenciais; para trabalho grande do Producer, introduzir primeiro uma `DeviceLocalStore` cross-platform validada. Até esse ponto, `.lina/producer/` e `.stignore` são mitigação, não cumprimento do requisito forte.

**PARAR — nenhuma implementação executada.**
