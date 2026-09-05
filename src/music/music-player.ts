import {
  handleAuthCallback,
  isOneDriveLoggedIn,
  logoutOneDrive,
  startOneDriveAuth,
} from './auth';
import { isOneDriveConfigured } from './onedrive-config';
import { getAudioUrl, isAudioFile, listFiles, searchAudioFiles, type OneDriveFile } from './graph-api';

/** 播放列表中的曲目（含运行时解析的播放 URL） */
interface Track {
  file: OneDriveFile;
  /** 播放时懒加载的临时 URL */
  url?: string;
}

/**
 * 网页版音乐播放器视图。
 *
 * 功能：
 *   - OneDrive OAuth 授权（首次使用）
 *   - 浏览 OneDrive 文件夹 / 一键扫描全部音频
 *   - 播放控制：播放/暂停、上/下一首、进度、音量、随机/循环
 *   - 播放列表管理
 */
export class MusicPlayerView {
  private readonly root: HTMLElement;
  private audio: HTMLAudioElement;

  private tracks: Track[] = [];
  private currentIndex = -1;
  private folders: { name: string; path: string }[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.bindAudioEvents();
  }

  async open(): Promise<void> {
    // 处理 OAuth 回调
    try {
      await handleAuthCallback();
    } catch (error) {
      this.renderError((error as Error).message);
      return;
    }

    if (!isOneDriveConfigured()) {
      this.renderConfigRequired();
      return;
    }

    if (!isOneDriveLoggedIn()) {
      this.renderLogin();
      return;
    }

    await this.renderBrowser();
  }

  destroy(): void {
    this.audio.pause();
    this.audio.src = '';
  }

  // ---------- 渲染 ----------

  private renderConfigRequired(): void {
    this.root.innerHTML = `
      <div class="view music-view">
        <header class="music-header">
          <a class="btn-ghost" href="#/">&lt; 返回书架</a>
          <h2>🎵 音乐播放器</h2>
        </header>
        <div class="music-config-required">
          <h3>⚠️ 需要先配置 OneDrive</h3>
          <p>请先在 Azure AD 应用注册，然后把 client_id 填入代码：</p>
          <ol class="config-steps">
            <li>访问 <a href="https://portal.azure.com" target="_blank" rel="noopener">Azure 门户</a> → Azure Active Directory → 应用注册 → 新注册</li>
            <li>名称任意；账户类型选"任何组织目录和个人 Microsoft 账户"</li>
            <li>平台选"单页应用程序(SPA)"；重定向 URI 填：<code>${window.location.origin}${window.location.pathname}</code></li>
            <li>注册后复制"应用程序(客户端) ID"</li>
            <li>打开 <code>src/music/onedrive-config.ts</code>，把 client_id 填入</li>
            <li>API 权限：添加 Microsoft Graph → 委托权限 → <code>Files.Read</code>、<code>User.Read</code>、<code>offline_access</code></li>
          </ol>
          <p class="hint">配置完成后刷新页面即可授权登录。</p>
        </div>
      </div>
    `;
  }

  private renderLogin(): void {
    this.root.innerHTML = `
      <div class="view music-view">
        <header class="music-header">
          <a class="btn-ghost" href="#/">&lt; 返回书架</a>
          <h2>🎵 音乐播放器</h2>
        </header>
        <div class="music-login">
          <div class="login-card">
            <h3>连接到 OneDrive</h3>
            <p>音源来自你的 OneDrive 网盘，需要授权访问文件。</p>
            <ul class="login-permissions">
              <li>✅ 读取你的音频文件用于播放</li>
              <li>🔒 不会修改或删除任何文件</li>
              <li>🔒 仅本机浏览器存储授权令牌</li>
            </ul>
            <button class="btn-primary btn-large" data-role="auth">使用 Microsoft 账号登录</button>
          </div>
        </div>
      </div>
    `;
    this.root.querySelector('[data-role="auth"]')?.addEventListener('click', () => {
      void startOneDriveAuth();
    });
  }

