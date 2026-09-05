import { getValidAccessToken } from './auth';

/**
 * Microsoft Graph API —— OneDrive 文件访问。
 *
 * 只读操作：列出文件夹、搜索音频文件、获取下载 URL。
 * 音频文件通过 @microsoft.graph.downloadUrl 流式播放（临时直链，由 Graph 生成）。
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface OneDriveFile {
  id: string;
  name: string;
  /** 文件夹时为 true */
  isFolder: boolean;
  /** 文件大小（字节），文件夹为 undefined */
  size?: number;
  /**  mime 类型 */
  mimeType?: string;
  /** 音频播放用的临时下载 URL（获取单个文件时填充） */
  downloadUrl?: string;
  /** 所在文件夹路径 */
  path?: string;
}

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount: number };
  file?: { mimeType: string };
  '@microsoft.graph.downloadUrl'?: string;
}

/** Graph API 通用请求 */
async function graphRequest<T>(path: string): Promise<T> {
  const token = await getValidAccessToken();
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph API 请求失败 (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

/** 列出指定文件夹的子项（默认根目录） */
export async function listFiles(folderPath = ''): Promise<OneDriveFile[]> {
  const endpoint =
    folderPath === ''
      ? '/me/drive/root/children'
      : `/me/drive/root:/${encodeURIComponent(folderPath)}:/children`;

  const data = await graphRequest<{ value: GraphDriveItem[] }>(
        `${endpoint}?$select=id,name,size,folder,file&$top=200`,
      );

  return data.value.map((item) => ({
    id: item.id,
    name: item.name,
    isFolder: item.folder !== undefined,
    size: item.size,
    mimeType: item.file?.mimeType,
  }));
}

/** 通过 ID 获取单个文件（含下载 URL） */
export async function getFile(fileId: string): Promise<OneDriveFile> {
  const item = await graphRequest<GraphDriveItem>(
    `/me/drive/items/${fileId}?$select=id,name,size,folder,file,@microsoft.graph.downloadUrl`,
  );

  return {
    id: item.id,
    name: item.name,
    isFolder: item.folder !== undefined,
    size: item.size,
    mimeType: item.file?.mimeType,
    downloadUrl: item['@microsoft.graph.downloadUrl'],
  };
}

/** 获取音频文件的播放 URL（临时直链） */
export async function getAudioUrl(fileId: string): Promise<string> {
  const file = await getFile(fileId);
  if (file.downloadUrl === undefined) {
    throw new Error('无法获取音频下载链接');
  }
  return file.downloadUrl;
}

/** 支持的音频格式 */
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.wav', '.flac', '.opus', '.wma'];

/** 判断是否为音频文件 */
export function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 递归搜索所有音频文件（限制数量避免请求过多） */
export async function searchAudioFiles(
  folderPath = '',
  limit = 200,
): Promise<OneDriveFile[]> {
  const files = await listFiles(folderPath);
  const audioFiles: OneDriveFile[] = [];

  const folders: string[] = [];

  for (const file of files) {
    if (audioFiles.length >= limit) break;
    if (file.isFolder) {
      folders.push(folderPath === '' ? file.name : `${folderPath}/${file.name}`);
    } else if (isAudioFile(file.name)) {
      audioFiles.push(file);
    }
  }

  // 递归子文件夹（限制深度避免过多请求）
  for (const folder of folders) {
    if (audioFiles.length >= limit) break;
    try {
      const subFiles = await searchAudioFiles(folder, limit - audioFiles.length);
      audioFiles.push(...subFiles);
    } catch {
      // 跳过无权限的文件夹
    }
  }

  return audioFiles;
}
