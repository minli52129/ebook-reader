import { describe, expect, it } from 'vitest';

import { decodeBuffer } from './detect';

/** GBK/GB2312 编码的「第一章 测试\n你好世界」，映射已用 Node TextDecoder 实测验证 */
const GBK_BYTES = new Uint8Array([
  0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb2, 0xe2, 0xca, 0xd4, 0x0a, 0xc4,
  0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7,
]);

const GBK_TEXT = '第一章 测试\n你好世界';

function buf(bytes: Uint8Array): ArrayBuffer {
  // 拷贝到独立 ArrayBuffer，避免测试间共享可变视图
  return bytes.slice().buffer;
}

describe('decodeBuffer', () => {
  it('空缓冲返回空文本', () => {
    const result = decodeBuffer(new ArrayBuffer(0));
    expect(result.text).toBe('');
    expect(result.encoding).toBe('utf-8');
    expect(result.replacementRatio).toBe(0);
  });

  it('带 BOM 的 UTF-8：正确解码且剥离 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(GBK_TEXT)]);
    const result = decodeBuffer(buf(bytes));
    expect(result.text).toBe(GBK_TEXT);
    expect(result.encoding).toBe('utf-8');
    expect(result.replacementRatio).toBe(0);
  });

  it('无 BOM 的 UTF-8 中文：严格模式成功解码', () => {
    const result = decodeBuffer(buf(new TextEncoder().encode(GBK_TEXT)));
    expect(result.text).toBe(GBK_TEXT);
    expect(result.encoding).toBe('utf-8');
  });

  it('纯 ASCII：按 utf-8 报告（ASCII 是其子集）', () => {
    const result = decodeBuffer(buf(new TextEncoder().encode('hello world')));
    expect(result.text).toBe('hello world');
    expect(result.encoding).toBe('utf-8');
  });

  it('UTF-16LE BOM：正确解码', () => {
    // "AB" = 0041 0042，LE 字节序
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
    const result = decodeBuffer(buf(bytes));
    expect(result.text).toBe('AB');
    expect(result.encoding).toBe('utf-16le');
  });

  it('UTF-16BE BOM：正确解码', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]);
    const result = decodeBuffer(buf(bytes));
    expect(result.text).toBe('AB');
    expect(result.encoding).toBe('utf-16be');
  });

  it('GBK/GB18030 字节（无 BOM）：utf-8 严格模式拒绝后回退 gb18030，无乱码', () => {
    const result = decodeBuffer(buf(GBK_BYTES));
    expect(result.encoding).toBe('gb18030');
    expect(result.text).toBe(GBK_TEXT);
    expect(result.replacementRatio).toBe(0);
  });

  it('GBK 字节不会被 utf-8 严格模式误判成功', () => {
    // 防止未来有人把 fatal 去掉导致 GBK 被"成功"解码成乱码
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(buf(GBK_BYTES)),
    ).toThrow();
  });

  it('彻底非法的字节：回退 gb18030 并报告非零替换率', () => {
    // 0xFF 不在 gb18030 前导字节范围（0x81–0xFE）内，必然产生替换符
    // （注意不能用 0x81 系列：0x81 0x81 是合法的双字节序列）
    const bytes = new Uint8Array([0xff, 0xff, 0xff]);
    const result = decodeBuffer(buf(bytes));
    expect(result.encoding).toBe('gb18030');
    expect(result.replacementRatio).toBeGreaterThan(0);
  });
});
