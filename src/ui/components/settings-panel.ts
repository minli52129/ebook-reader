import type { FontFamilyId, ReaderSettings, ThemeId } from '@/types/settings';
import { FONT_FAMILY_STACKS, SETTINGS_LIMITS } from '@/types/settings';

export interface SettingsCallbacks {
  onChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
}

/** 步进并夹取到合法范围 */
function clamp(
  value: number,
  range: { min: number; max: number; step: number },
  direction: number,
): number {
  const next = value + direction * range.step;
  return Math.min(range.max, Math.max(range.min, Number(next.toFixed(2))));
}

const THEME_OPTIONS: ReadonlyArray<{ id: ThemeId; label: string }> = [
  { id: 'light', label: '白' },
  { id: 'sepia', label: '黄' },
  { id: 'night', label: '黑' },
];

const FONT_OPTIONS: ReadonlyArray<{ id: FontFamilyId; label: string }> = [
  { id: 'serif', label: '宋' },
  { id: 'sans', label: '黑' },
  { id: 'system', label: '系' },
];

/**
 * 阅读设置面板（纯展示 + 回调，不直接写存储）。
 * 由 ReaderView 持有并注入回调。
 */
export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly callbacks: SettingsCallbacks;
  private settings: ReaderSettings;

  constructor(
    root: HTMLElement,
    settings: ReaderSettings,
    callbacks: SettingsCallbacks,
  ) {
    this.root = root;
    this.callbacks = callbacks;
    this.settings = settings;
    this.render();
  }

  update(settings: ReaderSettings): void {
    this.settings = settings;
    this.render();
  }

  private render(): void {
    const { fontSize, lineHeight, margin, mode, theme, fontFamily } = this.settings;
    const limits = SETTINGS_LIMITS;

    this.root.innerHTML = `
      <div class="panel-overlay" data-role="overlay"></div>
      <aside class="settings-panel">
        <header class="panel-header">
          <h3>阅读设置</h3>
          <button class="btn-ghost" data-role="close">✕</button>
        </header>
        <div class="panel-body">
          <div class="setting-row">
            <span class="setting-label">字号</span>
            <div class="setting-controls">
              <button data-role="font-" ${fontSize <= limits.fontSize.min ? 'disabled' : ''}>A−</button>
              <span class="setting-value">${fontSize}px</span>
              <button data-role="font+" ${fontSize >= limits.fontSize.max ? 'disabled' : ''}>A+</button>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">行距</span>
            <div class="setting-controls">
              <button data-role="line-" ${lineHeight <= limits.lineHeight.min ? 'disabled' : ''}>−</button>
              <span class="setting-value">${lineHeight.toFixed(1)}</span>
              <button data-role="line+" ${lineHeight >= limits.lineHeight.max ? 'disabled' : ''}>+</button>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">边距</span>
            <div class="setting-controls">
              <button data-role="margin-" ${margin <= limits.margin.min ? 'disabled' : ''}>−</button>
              <span class="setting-value">${margin}px</span>
              <button data-role="margin+" ${margin >= limits.margin.max ? 'disabled' : ''}>+</button>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">字体</span>
            <div class="setting-controls">
              ${FONT_OPTIONS.map(
                (f) =>
                  `<button data-role="font:${f.id}" class="${fontFamily === f.id ? 'active' : ''}">${f.label}</button>`,
              ).join('')}
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">背景</span>
            <div class="setting-controls">
              ${THEME_OPTIONS.map(
                (t) =>
                  `<button data-role="theme:${t.id}" class="theme-${t.id} ${theme === t.id ? 'active' : ''}">${t.label}</button>`,
              ).join('')}
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">翻页</span>
            <div class="setting-controls">
              <button data-role="mode:paged" class="${mode === 'paged' ? 'active' : ''}">分页</button>
              <button data-role="mode:scroll" class="${mode === 'scroll' ? 'active' : ''}">滚动</button>
            </div>
          </div>
        </div>
      </aside>
    `;

    this.bind();
  }

  private bind(): void {
    this.root
      .querySelector('[data-role="close"]')
      ?.addEventListener('click', this.callbacks.onClose);
    this.root
      .querySelector('[data-role="overlay"]')
      ?.addEventListener('click', this.callbacks.onClose);

    this.root.querySelectorAll<HTMLButtonElement>('button[data-role]').forEach((btn) => {
      const role = btn.dataset.role ?? '';
      btn.addEventListener('click', () => {
        const settings = this.settings;
        const limits = SETTINGS_LIMITS;
        switch (role) {
          case 'font-':
            this.callbacks.onChange({ fontSize: clamp(settings.fontSize, limits.fontSize, -1) });
            break;
          case 'font+':
            this.callbacks.onChange({ fontSize: clamp(settings.fontSize, limits.fontSize, 1) });
            break;
          case 'line-':
            this.callbacks.onChange({ lineHeight: clamp(settings.lineHeight, limits.lineHeight, -1) });
            break;
          case 'line+':
            this.callbacks.onChange({ lineHeight: clamp(settings.lineHeight, limits.lineHeight, 1) });
            break;
          case 'margin-':
            this.callbacks.onChange({ margin: clamp(settings.margin, limits.margin, -1) });
            break;
          case 'margin+':
            this.callbacks.onChange({ margin: clamp(settings.margin, limits.margin, 1) });
            break;
          default:
            this.applyChoice(role);
        }
      });
    });
  }

  private applyChoice(role: string): void {
    if (role.startsWith('theme:')) {
      this.callbacks.onChange({ theme: role.slice(6) as ThemeId });
    } else if (role.startsWith('font:')) {
      this.callbacks.onChange({ fontFamily: role.slice(5) as FontFamilyId });
    } else if (role.startsWith('mode:')) {
      this.callbacks.onChange({ mode: role.slice(5) === 'scroll' ? 'scroll' : 'paged' });
    }
  }
}

/** FontFamilyId → CSS font-family */
export function fontFamilyCss(id: FontFamilyId): string {
  return FONT_FAMILY_STACKS[id];
}
