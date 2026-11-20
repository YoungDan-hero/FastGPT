import type { ApiRequestProps, ApiResponseType } from '@fastgpt/next/type';
import { ChatSourceTypeEnum } from '@fastgpt/global/core/chat/constants';
import { ChatErrEnum } from '@fastgpt/global/common/error/code/chat';
import { AuthUserTypeEnum } from '@fastgpt/global/support/permission/constant';
import {
  FeishuHandoffBodySchema,
  FeishuHandoffResponseSchema
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { authChatTargetCrud } from '@fastgpt/service/core/chat/auth';
import { transferChatToFeishu } from '@fastgpt/service/core/app/feishuHandoff/service';
import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import { NextAPI } from '@/service/middleware/entry';

export async function handler(req: ApiRequestProps, res: ApiResponseType) {
  if (req.method !== 'POST') return res.status(405).end();
  const { appId, chatId, turn, note, outLinkAuthData } = parseApiInput({
    req,
    bodySchema: FeishuHandoffBodySchema
  }).body;
  const auth = await authChatTargetCrud({
    req,
    authToken: true,
    authAppApiKey: false,
    sourceType: ChatSourceTypeEnum.app,
    sourceId: appId,
    chatId,
    outLinkAuthData
  });

  // 应用日志的可读权限不授予把其他人的会话发给客服的权限。
  if (
    !auth.chat ||
    String(auth.chat.teamId) !== auth.teamId ||
    (outLinkAuthData
      ? auth.authType !== AuthUserTypeEnum.outLink || auth.chat.outLinkUid !== auth.tmbId
      : auth.authType !== AuthUserTypeEnum.token ||
        String(auth.chat.tmbId) !== auth.tmbId ||
        Boolean(auth.chat.outLinkUid))
  ) {
    throw ChatErrEnum.unAuthChat;
  }
  res.setHeader('Cache-Control', 'no-store');
  return FeishuHandoffResponseSchema.parse(
    await transferChatToFeishu({
      teamId: auth.teamId,
      tmbId: auth.tmbId,
      appId: auth.sourceId,
      chatId,
      turn,
      note
    })
  );
}

export default NextAPI(handler);
