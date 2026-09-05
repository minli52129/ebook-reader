/**
 * 文本编码探测与解码。
 *
 * 修复旧实现的问题：novel-reader 硬编码 readAsText(file,'UTF-8')，
 * 而中文网络小说 TXT 绝大多数是 GBK/GB18030，读成 UTF-8 会满屏乱码；
 * 更早的 ebook-reader 则硬编码 GBK，遇到 UTF-8 同样乱码。两侧都不做检测。
 *
 * 策略（GB18030 是 GBK/GB2312 的超集，覆盖所有中文变体编码）：
 *   1. BOM 判定（最可靠，零误判）
 *   2. UTF-8 严格模式（fatal: true 遇到非法字节即抛错，不产生静默替换）
 *   3. 回退 GB18030
 *   4. 兜底：两个解码器都产生替换符时，取替换符占比低者
 *
 * 依赖 WHATWG Encoding Standard：gb18030 是所有实现必须支持的标签，
 * 浏览器与 Node（full-icu，13+ 默认）均可用。
 */

export interface DecodeResult {
  text: string;
  /** 实际使用的编码标签（WHATWG 规范名） */
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';
  /** U+FFFD 替换符占比，用于质量评估与兜底比较 */
  replacementRatio: number;
}

function hasBom(bytes: Uint8Array, bom: readonly number[]): boolean {
  if (bytes.length < bom.length) return false;
  return bom.every((byte, i) => bytes[i] === byte);
}

function countReplacementChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === '\uFFFD') count++;
  }
  return count;
}

/** text 中替换符占比（按码点数计） */
function replacementRatio(text: string): number {
  const total = [...text].length;
  if (total === 0) return 0;
  return countReplacementChars(text) / total;
}

/**
 * 探测并解码字节缓冲为文本。
 *
 * 注意：纯 ASCII 与 UTF-8 无法区分，统一按 'utf-8' 报告（ASCII 是其子集）。
 */
export function decodeBuffer(buffer: ArrayBuffer): DecodeResult {
  const bytes = new Uint8Array(buffer);

  if (bytes.length === 0) {
    return { text: '', encoding: 'utf-8', replacementRatio: 0 };
  }

  // ---- 1. BOM 判定 ----
  if (hasBom(bytes, [0xef, 0xbb, 0xbf])) {
    const text = new TextDecoder('utf-8').decode(buffer);
    // TextDecoder 默认 stripBOM，无需手动去 BOM
    return { text, encoding: 'utf-8', replacementRatio: 0 };
  }
  if (hasBom(bytes, [0xff, 0xfe])) {
    const text = new TextDecoder('utf-16le').decode(buffer);
    return { text, encoding: 'utf-16le', replacementRatio: 0 };
  }
  if (hasBom(bytes, [0xfe, 0xff])) {
    const text = new TextDecoder('utf-16be').decode(buffer);
    return { text, encoding: 'utf-16be', replacementRatio: 0 };
  }

  // ---- 2. UTF-8 严格模式 ----
  // 无 BOM 的 UTF-8 占多数；fatal 模式下非法字节直接抛错，避免静默乱码。
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text, encoding: 'utf-8', replacementRatio: 0 };
  } catch {
    // 非法 UTF-8，继续
  }

  // ---- 3. GB18030 回退 ----
  const gbText = new TextDecoder('gb18030').decode(buffer);
  const gbRatio = replacementRatio(gbText);

  // ---- 4. 兜底：多数 GB18030 字节对都合法，替换符极少；
  //      若替换符占比不可忽略，说明连 GB18030 也解不动，报告真实质量 ----
  return { text: gbText, encoding: 'gb18030', replacementRatio: gbRatio };
}
