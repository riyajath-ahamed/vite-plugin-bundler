import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CompressionStats, CompressionOptions, FileCompressResult } from './types';
import { CompressionType } from './types';
import {
  compressWithBrotli,
  compressWithGzip,
  compressWithZstd,
  meetsThreshold,
  verifyCompressedFile,
} from './compression';

function mergeFileResult(stats: CompressionStats, result: FileCompressResult): void {
  stats.compressedFiles += result.compressedFiles;
  stats.failedFiles += result.failedFiles;
  stats.skippedFiles += result.skippedFiles;
  stats.totalOriginalSize += result.totalOriginalSize;
  stats.totalCompressedSize += result.totalCompressedSize;
  stats.brotliFiles = (stats.brotliFiles || 0) + (result.brotliFiles || 0);
  stats.gzipFiles = (stats.gzipFiles || 0) + (result.gzipFiles || 0);
  stats.zstdFiles = (stats.zstdFiles || 0) + (result.zstdFiles || 0);
  stats.fileDetails.push(...result.fileDetails);
}

function emitProgress(
  options: CompressionOptions,
  filePath: string,
  currentIndex: number,
  totalFiles: number
): void {
  if (options.onProgress) {
    options.onProgress({
      currentFile: filePath,
      currentIndex,
      totalFiles,
      percentage: Math.round(((currentIndex + 1) / totalFiles) * 100)
    });
  }
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

function getWorkerPath(): string {
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.join(currentDir, 'compression-worker.mjs'),
    path.join(currentDir, 'compression-worker.cjs'),
    path.join(currentDir, '..', 'dist', 'compression-worker.mjs'),
    path.join(currentDir, '..', 'dist', 'compression-worker.cjs'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    '[vite-plugin-bundler] Worker file not found. ' +
    'Ensure the package is properly installed (run npm run build).'
  );
}

async function createWorkerPool(maxThreads?: number): Promise<any> {
  let Piscina: any;
  try {
    const mod = await import('piscina');
    Piscina = mod.default || mod.Piscina;
  } catch {
    throw new Error(
      'Worker threads require the "piscina" package. ' +
      'Install it with: npm install piscina'
    );
  }

  return new Piscina({
    filename: getWorkerPath(),
    maxThreads,
  });
}

async function compressFileWithWorker(
  filePath: string,
  pool: any,
  options: CompressionOptions
): Promise<FileCompressResult> {
  const stats = fs.statSync(filePath);
  const results: FileCompressResult = {
    compressedFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    totalOriginalSize: stats.size,
    totalCompressedSize: 0,
    brotliFiles: 0,
    gzipFiles: 0,
    zstdFiles: 0,
    fileDetails: []
  };

  const algorithms: Array<'brotli' | 'gzip' | 'zstd'> = [];
  if (options.type === CompressionType.BROTLI || options.type === CompressionType.BOTH) algorithms.push('brotli');
  if (options.type === CompressionType.GZIP || options.type === CompressionType.BOTH) algorithms.push('gzip');
  if (options.type === CompressionType.ZSTD) algorithms.push('zstd');

  for (const algo of algorithms) {
    try {
      const workerResult = await pool.run({
        filePath,
        algorithm: algo,
        quality: options.quality,
        gzipLevel: options.gzipLevel,
        zstdLevel: options.zstdLevel,
        verifyIntegrity: options.verifyIntegrity,
      });

      if (meetsThreshold(stats.size, workerResult.compressedSize, options.compressionThreshold, workerResult.compressedPath, options.verbose)) {
        if (options.verifyIntegrity && workerResult.hash) {
          const verified = await verifyCompressedFile(workerResult.compressedPath, workerResult.hash);
          if (!verified) {
            if (options.verbose) {
              console.warn(`[vite-plugin-bundler] Integrity check FAILED for ${workerResult.compressedPath}`);
            }
            results.failedFiles++;
            try { fs.unlinkSync(workerResult.compressedPath); } catch { /* ignore */ }
            continue;
          }
        }

        results.compressedFiles++;
        results.totalCompressedSize += workerResult.compressedSize;
        if (algo === 'brotli') results.brotliFiles = 1;
        if (algo === 'gzip') results.gzipFiles = 1;
        if (algo === 'zstd') results.zstdFiles = 1;
        results.fileDetails.push({
          filePath: workerResult.compressedPath,
          originalSize: stats.size,
          compressedSize: workerResult.compressedSize,
          algorithm: algo,
        });
      } else {
        results.skippedFiles++;
      }
    } catch (error) {
      results.failedFiles++;
      if (options.verbose) {
        console.warn(`[vite-plugin-bundler] ${algo} worker compression failed for ${filePath}:`, error);
      }
    }
  }

  if (options.deleteOriginal && results.compressedFiles > 0) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  return results;
}

function compressFileWithRetry(
  filePath: string,
  options: CompressionOptions,
  workerPool?: any
): Promise<FileCompressResult> {
  return (async () => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= options.retryAttempts; attempt++) {
      try {
        if (workerPool) {
          return await compressFileWithWorker(filePath, workerPool, options);
        }
        return await compressFile(filePath, options);
      } catch (error) {
        lastError = error as Error;
        if (attempt < options.retryAttempts) {
          if (options.verbose) {
            console.warn(`[vite-plugin-bundler] Retry ${attempt + 1}/${options.retryAttempts} for ${filePath}`);
          }
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
        }
      }
    }

    if (options.errorCallback) {
      options.errorCallback(lastError!, filePath);
    }
    throw lastError;
  })();
}

