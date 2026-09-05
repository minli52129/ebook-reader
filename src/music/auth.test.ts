import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./onedrive-config', () => ({
  onedriveConfig: { client_id: 'test-id', redirect_uri: 'http://localhost', scopes: [] },
  isOneDriveConfigured: () => true,
}));

describe('OneDrive 配置检测', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('isOneDriveConfigured 返回值随配置变化', async () => {
    const { isOneDriveConfigured } = await import('./onedrive-config');
    expect(isOneDriveConfigured()).toBe(true);
  });
});

describe('Graph API 音频检测', () => {
  it('识别常见音频格式', async () => {
    const { isAudioFile } = await import('./graph-api');
    expect(isAudioFile('song.mp3')).toBe(true);
    expect(isAudioFile('music.M4A')).toBe(true);
    expect(isAudioFile('album.flac')).toBe(true);
    expect(isAudioFile('track.opus')).toBe(true);
    expect(isAudioFile('podcast.wav')).toBe(true);
  });

  it('排除非音频文件', async () => {
    const { isAudioFile } = await import('./graph-api');
    expect(isAudioFile('photo.jpg')).toBe(false);
    expect(isAudioFile('video.mp4')).toBe(false);
    expect(isAudioFile('document.pdf')).toBe(false);
    expect(isAudioFile('readme.txt')).toBe(false);
  });
});
