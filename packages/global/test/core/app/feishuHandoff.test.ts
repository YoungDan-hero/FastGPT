import { describe, expect, it } from 'vitest';
import {
  defaultFeishuHandoffAutoClose,
  FeishuHandoffConfigSchema,
  feishuHandoffReply,
  getFeishuHandoffMessageText,
  getFeishuHandoffRequest,
  isFeishuHandoffNoAnswer
} from '../../../core/app/feishuHandoff';
import { FeishuHandoffConfigBodySchema } from '../../../openapi/core/app/feishuHandoff/api';

describe('客服群结束与问答沉淀配置', () => {
  const defaultGroupId = '68ee0bd23d17260b7829b137';

  it('现有接待组配置无需补齐自动解散参数', () => {
    expect(FeishuHandoffConfigSchema.parse({ enabled: true, defaultGroupId })).toEqual({
      enabled: true,
      defaultGroupId
    });
  });

  it('开启沉淀时要求同时启用自动解散并指定目标库', () => {
    const autoClose = { ...defaultFeishuHandoffAutoClose, enabled: true };
    const config = { enabled: true, defaultGroupId, autoClose };
    const knowledgeMining = { enabled: true, retainDays: 30 };
    expect(FeishuHandoffConfigSchema.safeParse({ ...config, knowledgeMining }).success).toBe(false);
    expect(
      FeishuHandoffConfigSchema.safeParse({
        ...config,
        knowledgeMining: { ...knowledgeMining, datasetId: defaultGroupId }
      }).success
    ).toBe(true);
  });

  it('读取旧配置时兼容只有知识库，保存启用的沉淀时要求指定手动录入集合', () => {
    const knowledgeMining = { enabled: true, datasetId: defaultGroupId, retainDays: 30 };
    const config = {
      enabled: true,
      defaultGroupId,
      autoClose: { ...defaultFeishuHandoffAutoClose, enabled: true },
      knowledgeMining
    };
    expect(FeishuHandoffConfigSchema.safeParse(config).success).toBe(true);
    expect(FeishuHandoffConfigBodySchema.safeParse({ appId: defaultGroupId, config }).success).toBe(
      false
    );
    expect(
      FeishuHandoffConfigBodySchema.safeParse({
        appId: defaultGroupId,
        config: {
          ...config,
          knowledgeMining: { ...knowledgeMining, targetCollectionId: defaultGroupId }
        }
      }).success
    ).toBe(true);
  });
});

describe('人工客服触发', () => {
  it.each([
    '转人工',
    '你好，麻烦帮我转一下人工客服吧！',
    '我想和真人聊聊',
    'Can you connect me to a human?'
  ])('识别独立请求 %s', (text) => expect(getFeishuHandoffRequest(text)).toBe('standalone'));

  it('区分附带问题的请求和关于转人工的普通问答', () => {
    expect(getFeishuHandoffRequest('退款三天了还没到账，麻烦找客服。')).toBe('withContext');
    for (const text of [
      '不要转人工',
      '人工智能是什么',
      '怎么配置转人工',
      '举个例子，「转人工」',
      '如果答不出来，可以转人工吗'
    ]) {
      expect(getFeishuHandoffRequest(text)).toBeUndefined();
    }
  });

  it('仅将明确缺少资料或无法回答的正文作为兜底信号', () => {
    expect(
      isFeishuHandoffNoAnswer('知识库里暂未找到足以回答这个问题的资料。请补充具体产品。')
    ).toBe(true);
    expect(isFeishuHandoffNoAnswer('很抱歉，根据现有资料，无法确认这一条规则。')).toBe(true);
    expect(isFeishuHandoffNoAnswer('没有找到退款记录，说明申请尚未提交。')).toBe(false);
    expect(isFeishuHandoffNoAnswer('签收后 7 个自然日内可申请退款。必要时可联系客服。')).toBe(
      false
    );
  });

  it('转发的问答摘录排除卡片入口', () => {
    expect(
      getFeishuHandoffMessageText([
        { text: { content: '请补充型号。' } },
        { text: { content: feishuHandoffReply } }
      ])
    ).toBe('请补充型号。');
  });
});
