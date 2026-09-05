export type ThemeId = 'light' | 'sepia' | 'night';

export type FontFamilyId = 'system' | 'serif' | 'sans';

export type ReadingMode = 'paged' | 'scroll';

export type TurnAnimation = 'none' | 'fade' | 'slide';

export interface ReaderSettings {
  /** 14–28 */
  fontSize: number;
  /** 1.2–2.6 */
  lineHeight: number;
  fontFamily: FontFamilyId;
  theme: ThemeId;
  /** 页边距 px */
  margin: number;
  /** 版心最大宽度 px */
  maxWidth: number;
  mode: ReadingMode;
  turnAnimation: TurnAnimation;
}

export const SETTINGS_LIMITS = {
  fontSize: { min: 14, max: 28, step: 1 },
  lineHeight: { min: 1.2, max: 2.6, step: 0.1 },
  margin: { min: 8, max: 80, step: 4 },
  maxWidth: { min: 320, max: 1200, step: 20 },
} as const;

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  fontFamily: 'serif',
  theme: 'light',
  margin: 24,
  maxWidth: 720,
  mode: 'paged',
  turnAnimation: 'fade',
};

/** 字体族 ID → CSS font-family 值 */
export const FONT_FAMILY_STACKS: Record<FontFamilyId, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  serif:
    "Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif CJK SC', SimSun, serif",
  sans:
    "'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif",
};
