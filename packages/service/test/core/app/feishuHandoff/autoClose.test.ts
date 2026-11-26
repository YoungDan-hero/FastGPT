import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultFeishuHandoffAutoClose } from '@fastgpt/global/core/app/feishuHandoff';

const mocks = vi.hoisted(() => ({
  findDue: vi.fn(),
  findHandoff: vi.fn(),
  updateHandoff: vi.fn(),
  findApp: vi.fn(),
  readMessages: vi.fn(),
  sendCard: vi.fn(),
  disband: vi.fn(),
  capture: vi.fn(),
  updateTranscript: vi.fn()
}));

vi.mock('@fastgpt/dal/redis/caches/lease', () => ({
  LeaseCache: class {
    withLease({ fn }: { fn: (context: { assertValid: () => void }) => unknown }) {
      return fn({ assertValid: vi.fn() });
    }
  },
  isRedisLeaseError: () => false
}));
vi.mock('@fastgpt/service/support/user/feishu/client', () => ({
  getFeishuTenantToken: () => Promise.resolve('test-token')
}));
vi.mock('@fastgpt/service/common/mongo/sessionRun', () => ({
  mongoSessionRun: (fn: (session: object) => unknown) => fn({})
}));
vi.mock('@fastgpt/service/core/app/feishuHandoff/bot', () => ({
  getFeishuHandoffBotCredentials: () => ({ appId: 'test-bot' }),
  listFeishuHandoffMessages: mocks.readMessages,
  sendFeishuHandoffCard: mocks.sendCard,
  disbandFeishuHandoffChat: mocks.disband,
  isDisbandedFeishuHandoffChat: () => false
}));
vi.mock('@fastgpt/service/core/app/feishuHandoff/knowledge', () => ({
  captureFeishuHandoffTranscript: mocks.capture
}));
vi.mock('@fastgpt/service/core/app/feishuHandoff/schema', () => ({
  MongoFeishuHandoff: {
    find: mocks.findDue,
    findOne: mocks.findHandoff,
    updateOne: mocks.updateHandoff
  },
  MongoFeishuHandoffTranscript: { updateOne: mocks.updateTranscript }
}));
vi.mock('@fastgpt/service/core/app/schema', () => ({
  MongoApp: { findOne: mocks.findApp }
}));

import { runFeishuHandoffAutoClose } from '@fastgpt/service/core/app/feishuHandoff/autoClose';

const now = new Date('2026-11-23T04:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const appId = '68ee0bd23d17260b7829b137';
const filter = { _id: 'test-handoff', feishuChatId: 'oc_isolated_test' };
const record = { ...filter, appId, groupCreatedAt: minutesAgo(20), nextCloseCheckAt: now };

describe('客服群自动解散', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ now });
    const dueQuery = {
      select: () => dueQuery,
      sort: () => dueQuery,
      limit: () => dueQuery,
      lean: async () => [{ _id: record._id, leaseKey: 'test-chat' }]
    };
    mocks.findDue.mockReturnValue(dueQuery);
    mocks.findHandoff.mockReturnValue({ lean: async () => record });
    mocks.findApp.mockReturnValue({
      select: () => ({
        lean: async () => ({
          teamId: appId,
          feishuHandoff: {
            enabled: true,
            defaultGroupId: appId,
            autoClose: { ...defaultFeishuHandoffAutoClose, enabled: true },
            knowledgeMining: {
              enabled: true,
              datasetId: appId,
              targetCollectionId: appId,
              retainDays: 30,
              tmbId: appId
            }
          }
        })
      })
    });
    mocks.readMessages.mockResolvedValue({ messages: [], truncated: false });
  });

  afterEach(() => vi.useRealTimers());

  it('首次达到静默阈值只发送提醒卡片，即使期间存在机器人或系统消息', async () => {
    mocks.readMessages.mockResolvedValue({
      messages: [
        { sender: { sender_type: 'app' }, create_time: now.getTime() },
        { sender: { sender_type: 'system' }, create_time: now.getTime() }
      ],
      truncated: false
    });
    await runFeishuHandoffAutoClose();
    expect(mocks.sendCard).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: record.feishuChatId,
        content: expect.stringContaining('5 分钟')
      })
    );
    expect(mocks.updateHandoff).toHaveBeenCalledWith(
      filter,
      expect.objectContaining({ promptedAt: now })
    );
    expect(mocks.disband).not.toHaveBeenCalled();
  });

  it('提醒后有真人回复时，重新按最新发言计算静默时间', async () => {
    mocks.findHandoff.mockReturnValue({
      lean: async () => ({ ...record, promptedAt: minutesAgo(6) })
    });
    mocks.readMessages.mockResolvedValue({
      messages: [{ sender: { sender_type: 'user' }, create_time: minutesAgo(2).getTime() }],
      truncated: false
    });
    await runFeishuHandoffAutoClose();
    expect(mocks.updateHandoff).toHaveBeenCalledWith(filter, {
      $set: { nextCloseCheckAt: new Date(now.getTime() + 8 * 60_000) },
      $unset: { promptedAt: 1, disbandRequested: 1 }
    });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.disband).not.toHaveBeenCalled();
  });

  it('先保存对话，再解散，随后才放行知识提炼', async () => {
    mocks.findHandoff.mockReturnValue({
      lean: async () => ({ ...record, promptedAt: minutesAgo(6) })
    });
    await runFeishuHandoffAutoClose();
    expect(mocks.capture).toHaveBeenCalledBefore(mocks.disband);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ datasetId: appId, targetCollectionId: appId })
      })
    );
    expect(mocks.disband).toHaveBeenCalledWith('test-token', record.feishuChatId);
    expect(mocks.disband).toHaveBeenCalledBefore(mocks.updateTranscript);
  });

  it('群聊保存失败时保留群和后续重试时间', async () => {
    mocks.findHandoff.mockReturnValue({
      lean: async () => ({ ...record, promptedAt: minutesAgo(6) })
    });
    mocks.capture.mockRejectedValue(new Error('测试读取失败'));
    await runFeishuHandoffAutoClose();
    expect(mocks.updateHandoff).toHaveBeenCalledWith(filter, {
      $set: { nextCloseCheckAt: new Date(now.getTime() + 5 * 60_000) }
    });
    expect(mocks.disband).not.toHaveBeenCalled();
    expect(mocks.updateTranscript).not.toHaveBeenCalled();
  });
});
