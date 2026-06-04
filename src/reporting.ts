import path from 'path';
import fs from 'fs';
import type { CompressionStats, BudgetOptions } from './types';
import { CompressionType } from './types';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function checkBudget(stats: CompressionStats, budget: BudgetOptions): void {
  const action = budget.action || 'warn';
  const violations: string[] = [];

  if (budget.maxTotalSize !== undefined && stats.totalCompressedSize > budget.maxTotalSize) {
    violations.push(
      `Total compressed size ${formatBytes(stats.totalCompressedSize)} exceeds budget of ${formatBytes(budget.maxTotalSize)}`
    );
  }

  if (budget.maxFileSize !== undefined) {
    for (const detail of stats.fileDetails) {
      if (detail.compressedSize > budget.maxFileSize) {
        violations.push(
          `${detail.filePath} (${formatBytes(detail.compressedSize)}) exceeds per-file budget of ${formatBytes(budget.maxFileSize)}`
        );
      }
    }
  }

  if (violations.length === 0) return;

  const header = '[vite-plugin-bundler] Budget exceeded:';
  const message = `${header}\n${violations.map(v => `  - ${v}`).join('\n')}`;

  if (action === 'error') {
    throw new Error(message);
  }

  console.warn(message);
}

export function writeCompressionReport(stats: CompressionStats, reportPath: string, type: CompressionType): void {
  const report = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: stats.totalFiles,
      compressedFiles: stats.compressedFiles,
      skippedFiles: stats.skippedFiles,
      failedFiles: stats.failedFiles,
      totalOriginalSize: stats.totalOriginalSize,
      totalCompressedSize: stats.totalCompressedSize,
      compressionRatio: stats.compressionRatio,
      timeElapsed: stats.timeElapsed,
      compressionType: type,
      brotliFiles: stats.brotliFiles ?? 0,
      gzipFiles: stats.gzipFiles ?? 0,
      zstdFiles: stats.zstdFiles ?? 0,
    },
    files: stats.fileDetails.map(d => ({
      filePath: d.filePath,
      originalSize: d.originalSize,
      compressedSize: d.compressedSize,
      algorithm: d.algorithm,
      savings: d.originalSize > 0
        ? `${((d.originalSize - d.compressedSize) / d.originalSize * 100).toFixed(2)}%`
        : '0%',
    })),
  };

  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

export function logCompressionResults(stats: CompressionStats, type: CompressionType): void {
  console.log('\n[vite-plugin-bundler] Compression Results:');
  console.log(`  Total files processed: ${stats.totalFiles}`);
  console.log(`  Successfully compressed: ${stats.compressedFiles}`);
  console.log(`  Skipped: ${stats.skippedFiles}`);
  console.log(`  Failed: ${stats.failedFiles}`);

  if (type === CompressionType.BOTH) {
    console.log(`  Brotli files: ${stats.brotliFiles || 0}`);
    console.log(`  Gzip files: ${stats.gzipFiles || 0}`);
  }
  if (type === CompressionType.ZSTD) {
    console.log(`  Zstd files: ${stats.zstdFiles || 0}`);
  }

  console.log(`  Original size: ${formatBytes(stats.totalOriginalSize)}`);
  console.log(`  Compressed size: ${formatBytes(stats.totalCompressedSize)}`);
  console.log(`  Compression ratio: ${stats.compressionRatio.toFixed(2)}%`);
  console.log(`  Time elapsed: ${stats.timeElapsed}ms`);

  const compressionType = type === CompressionType.BOTH ? 'Brotli and Gzip' :
                         type === CompressionType.GZIP ? 'Gzip' :
                         type === CompressionType.ZSTD ? 'Zstd' : 'Brotli';
  console.log(`  ✨ ${compressionType} compression completed!\n`);
}