  private async renderBrowser(): Promise<void> {
    this.renderLayout();
    await this.loadFolder('');
  }

  private renderLayout(): void {
    this.root.innerHTML = `
      <div class="view music-view">
        <header class="music-header">
          <a class="btn-ghost" href="#/">&lt; 返回书架</a>
          <h2>🎵 音乐播放器</h2>
          <div class="music-header-actions">
            <button class="btn-ghost" data-role="scan">📡 扫描全部音频</button>
            <button class="btn-ghost" data-role="logout">退出登录</button>
          </div>
        </header>

        <div class="music-main">
          <aside class="music-sidebar">
            <div class="breadcrumb" data-role="breadcrumb"></div>
            <div class="file-list" data-role="file-list"></div>
          </aside>

          <section class="music-player">
            <div class="now-playing" data-role="now-playing">
              <div class="now-playing-empty">选择一首歌曲开始播放</div>
            </div>
            <div class="player-controls" data-role="player-controls" hidden>
              <div class="progress-row">
                <span class="time" data-role="current-time">0:00</span>
                <input class="progress-bar" data-role="progress" type="range" min="0" max="100" value="0" step="0.1"/>
                <span class="time" data-role="duration">0:00</span>
              </div>
              <div class="control-buttons">
                <button class="ctrl-btn" data-role="prev" title="上一首">⏮</button>
                <button class="ctrl-btn ctrl-play" data-role="play" title="播放/暂停">▶</button>
                <button class="ctrl-btn" data-role="next" title="下一首">⏭</button>
                <button class="ctrl-btn" data-role="shuffle" title="随机">🔀</button>
                <button class="ctrl-btn" data-role="repeat" title="循环">🔁</button>
                <div class="volume-control">
                  <button class="ctrl-btn" data-role="mute" title="静音">🔊</button>
                  <input class="volume-bar" data-role="volume" type="range" min="0" max="1" value="1" step="0.01"/>
                </div>
              </div>
            </div>
          </section>
        </div>

        <footer class="music-playlist-footer">
          <h4>播放列表 <span data-role="track-count">(0)</span></h4>
          <ul class="playlist" data-role="playlist"></ul>
        </footer>
      </div>
    `;
    this.bindControls();
  }

    // ---------- 文件浏览 ----------

  private async loadFolder(path: string): Promise<void> {
    const fileList = this.root.querySelector('[data-role="file-list"]');
    const breadcrumb = this.root.querySelector('[data-role="breadcrumb"]');

    if (fileList === null) return;
    fileList.innerHTML = '<div class="loading">加载中…</div>';

    try {
      const files = await listFiles(path);
      this.folders = files
        .filter((f) => f.isFolder)
        .map((f) => ({ name: f.name, path: path === '' ? f.name : `${path}/${f.name}` }));

      const audioFiles = files.filter((f) => !f.isFolder && isAudioFile(f.name));

      // 面包屑
      if (breadcrumb !== null) {
        const parts = path === '' ? [] : path.split('/');
        const crumbs = [
          { name: '🏠 根目录', path: '' },
          ...parts.map((part, i) => ({
            name: part,
            path: parts.slice(0, i + 1).join('/'),
          })),
        ];
        breadcrumb.innerHTML = crumbs
          .map(
            (c) =>
              `<a class="crumb" data-path="${c.path}">${escapeHtml(c.name)}</a>`,
          )
          .join(' <span class="crumb-sep">/</span> ');
        breadcrumb.querySelectorAll<HTMLAnchorElement>('.crumb').forEach((el) => {
          el.addEventListener('click', () => {
            void this.loadFolder(el.dataset.path ?? '');
          });
        });
      }

      // 文件列表
      if (this.folders.length === 0 && audioFiles.length === 0) {
        fileList.innerHTML = '<div class="empty-folder">此文件夹没有音频文件 🎵</div>';
        return;
      }

      const rows: string[] = [];
      for (const folder of this.folders) {
        rows.push(`
          <div class="file-item folder-item" data-role="folder" data-path="${folder.path}">
            <span class="file-icon">📁</span>
            <span class="file-name">${escapeHtml(folder.name)}</span>
          </div>`);
      }
      for (const file of audioFiles) {
        rows.push(`
          <div class="file-item audio-item" data-role="audio" data-id="${file.id}" data-name="${escapeHtml(file.name)}">
            <span class="file-icon">🎵</span>
            <span class="file-name">${escapeHtml(file.name)}</span>
            <span class="file-size">${formatSize(file.size ?? 0)}</span>
          </div>`);
      }
      fileList.innerHTML = rows.join('');

      fileList.querySelectorAll<HTMLElement>('[data-role="folder"]').forEach((el) => {
        el.addEventListener('click', () => {
          void this.loadFolder(el.dataset.path ?? '');
        });
      });
      fileList.querySelectorAll<HTMLElement>('[data-role="audio"]').forEach((el) => {
        el.addEventListener('click', () => {
          void this.playFiles(audioFiles, audioFiles.findIndex((f) => f.id === el.dataset.id));
        });
      });
    } catch (error) {
      if (fileList !== null) {
        fileList.innerHTML = `<div class="error-msg">加载失败：${escapeHtml((error as Error).message)}</div>`;
      }
    }
  }

