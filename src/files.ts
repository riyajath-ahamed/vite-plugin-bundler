import path from 'path';
import fs from 'fs';
import { CompressionType } from './types';

export function matchesPattern(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;

  return patterns.some(pattern => {
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/\./g, '\\.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  });
}

export function shouldCompressFile(
  filePath: string,
  fileSize: number,
  minSize: number,
  maxSize: number | undefined,
  excludePatterns: string[],
  includePatterns: string[],
  shouldCompress?: (filePath: string, fileSize: number) => boolean
): boolean {
  if (fileSize < minSize) return false;
  if (maxSize && fileSize > maxSize) return false;

  if (includePatterns.length > 0) {
    return matchesPattern(filePath, includePatterns);
  }

  if (excludePatterns.length > 0 && matchesPattern(filePath, excludePatterns)) {
    return false;
  }

  if (shouldCompress) {
    return shouldCompress(filePath, fileSize);
  }

  return true;
}

export function compressedFileExists(filePath: string, type: CompressionType): boolean {
  if (type === CompressionType.BROTLI || type === CompressionType.BOTH) {
    if (fs.existsSync(`${filePath}.br`)) return true;
  }
  if (type === CompressionType.GZIP || type === CompressionType.BOTH) {
    if (fs.existsSync(`${filePath}.gz`)) return true;
  }
  if (type === CompressionType.ZSTD) {
    if (fs.existsSync(`${filePath}.zst`)) return true;
  }
  return false;
}

export async function findFiles(
  dir: string,
  extensions: string[],
  minSize: number,
  maxSize: number | undefined,
  excludePatterns: string[],
  includePatterns: string[],
  shouldCompress?: (filePath: string, fileSize: number) => boolean,
  skipExisting: boolean = false,
  type: CompressionType = CompressionType.BROTLI,
  visitedDirs: Set<string> = new Set()
): Promise<string[]> {
  if (visitedDirs.has(dir)) {
    return [];
  }
  visitedDirs.add(dir);

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name);

      if (entry.isDirectory()) {
        try {
          const subFiles = await findFiles(
            fullPath,
            extensions,
            minSize,
            maxSize,
            excludePatterns,
            includePatterns,
            shouldCompress,
            skipExisting,
            type,
            visitedDirs
          );
          files.push(...subFiles);
        } catch (_error) {
          continue;
        }
      } else if (extensions.some(ext => entry.name.endsWith(`.${ext}`))) {
        try {
          const stats = fs.statSync(fullPath);
          const fileSize = stats.size;

          if (!shouldCompressFile(
            fullPath,
            fileSize,
            minSize,
            maxSize,
            excludePatterns,
            includePatterns,
            shouldCompress
          )) {
            continue;
          }

          if (skipExisting && compressedFileExists(fullPath, type)) {
            continue;
          }

          files.push(fullPath);
        } catch (_error) {
          continue;
        }
      }
    }

    return files;
  } catch (_error) {
    return [];
  }
}
