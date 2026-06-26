import { App } from "obsidian";
import { normalizePath } from "obsidian";

const STORE_PATH = normalizePath(".lina/data/store.json");
const inMemoryStore = new Map<string, string>();
let initialized = false;
let storeApp: App | null = null;

async function loadStore(): Promise<void> {
  if (!storeApp) return;
  const adapter = storeApp.vault.adapter;
  try {
    const stat = await adapter.stat(STORE_PATH);
    if (stat && stat.type === "file") {
      const raw = await adapter.read(STORE_PATH);
      const data = JSON.parse(raw);
      if (typeof data === "object" && data !== null) {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "string") {
            inMemoryStore.set(key, value);
          }
        }
      }
    }
  } catch {
    // Ficheiro ainda não existe — usa mapa vazio.
  }
}

async function saveStore(): Promise<void> {
  if (!storeApp) return;
  const adapter = storeApp.vault.adapter;
  const data: Record<string, string> = {};
  for (const [key, value] of inMemoryStore.entries()) {
    data[key] = value;
  }
  try {
    const dirPath = normalizePath(".lina/data");
    const dirStat = await adapter.stat(dirPath);
    if (!dirStat) {
      await adapter.mkdir(dirPath);
    }
    await adapter.write(STORE_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Lina localStore: error saving", error);
  }
}

export async function initLocalStore(app: App): Promise<void> {
  storeApp = app;
  await loadStore();
  initialized = true;
}

export function getStoreValue(key: string): string {
  return inMemoryStore.get(key) ?? "";
}

export function setStoreValue(key: string, value: string): void {
  if (value) {
    inMemoryStore.set(key, value);
  } else {
    inMemoryStore.delete(key);
  }
  saveStore();
}