function compressFile(
  filePath: string,
  options: CompressionOptions
): Promise<FileCompressResult> {
  return new Promise(async (resolve, reject) => {
    try {
      const results: FileCompressResult = {
        compressedFiles: 0,
        failedFiles: 0,
        skippedFiles: 0,
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        brotliFiles: 0,
        gzipFiles: 0,
        fileDetails: []
      };

      const stats = fs.statSync(filePath);
      results.totalOriginalSize = stats.size;

      if (options.type === CompressionType.BROTLI || options.type === CompressionType.BOTH) {
        try {
          const brotliResult = await compressWithBrotli(filePath, options);
          const compressedPath = `${filePath}.br`;

          if (meetsThreshold(stats.size, brotliResult.compressedSize, options.compressionThreshold, compressedPath, options.verbose)) {
            if (options.verifyIntegrity && brotliResult.hash) {
              const verified = await verifyCompressedFile(compressedPath, brotliResult.hash);
              if (!verified) {
                if (options.verbose) {
                  console.warn(`[vite-plugin-bundler] Integrity check FAILED for ${compressedPath}`);
                }
                results.failedFiles++;
                try { fs.unlinkSync(compressedPath); } catch { /* ignore */ }
              } else {
                results.compressedFiles++;
                results.totalCompressedSize += brotliResult.compressedSize;
                results.brotliFiles = 1;
                results.fileDetails.push({
                  filePath: compressedPath,
                  originalSize: stats.size,
                  compressedSize: brotliResult.compressedSize,
                  algorithm: 'brotli'
                });
              }
            } else {
              results.compressedFiles++;
              results.totalCompressedSize += brotliResult.compressedSize;
              results.brotliFiles = 1;
              results.fileDetails.push({
                filePath: compressedPath,
                originalSize: stats.size,
                compressedSize: brotliResult.compressedSize,
                algorithm: 'brotli'
              });
            }
          } else {
            results.skippedFiles++;
          }
        } catch (error) {
          results.failedFiles++;
          if (options.verbose) {
            console.warn(`[vite-plugin-bundler] Brotli compression failed for ${filePath}:`, error);
          }
        }
      }

      if (options.type === CompressionType.GZIP || options.type === CompressionType.BOTH) {
        try {
          const gzipResult = await compressWithGzip(filePath, options);
          const compressedPath = `${filePath}.gz`;

          if (meetsThreshold(stats.size, gzipResult.compressedSize, options.compressionThreshold, compressedPath, options.verbose)) {
            if (options.verifyIntegrity && gzipResult.hash) {
              const verified = await verifyCompressedFile(compressedPath, gzipResult.hash);
              if (!verified) {
                if (options.verbose) {
                  console.warn(`[vite-plugin-bundler] Integrity check FAILED for ${compressedPath}`);
                }
                results.failedFiles++;
                try { fs.unlinkSync(compressedPath); } catch { /* ignore */ }
              } else {
                results.compressedFiles++;
                results.totalCompressedSize += gzipResult.compressedSize;
                results.gzipFiles = 1;
                results.fileDetails.push({
                  filePath: compressedPath,
                  originalSize: stats.size,
                  compressedSize: gzipResult.compressedSize,
                  algorithm: 'gzip'
                });
              }
            } else {
              results.compressedFiles++;
              results.totalCompressedSize += gzipResult.compressedSize;
              results.gzipFiles = 1;
              results.fileDetails.push({
                filePath: compressedPath,
                originalSize: stats.size,
                compressedSize: gzipResult.compressedSize,
                algorithm: 'gzip'
              });
            }
          } else {
            results.skippedFiles++;
          }
        } catch (error) {
          results.failedFiles++;
          if (options.verbose) {
            console.warn(`[vite-plugin-bundler] Gzip compression failed for ${filePath}:`, error);
          }
        }
      }

      if (options.type === CompressionType.ZSTD) {
        try {
          const zstdResult = await compressWithZstd(filePath, options);
          const compressedPath = `${filePath}.zst`;

          if (meetsThreshold(stats.size, zstdResult.compressedSize, options.compressionThreshold, compressedPath, options.verbose)) {
            if (options.verifyIntegrity && zstdResult.hash) {
              const verified = await verifyCompressedFile(compressedPath, zstdResult.hash);
              if (!verified) {
                if (options.verbose) {
                  console.warn(`[vite-plugin-bundler] Integrity check FAILED for ${compressedPath}`);
                }
                results.failedFiles++;
                try { fs.unlinkSync(compressedPath); } catch { /* ignore */ }
              } else {
                results.compressedFiles++;
                results.totalCompressedSize += zstdResult.compressedSize;
                results.zstdFiles = 1;
                results.fileDetails.push({
                  filePath: compressedPath,
                  originalSize: stats.size,
                  compressedSize: zstdResult.compressedSize,
                  algorithm: 'zstd'
                });
              }
            } else {
              results.compressedFiles++;
              results.totalCompressedSize += zstdResult.compressedSize;
              results.zstdFiles = 1;
              results.fileDetails.push({
                filePath: compressedPath,
                originalSize: stats.size,
                compressedSize: zstdResult.compressedSize,
                algorithm: 'zstd'
              });
            }
          } else {
            results.skippedFiles++;
          }
        } catch (error) {
          results.failedFiles++;
          if (options.verbose) {
            console.warn(`[vite-plugin-bundler] Zstd compression failed for ${filePath}:`, error);
          }
        }
      }

      if (options.deleteOriginal && results.compressedFiles > 0) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          if (options.verbose) {
            console.warn(`[vite-plugin-bundler] Failed to delete original file ${filePath}:`, error);
          }
        }
      }

      resolve(results);
    } catch (error) {
      reject(error);
    }
  });
}