  /** 扫描全部音频 */
  private async scanAllAudio(): Promise<void> {
    const fileList = this.root.querySelector('[data-role="file-list"]');
    if (fileList === null) return;
    fileList.innerHTML = '<div class="loading">正在扫描 OneDrive 中的音频文件…</div>';

    try {
      const audioFiles = await searchAudioFiles('', 200);
      if (audioFiles.length === 0) {
        fileList.innerHTML = '<div class="empty-folder">OneDrive 中未找到音频文件</div>';
        return;
      }

      const rows = audioFiles.map(
        (file) => `
        <div class="file-item audio-item" data-role="audio" data-id="${file.id}" data-name="${escapeHtml(file.name)}">
          <span class="file-icon">🎵</span>
          <span class="file-name">${escapeHtml(file.name)}</span>
          <span class="file-size">${formatSize(file.size ?? 0)}</span>
        </div>`,
      );
      fileList.innerHTML = `<div class="scan-result">共找到 ${audioFiles.length} 首音频</div>${rows.join('')}`;

      fileList.querySelectorAll<HTMLElement>('[data-role="audio"]').forEach((el) => {
        el.addEventListener('click', () => {
          void this.playFiles(audioFiles, audioFiles.findIndex((f) => f.id === el.dataset.id));
        });
      });
    } catch (error) {
      if (fileList !== null) {
        fileList.innerHTML = `<div class="error-msg">扫描失败：${escapeHtml((error as Error).message)}</div>`;
      }
    }
  }

  // ---------- 播放控制 ----------

  private bindAudioEvents(): void {
    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('loadedmetadata', () => {
      const duration = this.root.querySelector('[data-role="duration"]');
      if (duration !== null) duration.textContent = formatTime(this.audio.duration);
      const progress = this.root.querySelector<HTMLInputElement>('[data-role="progress"]');
      if (progress !== null) progress.max = String(this.audio.duration);
    });
    this.audio.addEventListener('ended', () => this.playNext());
    this.audio.addEventListener('play', () => {
      const playBtn = this.root.querySelector('[data-role="play"]');
      if (playBtn !== null) playBtn.textContent = '⏸';
    });
    this.audio.addEventListener('pause', () => {
      const playBtn = this.root.querySelector('[data-role="play"]');
      if (playBtn !== null) playBtn.textContent = '▶';
    });
  }

