export function wantsKnowledgeWrite(input: string) {
  const text = input.normalize('NFKC').replace(/\s+/g, '');
  if (/^(?:不要|不用|先别|别|先不|暂不|取消|停止|是否|如何|怎么|什么|如果)/u.test(text))
    return false;
  const politeRequest = /^(?:请问)?(?:能|可以)帮我/u.test(text);
  if (/[？?]$/u.test(text) && !politeRequest) return false;
  if (
    /(?:不要|不用|别|先不|暂不|无需|禁止|不必|取消|停止|不允许)[^，,。！？!?；;]{0,20}(?:沉淀|写入|存(?:入|到|进)|保存|录入)|(?:怎么|如何|是否)(?:开始|触发|进行|沉淀|写入|保存)/u.test(
      text
    )
  )
    return false;
  const task = text
    .replace(/[。！？!?]+$/u, '')
    .replace(/吗$/u, '')
    .replace(/^(?:请问|能帮我|可以帮我|请你|请|麻烦|帮我|我想|我希望|现在|直接|确认)+/u, '');
  const session =
    '(?:本次|当前|这次|这段|这轮|本轮|整个|刚才的?)(?:会话|对话|聊天|问答|网页|文章|内容)';
  if (/^(?:开始沉淀|启动沉淀|执行沉淀|沉淀)$/u.test(task)) return true;
  if (
    new RegExp(
      '^(?:开始)?(?:总结并)?沉淀' +
        session +
        '(?:中的?|里(?:的)?)?(?:有意义的|有价值的|有用的)?(?:(?:业务)?知识(?:要点|点)?|内容|问答|要点)?$',
      'u'
    ).test(task)
  )
    return true;
  if (new RegExp('^(?:把|将)' + session + '[^“”「」"?？]{0,80}沉淀(?:一下)?$', 'u').test(task))
    return true;
  return /^(?:把|将|总结|整理|归纳)(?:我们)?(?:本次|当前|这次|这段|这轮|本轮|整个|刚刚|刚才|上面|以上|前面|刚读的|刚发的|这篇)[^“”「」"\n?？]{1,180}(?:沉淀|存(?:入|到|进)|写入|加入|录入|保存(?:到|至|进))(?:到|入|至)?(?:我的|真实|当前|指定的)?知识库(?:中|里)?$/u.test(
    task
  );
}