export async function compressFiles(
  files: string[],
  options: CompressionOptions
): Promise<CompressionStats> {
  const stats: CompressionStats = {
    totalFiles: files.length,
    compressedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    totalOriginalSize: 0,
    totalCompressedSize: 0,
    compressionRatio: 0,
    timeElapsed: 0,
    brotliFiles: 0,
    gzipFiles: 0,
    zstdFiles: 0,
    fileDetails: []
  };

  let processedIndex = 0;
  let workerPool: any = null;

  if (options.useWorkerThreads) {
    workerPool = await createWorkerPool(options.maxWorkerThreads);
  }

  try {
    if (options.parallel) {
      const chunks = chunkArray(files, options.maxParallel);

      for (const chunk of chunks) {
        const results = await Promise.allSettled(
          chunk.map(filePath => compressFileWithRetry(filePath, options, workerPool))
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            mergeFileResult(stats, result.value);
          } else {
            stats.failedFiles++;
            if (options.verbose) {
              console.warn(`[vite-plugin-bundler] Failed to compress file: ${result.reason}`);
            }
          }
          emitProgress(options, files[processedIndex], processedIndex, files.length);
          processedIndex++;
        }
      }
    } else {
      for (const filePath of files) {
        try {
          const result = await compressFileWithRetry(filePath, options, workerPool);
          mergeFileResult(stats, result);
        } catch (error) {
          stats.failedFiles++;
          if (options.verbose) {
            console.warn(`[vite-plugin-bundler] Failed to compress file ${filePath}:`, error);
          }
          if (options.errorCallback) {
            options.errorCallback(error as Error, filePath);
          }
        }
        emitProgress(options, filePath, processedIndex, files.length);
        processedIndex++;
      }
    }
  } finally {
    if (workerPool) {
      await workerPool.destroy();
    }
  }

  stats.compressionRatio = stats.totalOriginalSize > 0
    ? ((stats.totalOriginalSize - stats.totalCompressedSize) / stats.totalOriginalSize) * 100
    : 0;

  return stats;
}
