import { normalizePath } from "obsidian";
import { hashContent } from "./noteHasher";

export interface Chunk {
  chunkId: string;
  path: string;
  chunkIndex: number;
  text: string;
  textHash: string;
  createdAt: string;
}

interface ChunkerOptions {
  chunkSize: number;
  overlap: number;
}

const DEFAULT_CHUNKER_OPTIONS: ChunkerOptions = {
  chunkSize: 1200,
  overlap: 150,
};

const MIN_CHUNK_LENGTH = 30;

function cleanChunkText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function chunkText(filePath: string, content: string, options?: Partial<ChunkerOptions>): Chunk[] {
  const opts = { ...DEFAULT_CHUNKER_OPTIONS, ...options };
  const chunks: Chunk[] = [];
  const now = new Date().toISOString();
  const normalizedPath = normalizePath(filePath);

  if (!content || content.trim().length === 0) {
    return chunks;
  }

  let start = 0;
  let chunkIndex = 0;

  while (start < content.length) {
    let end = Math.min(start + opts.chunkSize, content.length);

    // Tenta não partir palavras a meio apenas se não estamos no fim
    if (end < content.length) {
      const lastSpace = content.lastIndexOf(" ", end);
      if (lastSpace > start) {
        end = lastSpace;
      } else {
        const nextSpace = content.indexOf(" ", end);
        if (nextSpace !== -1) {
          end = nextSpace;
        }
      }
    }

    const rawChunk = content.substring(start, end);
    const cleanedChunk = cleanChunkText(rawChunk);

    if (cleanedChunk.length >= MIN_CHUNK_LENGTH) {
      chunks.push({
        chunkId: `${normalizedPath}::${chunkIndex}`,
        path: normalizedPath,
        chunkIndex,
        text: cleanedChunk,
        textHash: hashContent(cleanedChunk),
        createdAt: now,
      });
      chunkIndex++;
    }

    // Se chegámos ao fim do texto, parar
    if (end >= content.length) {
      break;
    }

    // Calcular o próximo início com overlap
    const nextStart = Math.max(0, end - opts.overlap);

    // Se o próximo início não avança, parar para evitar loop infinito
    if (nextStart <= start) {
      break;
    }

    start = nextStart;
  }

  return chunks;
}