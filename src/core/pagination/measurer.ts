/**
 * 文本测量抽象 —— 整个排版引擎可测试性的关键。
 *
 * 分页算法（core/pagination/paginator.ts）只依赖本接口，不碰 DOM，
 * 因此可以用假测量器（如 height = charCount * 20）做完整单元测试。
 * 真实实现见 platform/measurer/dom-measurer.ts，它是唯一读写 offsetHeight 的地方。
 */
export interface IMeasurer {
  /**
   * 测量 text 在当前排版参数下渲染后的总高度（px）。
   * 实现必须与真实渲染容器使用完全一致的字号、行距、字体族、宽度与换行策略，
   * 否则分页结果与实际显示会错位。
   */
  measure(text: string): number;

  /**
   * 在 maxHeight 约束下，base 之后最多还能追加 remaining 的前多少个字符。
   *
   * 典型实现为二分查找（O(log n) 次 measure）。
   * 返回值语义：
   *   - n (>0)：可容纳 remaining.slice(0, n)
   *   - 0    ：一个字符都放不下（容器高度小于单行高）
   *
   * 调用方必须处理 0 的情况并强制推进，否则分页会死循环。
   */
  fit(base: string, remaining: string, maxHeight: number): number;

  /** 单行高度（px），用于最小可容纳高度校验与空章保底页 */
  readonly lineHeightPx: number;
}
