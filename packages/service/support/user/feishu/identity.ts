import { createHash } from 'node:crypto';
import { serviceEnv } from '../../../env';

export const feishuUsername = (appId: string, openId: string) =>
  `feishu-${createHash('sha256').update(`${appId}:${openId}`).digest('hex')}`;

/** 只按当前应用的稳定身份授予和保护管理员。 */
export const getProtectedFeishuAdminUsername = () => {
  const { FEISHU_ORG_ENABLED, FEISHU_ORG_APP_ID, FEISHU_ORG_PROTECTED_ADMIN_OPEN_ID } = serviceEnv;
  if (!FEISHU_ORG_ENABLED || !FEISHU_ORG_APP_ID || !FEISHU_ORG_PROTECTED_ADMIN_OPEN_ID) return;
  return feishuUsername(FEISHU_ORG_APP_ID, FEISHU_ORG_PROTECTED_ADMIN_OPEN_ID);
};
