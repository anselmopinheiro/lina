# docs/agents/obsidian-plugin.md

## Regras para o Plugin Obsidian

* **Desenvolvimento em TypeScript**: O plugin deve ser desenvolvido em TypeScript, seguindo as melhores práticas e padrões de código.
* **APIs Públicas do Obsidian**: Utilizar apenas as APIs públicas e documentadas do Obsidian. Evitar o uso de APIs internas ou não documentadas para garantir a estabilidade e compatibilidade futura.
* **Compatibilidade Mobile**: Evitar o uso de APIs exclusivas de desktop (Node.js/Electron) se a funcionalidade tiver de ser compatível com mobile, a menos que haja autorização explícita para implementar uma funcionalidade *desktop-only*.
* **Manter `main.ts` Limpo**: O ficheiro `main.ts` deve ser mantido o mais limpo possível, com a lógica principal de inicialização e registo de comandos. A lógica de negócio e funcionalidades específicas devem ser segregadas em módulos e ficheiros separados dentro de `src/`.
* **Separar Lógica em `src/`**: Todas as funcionalidades do plugin (ex: `VaultScanner`, `IndexStore`, `IndexSearch`, `ContentExtractor`) devem ter a sua própria classe ou módulo e ser organizadas na pasta `src/`.
* **Comandos Claros**: Os comandos do plugin devem ter nomes claros, descritivos e um prefixo "Lina: " para fácil identificação pelo utilizador.
* **Manifest `isDesktopOnly`**: O ficheiro `manifest.json` deve manter a propriedade `isDesktopOnly` definida como `false`, a menos que haja uma razão muito específica e aprovada para uma funcionalidade ser exclusiva de desktop.
* **Não Inventar APIs do Obsidian**: Não assumir ou "inventar" APIs do Obsidian. Se uma funcionalidade requer uma API que não existe, deve ser justificada e discutida antes de qualquer tentativa de implementação de *workarounds* complexos.