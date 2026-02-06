import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export async function writeJsonFile<T>(filePath: string, data: T, pretty = true): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(dirPath: string, pattern?: RegExp): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);

    if (pattern) {
      return files.filter((file) => pattern.test(file));
    }
    return files;
  } catch {
    return [];
  }
}

export function getDataDirectory(): string {
  const baseDir = process.env.MAESTRO_DATA_DIR || process.cwd();
  return path.join(baseDir, 'data');
}

export function getDatabasePath(name: string): string {
  return path.join(getDataDirectory(), `${name}.db`);
}
