# docs/agents/mobile.md

## Regras para Compatibilidade Mobile

* **Mobile como Requisito Desde o Início**: A compatibilidade com dispositivos mobile (Android/iOS) deve ser considerada como requisito fundamental desde a fase de planeamento e arquitetura de qualquer funcionalidade.
* **Evitar Dependências Node/Electron**: Não utilizar APIs ou módulos que dependam exclusivamente do runtime Node.js ou do Electron do desktop. Exemplos: `fs`, `path`, `child_process`, `os`, `crypto` (a menos que seja uma implementação isomórfica).
* **Evitar Filesystem Direto**: Não aceder diretamente ao sistema de ficheiros. Utilizar sempre as abstrações fornecidas pelo Obsidian (ex: `Vault.read`, `Vault.getMarkdownFiles`, `MetadataCache`) que funcionam de forma consistente em desktop e mobile.
* **Usar APIs do Obsidian Quando Possível**: Sempre que existir uma API pública do Obsidian para a funcionalidade pretendida, esta deve ser preferida em vez de implementações manuais que possam não ser compatíveis com mobile.
* **UI Simples e Responsiva**: A interface do plugin deve ser simples e funcionar bem em ecrãs pequenos. Modals e elementos de UI devem ser responsivos e não assumir um tamanho de ecrã de desktop.
* **Não Assumir Ollama Local em Mobile**: Em dispositivos mobile, o Ollama (ou outros modelos locais) não está disponível. Funcionalidades que dependem de Ollama devem falhar graciosamente em mobile, mostrando uma mensagem informativa em vez de erro silencioso.
* **Manter `isDesktopOnly` False**: O ficheiro `manifest.json` deve manter a propriedade `isDesktopOnly` definida como `false`. Qualquer alteração para `true` deve ser cuidadosamente justificada e aprovada.
* **Automação ao Iniciar Leve**: A automação opcional no arranque (verificação de sincronização, atualização incremental) deve ser leve e não bloquear visualmente o arranque do Obsidian. Usar lógica assíncrona controlada.