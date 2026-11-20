/**
 * 零依赖 PNG 编码器。
 * - CRC32 / 块结构手写；
 * - zlib deflate 交给浏览器原生 CompressionStream('deflate')，
 *   瓦片 RGBA 数据按整图行序逐行推入。
 * 注：IDAT 长度依赖全部 deflate 输出，故压缩流在 finish() 时收口后统一封包。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  // 全程无符号 32 位语义（>>>0），避免 0xffffffff 被当成 -1 参与异或
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = u32(body.length);
  const crcInput = new Uint8Array(typeBytes.length + body.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(body, typeBytes.length);
  const crc = u32(crc32(crcInput));
  const out = new Uint8Array(4 + typeBytes.length + body.length + 4);
  out.set(len, 0);
  out.set(typeBytes, 4);
  out.set(body, 4 + typeBytes.length);
  out.set(crc, out.length - 4);
  return out;
}

/** 物理分辨率块 pHYs（像素/米），让印刷软件识别 dpi 尺寸 */
function physChunk(dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const body = new Uint8Array(9);
  body.set(u32(ppm), 0);
  body.set(u32(ppm), 4);
  body[8] = 1; // 单位：米
  return chunk('pHYs', body);
}

function ihdr(width: number, height: number): Uint8Array {
  const body = new Uint8Array(13);
  body.set(u32(width), 0);
  body.set(u32(height), 4);
  body[8] = 8; // 位深
  body[9] = 6; // 颜色类型 RGBA
  return chunk('IHDR', body);
}

export interface PngTile {
  x: number;
  y: number;
  w: number;
  h: number;
  /** RGBA，readPixels 的底行序，写入时翻转 */
  rgba: Uint8Array;
}

export class StreamingPngEncoder {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private readable: ReadableStream<Uint8Array>;
  private headerChunks: Uint8Array[] = [];
  private readonly width: number;
  private readonly rowBytes: number;

  private constructor(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    readable: ReadableStream<Uint8Array>,
    width: number,
    height: number,
  ) {
    this.writer = writer;
    this.readable = readable;
    this.width = width;
    this.rowBytes = 1 + width * 4;
    void height;
  }

  static async create(width: number, height: number, dpi: number): Promise<StreamingPngEncoder> {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
    const encoder = new StreamingPngEncoder(writer, cs.readable as ReadableStream<Uint8Array>, width, height);
    encoder.headerChunks.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    encoder.headerChunks.push(ihdr(width, height));
    encoder.headerChunks.push(physChunk(dpi));
    return encoder;
  }

  /** 写入一行扫描线（自上而下行号），行首加 PNG filter byte 0 */
  async writeRow(rowRgba: Uint8Array): Promise<void> {
    if (rowRgba.length !== this.width * 4) throw new Error('扫描线宽度不匹配');
    const line = new Uint8Array(this.rowBytes);
    line.set(rowRgba, 1);
    await this.writer.write(line);
  }

  /** 喂入瓦片（readPixels 底行序在这里翻转成顶行序） */
  async writeTile(tile: PngTile): Promise<void> {
    const row = new Uint8Array(this.width * 4);
    for (let ty = 0; ty < tile.h; ty++) {
      const readY = tile.h - 1 - ty;
      const srcOff = readY * tile.w * 4;
      row.set(tile.rgba.subarray(srcOff, srcOff + tile.w * 4), tile.x * 4);
      await this.writeRow(row);
    }
  }

  async finish(): Promise<Blob> {
    await this.writer.close();
    const deflated = new Uint8Array(await new Response(this.readable).arrayBuffer());
    // 统一转成 ArrayBuffer 作为 BlobPart，规避 TS 5.6 的 SharedArrayBuffer 联合类型
    const asBuffer = (u: Uint8Array): ArrayBuffer => {
      const copy = new Uint8Array(u.length);
      copy.set(u);
      return copy.buffer;
    };
    const parts: BlobPart[] = [
      ...this.headerChunks.map(asBuffer),
      asBuffer(chunk('IDAT', deflated)),
      asBuffer(chunk('IEND', new Uint8Array(0))),
    ];
    return new Blob(parts, { type: 'image/png' });
  }
}