  private bindControls(): void {
    this.root.querySelector('[data-role="scan"]')?.addEventListener('click', () => {
      void this.scanAllAudio();
    });
    this.root.querySelector('[data-role="logout"]')?.addEventListener('click', () => {
      logoutOneDrive();
      this.renderLogin();
    });

    this.root.querySelector('[data-role="play"]')?.addEventListener('click', () => this.togglePlay());
    this.root.querySelector('[data-role="prev"]')?.addEventListener('click', () => this.playPrev());
    this.root.querySelector('[data-role="next"]')?.addEventListener('click', () => this.playNext());

    const progress = this.root.querySelector<HTMLInputElement>('[data-role="progress"]');
    progress?.addEventListener('input', () => {
      this.audio.currentTime = Number(progress.value);
    });

    const volume = this.root.querySelector<HTMLInputElement>('[data-role="volume"]');
    volume?.addEventListener('input', () => {
      this.audio.volume = Number(volume.value);
      this.audio.muted = false;
    });

    this.root.querySelector('[data-role="mute"]')?.addEventListener('click', () => {
      this.audio.muted = !this.audio.muted;
    });
  }

  /** 播放指定列表的指定曲目 */
  private async playFiles(files: OneDriveFile[], index: number): Promise<void> {
    this.tracks = files.map((file) => ({ file }));
    this.currentIndex = index;
    await this.playCurrent();
    this.renderPlaylist();
  }

  private async playCurrent(): Promise<void> {
    if (this.currentIndex < 0 || this.currentIndex >= this.tracks.length) return;
    const track = this.tracks[this.currentIndex];

    if (track.url === undefined) {
      try {
        track.url = await getAudioUrl(track.file.id);
      } catch (error) {
        this.renderError(`获取音频链接失败：${(error as Error).message}`);
        return;
      }
    }

    this.audio.src = track.url;
    try {
      await this.audio.play();
    } catch (error) {
      this.renderError(`播放失败：${(error as Error).message}`);
    }

    this.renderNowPlaying(track);
    const controls = this.root.querySelector<HTMLElement>('[data-role="player-controls"]');
    if (controls !== null) controls.hidden = false;
  }

  private togglePlay(): void {
    if (this.audio.src === '') return;
    if (this.audio.paused) {
      void this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  private playNext(): void {
    if (this.tracks.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.tracks.length;
    void this.playCurrent();
    this.renderPlaylist();
  }

  private playPrev(): void {
    if (this.tracks.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.tracks.length) % this.tracks.length;
    void this.playCurrent();
    this.renderPlaylist();
  }

  // ---------- UI 更新 ----------

  private renderNowPlaying(track: Track): void {
    const container = this.root.querySelector('[data-role="now-playing"]');
    if (container === null) return;
    container.innerHTML = `
      <div class="np-cover">🎵</div>
      <div class="np-info">
        <div class="np-title">${escapeHtml(track.file.name)}</div>
        <div class="np-meta">${formatSize(track.file.size ?? 0)}</div>
      </div>
    `;
  }

  private renderPlaylist(): void {
    const container = this.root.querySelector('[data-role="playlist"]');
    const count = this.root.querySelector('[data-role="track-count"]');
    if (container === null) return;
    if (count !== null) count.textContent = `(${this.tracks.length})`;

    container.innerHTML = this.tracks
      .map(
        (track, i) => `
        <li class="playlist-item ${i === this.currentIndex ? 'active' : ''}" data-index="${i}">
          <span class="pl-num">${i + 1}</span>
          <span class="pl-name">${escapeHtml(track.file.name)}</span>
        </li>`,
      )
      .join('');

    container.querySelectorAll<HTMLElement>('.playlist-item').forEach((item) => {
      item.addEventListener('click', () => {
        this.currentIndex = Number(item.dataset.index);
        void this.playCurrent();
        this.renderPlaylist();
      });
    });
  }

  private updateProgress(): void {
    const progress = this.root.querySelector<HTMLInputElement>('[data-role="progress"]');
    const currentTime = this.root.querySelector('[data-role="current-time"]');
    if (progress !== null) progress.value = String(this.audio.currentTime);
    if (currentTime !== null) currentTime.textContent = formatTime(this.audio.currentTime);
  }

  private renderError(message: string): void {
    const existing = this.root.querySelector('.music-error');
    if (existing !== null) existing.remove();

    const error = document.createElement('div');
    error.className = 'music-error';
    error.textContent = message;
    this.root.prepend(error);
  }
}

// ---------- 工具函数 ----------

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}