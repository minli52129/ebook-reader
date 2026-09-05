import { describe, expect, it } from 'vitest';

import type { Layout } from '@/types/reader';

import { buildLayoutKey, layoutFields } from './layout-key';

const baseLayout: Layout = {
  fontSize: 18,
  lineHeight: 1.8,
  fontFamily: 'serif',
  viewportWidth: 800,
  viewportHeight: 600,
  margin: 24,
  maxWidth: 720,
};

/** 复制一份，避免测试间相互污染 */
function clone(overrides: Partial<Layout> = {}): Layout {
  return { ...baseLayout, ...overrides };
}

describe('buildLayoutKey', () => {
  it('对相同排版参数产出稳定的键', () => {
    expect(buildLayoutKey(clone())).toBe(buildLayoutKey(clone()));
  });

  it('键包含全部排版维度', () => {
    expect(buildLayoutKey(baseLayout)).toBe(
      '18|1.8|serif|800|600|24|720',
    );
    expect(layoutFields()).toHaveLength(7);
  });

  it.each<[keyof Layout, number | string]>([
    ['fontSize', 20],
    ['lineHeight', 2.0],
    ['fontFamily', 'sans'],
    ['viewportWidth', 1024],
    ['viewportHeight', 768],
    ['margin', 32],
    ['maxWidth', 900],
  ])('任一维度变化（%s）都会使缓存键失效', (field, value) => {
    expect(buildLayoutKey(clone({ [field]: value }))).not.toBe(
      buildLayoutKey(baseLayout),
    );
  });

  it('不丢失浮点行距精度', () => {
    // 行距经 0.1 递增后常出现二进制浮点尾数
    const drifted = clone({ lineHeight: 1.7000000000000002 });
    expect(buildLayoutKey(drifted)).not.toBe(buildLayoutKey(clone({ lineHeight: 1.7 })));
    expect(buildLayoutKey(drifted)).toContain('1.7000000000000002');
  });

  it('字段间不会因拼接产生歧义碰撞', () => {
    // "1|8" 与 "18" 之类的跨字段拼接歧义
    const a = clone({ fontSize: 1, lineHeight: 8 });
    const b = clone({ fontSize: 18, lineHeight: 1 });
    expect(buildLayoutKey(a)).not.toBe(buildLayoutKey(b));
  });
});
