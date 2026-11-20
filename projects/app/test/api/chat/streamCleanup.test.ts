import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { feishuHandoffReply } from '@fastgpt/global/core/app/feishuHandoff';
import { workflowSseEvent } from '@fastgpt/global/core/workflow/runtime/sse';
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authChatCompletionHeaderRequest: vi.fn(),
  getFeishuHandoffChatOptions: vi.fn(),
  preChatRound: vi.fn(),
  dispatchWorkFlow: vi.fn(),
  finalizeChatRound: vi.fn(),
  failChatRound: vi.fn(),
  updateInteractiveChat: vi.fn(),
  responseWrite: vi.fn(),
  writeStreamError: vi.fn(),
  flushResume: vi.fn()
}));

vi.mock('@/service/middleware/entry', () => ({ NextAPI: (handler: unknown) => handler }));
vi.mock('@/service/support/permission/auth/chatCompletion', () => ({
  authChatCompletionHeaderRequest: mocks.authChatCompletionHeaderRequest
}));
vi.mock('@fastgpt/service/core/app/feishuHandoff/service', () => ({
  getFeishuHandoffChatOptions: mocks.getFeishuHandoffChatOptions
}));
vi.mock('@fastgpt/service/core/app/record/utils', () => ({ recordAppUsage: vi.fn() }));
vi.mock('@fastgpt/service/support/permission/app/auth', () => ({
  authApp: mocks.authChatCompletionHeaderRequest
}));
vi.mock('@fastgpt/service/core/app/resource/service', () => ({
  prepareAppWorkflowResources: vi.fn(async () => [])
}));
vi.mock('@fastgpt/service/common/api/frequencyLimit', () => ({
  LimitTypeEnum: { chat: 'chat' },
  teamFrequencyLimit: vi.fn(async () => true)
}));
vi.mock('@fastgpt/service/core/app/version/controller', () => ({
  getAppLatestVersion: vi.fn(async () => ({
    versionId: 'version-1',
    nodes: [],
    edges: [],
    chatConfig: {},
    resources: []
  }))
}));
vi.mock('@fastgpt/service/core/workflow/utils/fileLimits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fastgpt/service/core/workflow/utils/fileLimits')>()),
  getWorkflowFileLimits: vi.fn(async () => ({ maxFileAmount: 5, maxBytesPerFile: 1024 }))
}));
vi.mock('@fastgpt/service/support/user/team/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fastgpt/service/support/user/team/utils')>()),
  getRunningUserInfoByTmbId: vi.fn(async () => ({}))
}));
vi.mock('@fastgpt/service/core/chat/utils/prepare', () => ({
  preChatRound: mocks.preChatRound
}));
vi.mock('@fastgpt/service/core/chat/saveChat', () => ({
  finalizeChatRound: mocks.finalizeChatRound,
  failChatRound: mocks.failChatRound,
  updateInteractiveChat: mocks.updateInteractiveChat
}));
vi.mock('@fastgpt/service/core/workflow/dispatch', () => ({
  dispatchWorkFlow: mocks.dispatchWorkFlow
}));
vi.mock('@fastgpt/service/core/chat/title', () => ({
  createGeneratedChatTitleSender: () => ({
    start: vi.fn(async () => undefined),
    send: vi.fn(async () => ''),
    close: vi.fn()
  })
}));
vi.mock('@fastgpt/service/core/workflow/utils/streamResponseContext', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@fastgpt/service/core/workflow/utils/streamResponseContext')
  >()),
  createWorkflowStreamResponseContext: vi.fn(async () => ({
    responseWrite: mocks.responseWrite,
    writeStreamError: mocks.writeStreamError,
    flushResume: mocks.flushResume
  }))
}));

import completionsHandler from '@/pages/api/v2/chat/completions';
import chatTestHandler from '@/pages/api/core/chat/chatTest';

