import type { Layout } from '@/types/reader';

/**
 * 参与排版计算的字段顺序，即缓存键的组成顺序。
 * 单独导出以便测试断言「任一维度变化都会使缓存失效」。
 */
const LAYOUT_FIELDS = [
  'fontSize',
  'lineHeight',
  'fontFamily',
  'viewportWidth',
  'viewportHeight',
  'margin',
  'maxWidth',
] as const satisfies readonly (keyof Layout)[];

/**
 * 生成排版缓存键。
 *
 * 分页是重计算（DOM 测量 + 二分查找），必须按排版参数缓存。
 * 键必须覆盖所有影响布局的维度 —— 漏掉任何一个都会导致
 * 「改了字号但复用了旧分页」这类难查的显示错位 bug。
 *
 * 数值直接参与拼接，浮点行距（如 1.7000000000000002）不会被截断丢失精度。
 */
export function buildLayoutKey(layout: Layout): string {
  return LAYOUT_FIELDS.map((field) => String(layout[field])).join('|');
}

/** 供测试与调试使用：返回参与缓存键的字段名 */
export function layoutFields(): readonly string[] {
  return LAYOUT_FIELDS;
}
