import type { IMeasurer } from '@/core/pagination/measurer';

/**
 * IMeasurer 的 DOM 实现 —— 项目中唯一读写 offsetHeight 的地方。
 *
 * 测量元素与真实渲染容器必须使用完全一致的排版样式
 * （字号、行距、字体族、宽度、换行策略），否则分页结果与实际显示错位。
 * 样式通过 applyLayout 注入，视图层换排版参数后必须重建实例。
 */
export interface DomMeasurerOptions {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  /** 版心宽度（px），与渲染容器内容区等宽 */
  widthPx: number;
}

export class DomMeasurer implements IMeasurer {
  private readonly el: HTMLDivElement;
  readonly lineHeightPx: number;

  constructor(container: HTMLElement, options: DomMeasurerOptions) {
    this.el = document.createElement('div');
    this.el.setAttribute('aria-hidden', 'true');
    container.appendChild(this.el);
    this.applyLayout(options);

    // 单字符高度 = 行高（含行距）
    this.el.textContent = '测';
    this.lineHeightPx = this.el.offsetHeight;
  }

  /** 与渲染容器保持一致的排版样式（修改时两处必须同步） */
  private applyLayout(options: DomMeasurerOptions): void {
    this.el.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      'visibility:hidden',
      `width:${options.widthPx}px`,
      `font-size:${options.fontSize}px`,
      `line-height:${options.lineHeight}`,
      `font-family:${options.fontFamily}`,
      // 中英混排：CJK 可断行，西文单词不断
      'white-space:pre-wrap',
      'overflow-wrap:break-word',
      'word-break:normal',
    ].join(';');
  }

  measure(text: string): number {
    this.el.textContent = text;
    return this.el.offsetHeight;
  }

  /** 二分查找：base 之后最多还能容纳 remaining 的前多少字符 */
  fit(base: string, remaining: string, maxHeight: number): number {
    let low = 0;
    let high = remaining.length;
    let result = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.measure(base + remaining.slice(0, mid)) <= maxHeight) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  destroy(): void {
    this.el.remove();
  }
}
