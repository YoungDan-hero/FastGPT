import { describe, expect, it } from 'vitest';
import {
  feishuHandoffReply,
  getFeishuHandoffMessageText,
  getFeishuHandoffRequest,
  isFeishuHandoffNoAnswer
} from '../../../core/app/feishuHandoff';

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