describe.each([
  { name: 'v2 completions', handler: completionsHandler, supportsNonStream: true },
  { name: 'workflow chatTest', handler: chatTestHandler, supportsNonStream: false }
])('$name stream cleanup', ({ handler, supportsNonStream }) => {
  const appId = '67f4c91c79a4d61b1f116b2a';
  const auth = {
    teamId: '67f4c91c79a4d61b1f116b2b',
    tmbId: '67f4c91c79a4d61b1f116b2c',
    authType: 'apikey',
    app: { _id: appId, name: 'Chat', type: AppTypeEnum.workflow }
  };
  const preparedRound = {
    chatId: 'chat-1',
    responseChatItemId: 'response-1',
    shouldPersistChatRound: true,
    shouldFinalizePreparedRound: true
  };

  const runRequest = (stream = true, question = 'Hello') => {
    const response = { end: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() };
    const request = {
      headers: {},
      body: {
        appId,
        chatId: preparedRound.chatId,
        responseChatItemId: preparedRound.responseChatItemId,
        messages: [{ role: 'user', content: question }],
        nodes: [],
        edges: [],
        chatConfig: {},
        appName: 'Chat',
        stream
      }
    } as NextApiRequest;

    return {
      response,
      result: handler(request, response as unknown as NextApiResponse)
    };
  };

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.authChatCompletionHeaderRequest.mockResolvedValue(auth);
    mocks.preChatRound.mockResolvedValue({ ...preparedRound });
    mocks.dispatchWorkFlow.mockResolvedValue({
      flowUsages: [],
      assistantResponses: [],
      newVariables: {},
      durationSeconds: 1,
      flatNodeResponses: []
    });
    mocks.flushResume.mockResolvedValue(undefined);
  });

  it('waits for queued stream events before ending a successful response', async () => {
    const started = Promise.withResolvers<void>();
    const flushed = Promise.withResolvers<void>();
    mocks.flushResume.mockImplementationOnce(() => {
      started.resolve();
      return flushed.promise;
    });

    const { response, result } = runRequest();
    await started.promise;
    expect(response.end).not.toHaveBeenCalled();
    flushed.resolve();
    await result;

    expect(mocks.finalizeChatRound).toHaveBeenCalledOnce();
    expect(mocks.flushResume).toHaveBeenCalledOnce();
    expect(response.end).toHaveBeenCalledOnce();
  });

  it('flushes once after reporting a workflow error', async () => {
    const error = new Error('Workflow failed');
    mocks.dispatchWorkFlow.mockRejectedValueOnce(error);

    const { response, result } = runRequest();
    await result;

    expect(mocks.writeStreamError).toHaveBeenCalledWith(error);
    expect(mocks.flushResume).toHaveBeenCalledOnce();
    expect(response.end).toHaveBeenCalledOnce();
  });

  it('cleans up and preserves errors after round persistence fails', async () => {
    const persistenceError = new Error('Failure persistence failed');
    mocks.preChatRound.mockResolvedValueOnce({
      ...preparedRound,
      shouldFinalizePreparedRound: true
    });
    mocks.dispatchWorkFlow.mockRejectedValueOnce(new Error('Workflow failed'));
    mocks.failChatRound.mockRejectedValueOnce(persistenceError);

    const { response, result } = runRequest();
    await expect(result).rejects.toBe(persistenceError);

    expect(mocks.failChatRound).toHaveBeenCalledOnce();
    expect(mocks.flushResume).toHaveBeenCalledOnce();
    expect(response.end).toHaveBeenCalledOnce();
  });

  it('ends a rejected stream even when no stream context was created', async () => {
    mocks.authChatCompletionHeaderRequest.mockRejectedValueOnce(new Error('Unauthorized'));

    const { response, result } = runRequest();
    await result;

    expect(mocks.flushResume).not.toHaveBeenCalled();
    expect(response.end).toHaveBeenCalledOnce();
  });

  if (supportsNonStream) {
    it('员工明确要求转人工时保存卡片并跳过工作流', async () => {
      mocks.authChatCompletionHeaderRequest.mockResolvedValueOnce({ ...auth, authType: 'token' });
      mocks.getFeishuHandoffChatOptions.mockResolvedValueOnce({ categories: [] });
      await runRequest(true, '麻烦帮我转一下人工客服').result;

      expect(mocks.dispatchWorkFlow).not.toHaveBeenCalled();
      expect(mocks.finalizeChatRound).toHaveBeenCalledWith(
        expect.objectContaining({
          aiContent: expect.objectContaining({
            value: [{ text: { content: feishuHandoffReply }, displayOnly: true }]
          })
        })
      );
      expect(mocks.responseWrite).toHaveBeenCalledWith(
        workflowSseEvent.fastAnswerDelta(feishuHandoffReply)
      );
      expect(mocks.finalizeChatRound.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.responseWrite.mock.invocationCallOrder[0]
      );
    });

    it.each([
      { answer: '知识库里暂未找到足以回答这个问题的资料。', enabled: true, offer: true },
      { answer: '退款可在签收后 7 天内申请。', enabled: true, offer: false },
      { answer: '知识库里暂未找到足以回答这个问题的资料。', enabled: false, offer: false }
    ])('按回答和应用配置决定是否在本轮追加卡片 $offer', async ({ answer, enabled, offer }) => {
      mocks.authChatCompletionHeaderRequest.mockResolvedValueOnce({ ...auth, authType: 'token' });
      mocks.getFeishuHandoffChatOptions.mockResolvedValueOnce(
        enabled ? { categories: [] } : undefined
      );
      mocks.dispatchWorkFlow.mockResolvedValueOnce({
        flowUsages: [],
        assistantResponses: [{ text: { content: answer } }],
        newVariables: {},
        durationSeconds: 1
      });
      await runRequest(true, '告诉我退款规则').result;

      expect(mocks.dispatchWorkFlow).toHaveBeenCalledOnce();
      const card = `\n\n${feishuHandoffReply}`;
      const expectedValues = [
        { text: { content: answer } },
        ...(offer ? [{ text: { content: card }, displayOnly: true }] : [])
      ];
      expect(mocks.finalizeChatRound).toHaveBeenCalledWith(
        expect.objectContaining({
          aiContent: expect.objectContaining({ value: expectedValues })
        })
      );
      const emittedCard = mocks.responseWrite.mock.calls.some(([event]) =>
        JSON.stringify(event).includes(feishuHandoffReply)
      );
      expect(emittedCard).toBe(offer);
    });

    it('keeps non-streaming responses outside stream cleanup', async () => {
      const { response, result } = runRequest(false);
      await result;

      expect(response.json).toHaveBeenCalledOnce();
      expect(mocks.flushResume).not.toHaveBeenCalled();
      expect(response.end).not.toHaveBeenCalled();
    });
  }
});
