import fs from 'fs';
import zlib from 'zlib';
import crypto from 'crypto';
import { Transform } from 'stream';
import type { ZstdCompressFunction, CompressionOptions } from './types';

let zstdCompress: ZstdCompressFunction | null = null;
let zstdLoadAttempted = false;
let nativeZstdAvailable: boolean | null = null;

export function hasNativeZstd(): boolean {
  if (nativeZstdAvailable !== null) return nativeZstdAvailable;
  if (typeof (zlib as any).createZstdCompress !== 'function') {
    nativeZstdAvailable = false;
    return false;
  }
  try {
    (zlib as any).createZstdCompress();
    nativeZstdAvailable = true;
  } catch {
    nativeZstdAvailable = false;
  }
  return nativeZstdAvailable;
}

export async function getZstdCompress(): Promise<ZstdCompressFunction> {
  if (zstdCompress) return zstdCompress;
  if (zstdLoadAttempted) {
    throw new Error(
      'Zstd compression is not available. Either upgrade to Node.js 21.7+ ' +
      '(which has native zstd in zlib) or install the "@mongodb-js/zstd" package.'
    );
  }
  zstdLoadAttempted = true;

  if (hasNativeZstd()) {
    zstdCompress = async (buf: Buffer, level: number) => {
      return new Promise<Buffer>((resolve, reject) => {
        (zlib as any).zstdCompress(buf, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } }, (err: Error | null, result: Buffer) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };
    return zstdCompress;
  }

  try {
    const mod = await import('@mongodb-js/zstd');
    const compressFn = mod.compress || (mod.default && mod.default.compress);
    if (!compressFn) throw new Error('compress function not found');
    zstdCompress = compressFn as ZstdCompressFunction;
    return zstdCompress;
  } catch (e) {
    throw new Error(
      'Zstd compression requires Node.js 21.7+ or the "@mongodb-js/zstd" package. ' +
      `Install it with: npm install @mongodb-js/zstd\nOriginal error: ${(e as Error).message}`
    );
  }
}

export function verifyCompressedFile(compressedPath: string, expectedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const readStream = fs.createReadStream(compressedPath);
    readStream.on('data', (chunk) => hash.update(chunk));
    readStream.on('end', () => resolve(hash.digest('hex') === expectedHash));
    readStream.on('error', reject);
  });
}

export function meetsThreshold(
  originalSize: number,
  compressedSize: number,
  threshold: number,
  compressedPath: string,
  verbose: boolean
): boolean {
  if (threshold <= 0 || originalSize === 0) return true;

  const ratio = (originalSize - compressedSize) / originalSize;
  if (ratio < threshold) {
    try {
      fs.unlinkSync(compressedPath);
    } catch {
      // ignore cleanup errors
    }
    if (verbose) {
      console.log(
        `[vite-plugin-bundler] Skipped ${compressedPath} (ratio ${(ratio * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(1)}%)`
      );
    }
    return false;
  }
  return true;
}

export function compressWithBrotli(filePath: string, options: CompressionOptions): Promise<{compressedSize: number, hash?: string}> {
  return new Promise((resolve, reject) => {
    const compressStream = zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: Math.min(Math.max(options.quality, 0), 11),
      },
    });

    const readStream = fs.createReadStream(filePath);
    const compressedPath = `${filePath}.br`;
    const writeStream = fs.createWriteStream(compressedPath);

    let writeHash: crypto.Hash | undefined;
    if (options.verifyIntegrity) {
      writeHash = crypto.createHash('sha256');
      const hashTransform = new Transform({
        transform(chunk, _encoding, callback) {
          writeHash!.update(chunk);
          this.push(chunk);
          callback();
        },
      });
      readStream.pipe(compressStream).pipe(hashTransform).pipe(writeStream);
    } else {
      readStream.pipe(compressStream).pipe(writeStream);
    }

    writeStream.on('finish', () => {
      try {
        const compressedSize = fs.statSync(compressedPath).size;
        const hash = writeHash ? writeHash.digest('hex') : undefined;
        resolve({ compressedSize, hash });
      } catch (error) {
        reject(error);
      }
    });

    writeStream.on('error', reject);
    readStream.on('error', reject);
  });
}

export function compressWithGzip(filePath: string, options: CompressionOptions): Promise<{compressedSize: number, hash?: string}> {
  return new Promise((resolve, reject) => {
    const compressStream = zlib.createGzip({
      level: Math.min(Math.max(options.gzipLevel, 0), 9),
    });

    const readStream = fs.createReadStream(filePath);
    const compressedPath = `${filePath}.gz`;
    const writeStream = fs.createWriteStream(compressedPath);

    let writeHash: crypto.Hash | undefined;
    if (options.verifyIntegrity) {
      writeHash = crypto.createHash('sha256');
      const hashTransform = new Transform({
        transform(chunk, _encoding, callback) {
          writeHash!.update(chunk);
          this.push(chunk);
          callback();
        },
      });
      readStream.pipe(compressStream).pipe(hashTransform).pipe(writeStream);
    } else {
      readStream.pipe(compressStream).pipe(writeStream);
    }

    writeStream.on('finish', () => {
      try {
        const compressedSize = fs.statSync(compressedPath).size;
        const hash = writeHash ? writeHash.digest('hex') : undefined;
        resolve({ compressedSize, hash });
      } catch (error) {
        reject(error);
      }
    });

    writeStream.on('error', reject);
    readStream.on('error', reject);
  });
}

export async function compressWithZstd(filePath: string, options: CompressionOptions): Promise<{compressedSize: number, hash?: string}> {
  const compressedPath = `${filePath}.zst`;
  const level = Math.min(Math.max(options.zstdLevel, 1), 22);

  if (hasNativeZstd()) {
    return new Promise((resolve, reject) => {
      const compressStream = (zlib as any).createZstdCompress({
        params: { [zlib.constants.ZSTD_c_compressionLevel]: level },
      });
      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(compressedPath);

      let writeHash: crypto.Hash | undefined;
      if (options.verifyIntegrity) {
        writeHash = crypto.createHash('sha256');
        const hashTransform = new Transform({
          transform(chunk, _encoding, callback) {
            writeHash!.update(chunk);
            this.push(chunk);
            callback();
          },
        });
        readStream.pipe(compressStream).pipe(hashTransform).pipe(writeStream);
      } else {
        readStream.pipe(compressStream).pipe(writeStream);
      }

      writeStream.on('finish', () => {
        try {
          const compressedSize = fs.statSync(compressedPath).size;
          const hash = writeHash ? writeHash.digest('hex') : undefined;
          resolve({ compressedSize, hash });
        } catch (error) {
          reject(error);
        }
      });

      compressStream.on('error', reject);
      writeStream.on('error', reject);
      readStream.on('error', reject);
    });
  }

  const compress = await getZstdCompress();
  const input = fs.readFileSync(filePath);
  const compressed = await compress(Buffer.from(input), level);
  fs.writeFileSync(compressedPath, compressed);

  const compressedSize = fs.statSync(compressedPath).size;
  let hash: string | undefined;
  if (options.verifyIntegrity) {
    hash = crypto.createHash('sha256').update(compressed).digest('hex');
  }

  return { compressedSize, hash };
}
