export type ZstdCompressFunction = (buf: Buffer, level: number) => Promise<Buffer>;

/**
 * Compression algorithms supported by the plugin.
 */
export enum CompressionType {
  /** Brotli compression only */
  BROTLI = 'brotli',
  /** Gzip compression only */
  GZIP = 'gzip',
  /** Zstandard compression only */
  ZSTD = 'zstd',
  /** Both Brotli and Gzip compression */
  BOTH = 'both'
}

/**
 * Compression quality levels for Brotli compression.
 */
export enum BrotliQuality {
  /** Fastest compression, lowest quality */
  FASTEST = 0,
  /** Fast compression */
  FAST = 3,
  /** Default compression */
  DEFAULT = 6,
  /** High quality compression */
  HIGH = 9,
  /** Maximum quality compression */
  MAXIMUM = 11
}

/**
 * Gzip compression levels.
 */
export enum GzipLevel {
  /** No compression */
  NONE = 0,
  /** Fastest compression */
  FASTEST = 1,
  /** Fast compression */
  FAST = 3,
  /** Default compression */
  DEFAULT = 6,
  /** High compression */
  HIGH = 9,
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  MAXIMUM = 9
}

/**
 * Zstandard compression levels.
 */
export enum ZstdLevel {
  /** Fastest compression */
  FASTEST = 1,
  /** Fast compression */
  FAST = 3,
  /** Default compression */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  DEFAULT = 3,
  /** High compression */
  HIGH = 9,
  /** Very high compression */
  VERY_HIGH = 15,
  /** Maximum compression */
  MAXIMUM = 22
}

/**
 * Interface for plugin options.
 */
export interface BrotliOptions {
  /**
   * Compression type to use.
   * @default CompressionType.BROTLI
   */
  type?: CompressionType;
  /**
   * File extensions to compress.
   * @default ['js', 'html', 'css', 'json', 'ico', 'svg', 'wasm']
   */
  extensions?: string[];
  /**
   * Whether to log compression results to the console.
   * @default true
   */
  verbose?: boolean;
  /**
   * Brotli compression quality level (0-11).
   * @default BrotliQuality.DEFAULT (6)
   */
  quality?: BrotliQuality | number;
  /**
   * Gzip compression level (0-9).
   * @default GzipLevel.DEFAULT (6)
   */
  gzipLevel?: GzipLevel | number;
  /**
   * Zstd compression level (1-22).
   * @default ZstdLevel.DEFAULT (3)
   */
  zstdLevel?: ZstdLevel | number;
  /**
   * Minimum file size in bytes to compress (files smaller than this will be skipped).
   * @default 1024 (1KB)
   */
  minSize?: number;
  /**
   * Maximum file size in bytes to compress (files larger than this will be skipped).
   * @default undefined (no limit)
   */
  maxSize?: number;
  /**
   * Whether to delete original files after compression.
   * @default false
   */
  deleteOriginal?: boolean;
  /**
   * Custom function to determine if a file should be compressed.
   * @param filePath - The file path
   * @param fileSize - The file size in bytes
   * @returns true if the file should be compressed
   */
  shouldCompress?: (filePath: string, fileSize: number) => boolean;
  /**
   * Glob patterns to exclude from compression.
   * @default []
   */
  excludePatterns?: string[];
  /**
   * Glob patterns to include for compression (overrides excludePatterns).
   * @default []
   */
  includePatterns?: string[];
  /**
   * Whether to compress files in parallel.
   * @default true
   */
  parallel?: boolean;
  /**
   * Maximum number of parallel compression operations.
   * @default 10
   */
  maxParallel?: number;
  /**
   * Whether to skip compression if compressed file already exists.
   * @default false
   */
  skipExisting?: boolean;
  /**
   * Whether to continue compression if some files fail.
   * @default true
   */
  continueOnError?: boolean;
  /**
   * Number of retry attempts for failed compressions.
   * @default 0
   */
  retryAttempts?: number;
  /**
   * Callback function called when compression fails.
   * @param error - The error that occurred
   * @param filePath - The file path that failed
   */
  errorCallback?: (error: Error, filePath: string) => void;
  /**
   * Minimum compression ratio (0-1) required to keep the compressed file.
   * If the compressed file is not at least this much smaller than the original,
   * it will be discarded. For example, 0.05 means the compressed file must be
   * at least 5% smaller than the original.
   * @default 0 (keep all compressed files)
   */
  compressionThreshold?: number;
  /**
   * Callback function called for each file as compression progresses.
   * @param progress - Progress information including current file, index, total, and percentage
   */
  onProgress?: (progress: CompressionProgress) => void;
  /**
   * Callback function called when all compression is complete.
   * @param stats - Final compression statistics
   */
  onComplete?: (stats: CompressionStats) => void;
  /**
   * Size budget configuration. Warns or errors if compressed output exceeds limits.
   */
  budget?: BudgetOptions;
  /**
   * File path for writing a JSON compression report after the build.
   * Includes per-file details, totals, timing, and compression ratios.
   * @default undefined (no report written)
   */
  compressionReport?: string;
  /**
   * Whether to verify compressed file integrity by computing and comparing
   * SHA-256 hashes during write and after read-back.
   * @default false
   */
  verifyIntegrity?: boolean;
  /**
   * Whether to use worker threads for compression.
   * Offloads CPU-bound compression to a thread pool for faster builds.
   * Requires the "piscina" package to be installed.
   * @default false
   */
  useWorkerThreads?: boolean;
  /**
   * Maximum number of worker threads.
   * @default number of CPU cores
   */
  maxWorkerThreads?: number;
}

