import { z } from 'zod';
import { ObjectIdSchema } from '../../common/type/mongo';
import { removeDatasetCiteText } from '../ai/llm/utils';
import type { ChatItemValueItemType } from '../chat/type';
import { AppTypeEnum } from './constants';

export const feishuHandoffAppTypes = [
  AppTypeEnum.simple,
  AppTypeEnum.chatAgent,
  AppTypeEnum.workflow
] as const;

export const FeishuHandoffConfigSchema = z
  .object({
    enabled: z.boolean(),
    defaultGroupId: ObjectIdSchema.optional()
  })
  .refine(({ enabled, defaultGroupId }) => !enabled || Boolean(defaultGroupId), {
    path: ['defaultGroupId'],
    message: '启用转人工前请选择接待客服组'
  });
export type FeishuHandoffConfig = z.infer<typeof FeishuHandoffConfigSchema>;

/** 旧聊天客户端通过该对象判断是否启用转接，分流选项固定为空。 */
export const FeishuHandoffChatOptionsSchema = z.object({
  categories: z.array(z.string())
});
export type FeishuHandoffChatOptions = z.infer<typeof FeishuHandoffChatOptionsSchema>;

export const feishuHandoffLink = '#feishu-handoff';
export const feishuHandoffReply = `[转人工客服](${feishuHandoffLink})`;

const handoffLinkPattern = /\[[^\]\n]+\]\(#feishu-handoff\)/g;
const chineseHandoffTarget = '(?:人工(?:客服|服务|坐席)?|真人(?:客服)?|客服)';
const chineseHandoffRequest = new RegExp(
  '^(?:我想要?|我要|我需要|请你?|麻烦你?|你们|能不能|可不可以|能否|可以|你能|能|帮我|给我|为我|直接){0,6}' +
    `(?:(?:(?:转接?|接通|接入|切换到)(?:一下|下)?(?:给|到)?|(?:联系|找)(?:一下|一位|一个|个)?)?${chineseHandoffTarget}|` +
    `(?:和|跟|让)${chineseHandoffTarget}(?:聊聊|聊一下|聊一聊|说话|沟通|对话|帮忙|接手))` +
    '(?:一下|可以吗|吗|吧|呢|谢谢)*$'
);
const englishHandoffRequest =
  /^(?:please\s+)?(?:(?:can|could|would) you |(?:i want|i need|i would like|i'd like) to )?(?:(?:transfer|connect) me to |(?:talk|speak) (?:to|with) )?(?:a |an )?(?:human(?: (?:agent|support))?|real person|live agent|customer service agent)(?: please)?$/i;

/** 明确请求接人工时，区分单独的指令和附带问题描述的请求。 */
export function getFeishuHandoffRequest(text: string) {
  const clauses = text
    .normalize('NFKC')
    .split(/[,.。!?;；\n]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause && !/^(?:你好|您好|谢谢|麻烦你了|please|thanks)$/i.test(clause));
  const request = clauses.at(-1);
  if (!request || request.length > 100) return;
  if (
    clauses.some((clause) => /^(?:如果|假如|假设|比如|例如|if\b|for example\b)/i.test(clause)) ||
    !(
      chineseHandoffRequest.test(request.replace(/\s+/g, '')) || englishHandoffRequest.test(request)
    )
  ) {
    return;
  }
  return clauses.length === 1 ? 'standalone' : 'withContext';
}

/** 工作流正文明确表示缺少依据或答不出时提供客服入口。 */
export function isFeishuHandoffNoAnswer(text: string) {
  const firstSentence = text
    .trim()
    .replace(/^[*_>\s]+/, '')
    .replace(/^(?:很?抱歉|不好意思|sorry)[*，,。!！\s]*/i, '')
    .split(/[。！？!?\n]/, 1)[0];
  const answer = firstSentence.replace(
    /^(?:我|本轮|目前|暂时|现有|当前|(?:从|在)?知识库(?:里|中|内)?|(?:根据|基于|结合)(?:当前|现有|目前)?的?(?:资料|信息|知识库)[，,]?){0,6}/,
    ''
  );
  const missingMaterial =
    /^(?:(?:没有|没|未|暂未)(?:检索|查找|查|找)到|找不到|没有|暂无|缺少).{0,60}(?:相关|可靠|可用|可用于|足够|足以|能够).{0,45}(?:资料|信息|证据|文档|内容|正文|依据)/;
  return (
    missingMaterial.test(answer) ||
    /^(?:(?:资料|信息|依据|证据)(?:不足|不够)|(?:无法|不能)(?:准确|可靠|明确|直接)?(?:回答|确认|确定)|答不上来)/.test(
      answer
    ) ||
    /^(?:i (?:cannot|can't|am unable to) (?:answer|confirm)|i (?:could not|couldn't|did not|didn't) find (?:any|enough) (?:relevant|reliable) (?:information|material)|there (?:is not|isn't) enough (?:information|evidence))/i.test(
      firstSentence
    )
  );
}

/** 预览与飞书卡片共用文字摘录，省略内部引用标记。 */
export function getFeishuHandoffMessageText(value: readonly ChatItemValueItemType[]) {
  const text = value
    .map((part) =>
      removeDatasetCiteText(part.text?.content ?? '', false).replace(handoffLinkPattern, '')
    )
    .filter(Boolean)
    .join('\n')
    .trim();
  const limit = 1800;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
