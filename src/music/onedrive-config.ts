/**
 * OneDrive OAuth 配置。
 *
 * 使用前需要在 Azure AD 注册应用：
 *   1. 访问 https://portal.azure.com → Azure Active Directory → 应用注册 → 新注册
 *   2. 名称：任意（如"电子书阅读器-音乐"）；受支持的账户类型：任何组织目录和个人 Microsoft 账户
 *   3. 平台：单页应用程序(SPA)；重定向 URI：本应用的 URL（如 https://minli52129.github.io/ebook-reader/）
 *   4. 注册后获取"应用程序(客户端) ID"填入下方 client_id
 *   5. API 权限：Microsoft Graph → 委托权限 → Files.Read、User.Read、offline_access（无需管理员同意）
 *
 * 注意：client_id 是公开信息（SPA 应用无法保密），PKCE 流程保证安全性。
 */

export interface OneDriveOAuthConfig {
  client_id: string;
  /** 重定向 URI，必须与 Azure AD 注册时一致 */
  redirect_uri: string;
  /** 请求的权限范围 */
  scopes: string[];
}

export const onedriveConfig: OneDriveOAuthConfig = {
  client_id: '3a62535f-83c5-4346-a461-83a226c5db2b',
  redirect_uri: typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '',
  scopes: ['Files.Read', 'User.Read', 'offline_access'],
};

/** 判断是否已配置 client_id */
export function isOneDriveConfigured(): boolean {
  return onedriveConfig.client_id.trim() !== '';
}