/**
 * Size budget options for enforcing compressed output limits.
 */
export interface BudgetOptions {
  /**
   * Maximum total compressed size in bytes for all files combined.
   */
  maxTotalSize?: number;
  /**
   * Maximum compressed size in bytes for any single file.
   */
  maxFileSize?: number;
  /**
   * Action to take when budget is exceeded.
   * - 'warn': Log a warning (default)
   * - 'error': Throw an error to fail the build
   * @default 'warn'
   */
  action?: 'warn' | 'error';
}

/**
 * Compression statistics for reporting.
 */
export interface CompressionStats {
  totalFiles: number;
  compressedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  compressionRatio: number;
  timeElapsed: number;
  brotliFiles?: number;
  gzipFiles?: number;
  zstdFiles?: number;
  /** Per-file compression details for budget checks and reporting. */
  fileDetails: FileCompressionDetail[];
}

/**
 * Per-file compression detail.
 */
export interface FileCompressionDetail {
  filePath: string;
  originalSize: number;
  compressedSize: number;
  algorithm: 'brotli' | 'gzip' | 'zstd';
}

/**
 * Progress information for compression operations.
 */
export interface CompressionProgress {
  currentFile: string;
  currentIndex: number;
  totalFiles: number;
  percentage: number;
}

/**
 * Interface for compression options used internally.
 */
export interface CompressionOptions {
  type: CompressionType;
  quality: BrotliQuality | number;
  gzipLevel: GzipLevel | number;
  zstdLevel: ZstdLevel | number;
  deleteOriginal: boolean;
  parallel: boolean;
  maxParallel: number;
  verbose: boolean;
  continueOnError: boolean;
  retryAttempts: number;
  errorCallback?: (error: Error, filePath: string) => void;
  compressionThreshold: number;
  onProgress?: (progress: CompressionProgress) => void;
  verifyIntegrity: boolean;
  useWorkerThreads: boolean;
  maxWorkerThreads?: number;
}

/**
 * Internal per-file compression result.
 */
export interface FileCompressResult {
  compressedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  brotliFiles?: number;
  gzipFiles?: number;
  zstdFiles?: number;
  fileDetails: FileCompressionDetail[];
}
