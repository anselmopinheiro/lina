export interface IndexExclusions {
  excludedFolders: string[];
  excludedPathContains: string[];
  excludedContentContains?: string[];
}

export const DEFAULT_EXCLUDED_FOLDERS = ["03_Pessoal/"];

export const DEFAULT_EXCLUDED_PATH_CONTAINS = [
  "senha",
  "senhas",
  "password",
  "passwords",
  "palavra-passe",
  "palavras-passe",
  "wifi",
  "wi-fi",
  "token",
  "tokens",
  "secret",
  "secrets",
  "api key",
  "api-key",
  "chave",
  "chaves",
];

const LINA_OPERATIONAL_FOLDER = ".lina/";

export interface ScanResult {
  included: ScannedNote[];
  excludedCount: number;
}

// Re-export ScannedNote for convenience in the pipeline
export interface ScannedNote {
  path: string;
  basename: string;
  extension: string;
  size: number;
  mtime: number;
}

export function parseMultilineSetting(value: string): string[] {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // Remove duplicates maintaining order
  return [...new Set(lines)];
}

/**
 * Tokeniza o caminho usando separadores comuns:
 * /, espaço, _, ., -, (, ), *, +, #, &, %, @, !, ?, :, ;, ", ', `, ~, ^, |, \, ,
 */
function tokenizePath(path: string): string[] {
  const tokens: string[] = [];
  // Usar caracteres nao alfanumericos como separadores.
  // Manter apenas [a-z0-9] como caracteres de token, ignorando acentos e tudo o resto.
  const separators = /[^a-z0-9]+/;
  const parts = path.split(separators);
  for (const part of parts) {
    if (part.length > 0) {
      tokens.push(part);
    }
  }
  return tokens;
}

function normalizeFolderPrefix(folder: string): string {
  return folder.endsWith("/") ? folder : `${folder}/`;
}

export function getAlwaysExcludedFolders(obsidianConfigDir: string): string[] {
  return [LINA_OPERATIONAL_FOLDER, normalizeFolderPrefix(obsidianConfigDir)];
}

export function shouldExcludePath(
  path: string,
  exclusions: IndexExclusions,
  obsidianConfigDir: string
): { excluded: boolean; reason?: string } {
  const lowerPath = path.toLowerCase();

  // Exclusões obrigatórias internas
  for (const folder of getAlwaysExcludedFolders(obsidianConfigDir)) {
    if (lowerPath.startsWith(folder.toLowerCase())) {
      return { excluded: true, reason: `Pasta obrigatória: ${folder}` };
    }
  }

  // Verificar pastas excluídas configuradas
  for (const folder of exclusions.excludedFolders) {
    if (lowerPath.startsWith(folder.toLowerCase())) {
      return { excluded: true, reason: `Pasta excluída: ${folder}` };
    }
  }

  // Tokenizar o caminho para comparação segura com termos simples
  const tokens = tokenizePath(lowerPath);

  for (const term of exclusions.excludedPathContains) {
    const lowerTerm = term.toLowerCase().trim();
    if (lowerTerm.length === 0) continue;

    // Termos compostos (com espaço ou hífen) - verificar no caminho original normalizado
    if (lowerTerm.includes(" ") || lowerTerm.includes("-")) {
      // Normalizar o termo: substituir hífen por espaço para comparação flexível
      const normalisedTerm = lowerTerm.replace(/-/g, " ");
      const normalisedPath = lowerPath.replace(/-/g, " ");
      if (normalisedPath.includes(normalisedTerm)) {
        return { excluded: true, reason: `Termo composto no caminho: ${term}` };
      }
      continue;
    }

    // Termos simples - verificar contra tokens inteiros
    if (tokens.includes(lowerTerm)) {
      return { excluded: true, reason: `Termo no caminho: ${term}` };
    }
  }

  return { excluded: false };
}

export function shouldExcludeContent(
  content: string,
  excludedContentContains: string[]
): { excluded: boolean } {
  const lowerContent = content.toLowerCase();

  for (const term of excludedContentContains) {
    const lowerTerm = term.toLowerCase().trim();
    if (lowerTerm.length === 0) continue;

    if (lowerContent.includes(lowerTerm)) {
      return { excluded: true };
    }
  }

  return { excluded: false };
}
