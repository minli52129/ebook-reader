import type { BookMeta } from '@/types/book';
import { DEFAULT_SETTINGS, type ReaderSettings } from '@/types/settings';

/** 轻量状态容器：不可变替换 + 订阅通知 */
export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  /** 浅合并 patch 后通知订阅者 */
  set(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** 返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export interface AppState {
  books: BookMeta[];
  settings: ReaderSettings;
  /** IndexedDB 不可用等致命错误 */
  fatal: string | null;
}

export const appStore = new Store<AppState>({
  books: [],
  settings: DEFAULT_SETTINGS,
  fatal: null,
});
