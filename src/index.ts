import type { Plugin, ResolvedConfig } from 'vite';
import type { BrotliOptions } from './types';
import { CompressionType, BrotliQuality, GzipLevel, ZstdLevel } from './types';
import { findFiles } from './files';
import { compressFiles } from './orchestrator';
import { logCompressionResults, checkBudget, writeCompressionReport } from './reporting';

export {
  CompressionType,
  BrotliQuality,
  GzipLevel,
  ZstdLevel,
} from './types';

export type {
  BrotliOptions,
  BudgetOptions,
  CompressionStats,
  FileCompressionDetail,
  CompressionProgress,
} from './types';

/**
 * The main plugin function.
 */
export default function brotliCompress(options: BrotliOptions = {}): Plugin {
  let viteConfig: ResolvedConfig;

  const {
    type = CompressionType.BROTLI,
    extensions = ['js', 'html', 'css', 'json', 'ico', 'svg', 'wasm'],
    verbose = true,
    quality = BrotliQuality.DEFAULT,
    gzipLevel = GzipLevel.DEFAULT,
    zstdLevel = ZstdLevel.DEFAULT,
    minSize = 1024,
    maxSize,
    deleteOriginal = false,
    shouldCompress,
    excludePatterns = [],
    includePatterns = [],
    parallel = true,
    maxParallel = 10,
    skipExisting = false,
    continueOnError = true,
    retryAttempts = 0,
    errorCallback,
    compressionThreshold = 0,
    onProgress,
    onComplete,
    budget,
    compressionReport,
    verifyIntegrity = false,
    useWorkerThreads = false,
    maxWorkerThreads
  } = options;

  return {
    name: 'vite-plugin-bundler',

    configResolved(resolvedConfig) {
      viteConfig = resolvedConfig;
    },

    async closeBundle() {
      const startTime = Date.now();
      const outDir = viteConfig.build.outDir;

      if (verbose) {
        const compressionType = type === CompressionType.BOTH ? 'Brotli and Gzip' :
                               type === CompressionType.GZIP ? 'Gzip' :
                               type === CompressionType.ZSTD ? 'Zstd' : 'Brotli';
        console.log(`\n[vite-plugin-bundler] Starting ${compressionType} compression...`);
      }

      try {
        const filesToCompress = await findFiles(
          outDir,
          extensions,
          minSize,
          maxSize,
          excludePatterns,
          includePatterns,
          shouldCompress,
          skipExisting,
          type
        );

        if (filesToCompress.length === 0) {
          if (verbose) {
            console.log('[vite-plugin-bundler] No matching files found to compress.');
          }
          return;
        }

        const stats = await compressFiles(filesToCompress, {
          type,
          quality,
          gzipLevel,
          zstdLevel,
          deleteOriginal,
          parallel,
          maxParallel,
          verbose,
          continueOnError,
          retryAttempts,
          errorCallback,
          compressionThreshold,
          onProgress,
          verifyIntegrity,
          useWorkerThreads,
          maxWorkerThreads
        });

        const timeElapsed = Date.now() - startTime;
        stats.timeElapsed = timeElapsed;

        if (verbose) {
          logCompressionResults(stats, type);
        }

        if (budget) {
          checkBudget(stats, budget);
        }

        if (onComplete) {
          onComplete(stats);
        }

        if (compressionReport) {
          writeCompressionReport(stats, compressionReport, type);
          if (verbose) {
            console.log(`[vite-plugin-bundler] Report written to ${compressionReport}`);
          }
        }
      } catch (error) {
        console.error('[vite-plugin-bundler] Error during compression:', error);
        if (!continueOnError) {
          throw error;
        }
      }
    },
  };
}
