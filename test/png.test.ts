import { describe, it, expect } from 'vitest';
import { crc32, StreamingPngEncoder } from '../src/export/png';

describe('PNG CRC32', () => {
  it('空输入 CRC 为 0（初值与终值异或相消，标准 CRC-32 空消息约定）', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it('标准 "123456789" 校验值', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
  });
});

describe('StreamingPngEncoder 完整编码', () => {
  it('生成合法 PNG 头、IHDR、pHYs、IDAT、IEND，且尺寸/dpi 正确', async () => {
    const w = 8;
    const h = 6;
    const enc = await StreamingPngEncoder.create(w, h, 600);
    // 写入两行瓦片（底行序，编码器内部翻转）
    const tile = new Uint8Array(w * 2 * 4);
    for (let i = 0; i < tile.length; i += 4) {
      tile[i] = 100;
      tile[i + 1] = 150;
      tile[i + 2] = 200;
      tile[i + 3] = 255;
    }
    await enc.writeTile({ x: 0, y: h - 2, w, h: 2, rgba: tile });
    const blob = await enc.finish();
    const buf = new Uint8Array(await blob.arrayBuffer());

    // PNG 签名
    expect(Array.from(buf.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // 解析所有块
    const chunks = parseChunks(buf);
    const types = chunks.map((c) => c.type);
    expect(types).toContain('IHDR');
    expect(types).toContain('pHYs');
    expect(types).toContain('IDAT');
    expect(types).toContain('IEND');
    expect(types[0]).toBe('IHDR');
    expect(types.at(-1)).toBe('IEND');

    // IHDR：宽 8 高 6，位深 8，颜色类型 6（RGBA）
    const ihdr = chunks.find((c) => c.type === 'IHDR')!;
    expect(readU32(ihdr.data, 0)).toBe(w);
    expect(readU32(ihdr.data, 4)).toBe(h);
    expect(ihdr.data[8]).toBe(8);
    expect(ihdr.data[9]).toBe(6);

    // pHYs：600dpi = 600/0.0254 ≈ 23622 像素/米
    const phys = chunks.find((c) => c.type === 'pHYs')!;
    expect(readU32(phys.data, 0)).toBe(Math.round(600 / 0.0254));
    expect(readU32(phys.data, 4)).toBe(Math.round(600 / 0.0254));
    expect(phys.data[8]).toBe(1);

    // 每个块的 CRC 自洽
    for (const c of chunks) {
      const enc2 = new TextEncoder().encode(c.type);
      const input = new Uint8Array(enc2.length + c.data.length);
      input.set(enc2, 0);
      input.set(c.data, enc2.length);
      expect(crc32(input)).toBe(c.crc);
    }
  });

  it('扫描线宽度不匹配时抛错', async () => {
    const enc = await StreamingPngEncoder.create(4, 4, 300);
    await expect(enc.writeRow(new Uint8Array(8))).rejects.toThrow();
  });
});

interface ParsedChunk {
  type: string;
  data: Uint8Array;
  crc: number;
}

function parseChunks(buf: Uint8Array): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = readU32(buf, off);
    const type = new TextDecoder().decode(buf.subarray(off + 4, off + 8));
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = readU32(buf, off + 8 + len);
    chunks.push({ type, data: new Uint8Array(data), crc });
    off += 12 + len;
  }
  return chunks;
}

function readU32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
