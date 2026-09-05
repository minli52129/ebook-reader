/**
 * OneDrive OAuth 2.0 PKCE 认证流程（纯前端，无需后端）。
 *
 * 流程：
 *   1. 生成 code_verifier + code_challenge (SHA-256)
 *   2. 跳转 Microsoft 授权页 → 用户登录并授权
 *   3. 重定向回来，用 code 换取 access_token + refresh_token
 *   4. token 存 localStorage，后续调用 Graph API
 *
 * PKCE 保证即使 client_secret 不存在（SPA 场景），授权码拦截攻击也无法奏效。
 */

import { onedriveConfig } from './onedrive-config';

const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export interface OneDriveTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/** 生成 PKCE code_verifier（随机 32 字节 base64url） */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** SHA-256 哈希后 base64url 编码 = code_challenge */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 构建授权 URL 并跳转 */
export async function startOneDriveAuth(): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateCodeVerifier();

  sessionStorage.setItem('onedrive-pkce', JSON.stringify({ codeVerifier, state }));

  const params = new URLSearchParams({
    client_id: onedriveConfig.client_id,
    response_type: 'code',
    redirect_uri: onedriveConfig.redirect_uri,
    scope: onedriveConfig.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * 处理授权重定向回调。在页面加载时调用，检测 URL 中是否有 code 参数。
 * 返回：是否处理了回调
 */
export async function handleAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (error !== null) {
    throw new Error(`OneDrive 授权失败：${error} ${params.get('error_description') ?? ''}`);
  }
  if (code === null || state === null) {
    return false;
  }

  const pkceRaw = sessionStorage.getItem('onedrive-pkce');
  if (pkceRaw === null) {
    throw new Error('PKCE 参数丢失，请重新发起授权');
  }
  sessionStorage.removeItem('onedrive-pkce');

  const pkce = JSON.parse(pkceRaw) as { codeVerifier: string; state: string };
  if (pkce.state !== state) {
    throw new Error('state 不匹配，可能存在安全威胁');
  }

  const tokens = await exchangeCodeForTokens(code, pkce.codeVerifier);
  saveTokens(tokens);

  window.history.replaceState({}, '', window.location.pathname);
  return true;
}

/** 用授权码换取 token */
async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OneDriveTokens> {
  const body = new URLSearchParams({
    client_id: onedriveConfig.client_id,
    grant_type: 'authorization_code',
    code,
    redirect_uri: onedriveConfig.redirect_uri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token 交换失败 (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

/** 刷新 access_token */
export async function refreshAccessToken(): Promise<OneDriveTokens> {
  const tokens = loadTokens();
  if (tokens === null) {
    throw new Error('未登录 OneDrive');
  }

  const body = new URLSearchParams({
    client_id: onedriveConfig.client_id,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    scope: onedriveConfig.scopes.join(' '),
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    clearTokens();
    throw new Error('Token 刷新失败，请重新授权');
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const newTokens: OneDriveTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(newTokens);
  return newTokens;
}

/** 获取有效 access_token（自动刷新） */
export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (tokens === null) {
    throw new Error('未登录 OneDrive');
  }
  if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken();
    return refreshed.access_token;
  }
  return tokens.access_token;
}

/** 是否已登录 */
export function isOneDriveLoggedIn(): boolean {
  return loadTokens() !== null;
}

/** 登出 */
export function logoutOneDrive(): void {
  clearTokens();
}

// ---------- token 存储 ----------

const TOKEN_KEY = 'onedrive-tokens';

function saveTokens(tokens: OneDriveTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function loadTokens(): OneDriveTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as OneDriveTokens;
  } catch {
    clearTokens();
    return null;
  }
}

function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}