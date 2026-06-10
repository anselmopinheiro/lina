export interface ContentAnalysis {
  excerpt: string;
  charCount: number;
  wordCount: number;
}

/**
 * Remove excesso de espaços e limita o texto a maxLength caracteres.
 */
function normalizeExcerpt(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trim() + "...";
}

/**
 * Contagem simples de palavras: split por whitespace, ignora segmentos vazios.
 */
function countWords(text: string): number {
  const tokens = text.trim().split(/\s+/);
  return tokens.length === 1 && tokens[0] === "" ? 0 : tokens.length;
}

/**
 * Analisa o conteúdo de uma nota Markdown e devolve
 * excerto normalizado (~250 chars), contagem de caracteres e palavras.
 */
export function analyzeContent(content: string): ContentAnalysis {
  const charCount = content.length;
  const wordCount = countWords(content);
  const excerpt = normalizeExcerpt(content, 250);

  return { excerpt, charCount, wordCount };
}