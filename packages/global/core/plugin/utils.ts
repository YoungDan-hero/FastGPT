import { parseI18nString } from '../../common/i18n/utils';
import type { PluginInstallFailureType } from '../../sdk/fastgpt-plugin';

/**
 * 将插件安装失败明细中的多语言原因去重拼接为可读文案；无有效失败原因时返回 `undefined`。
 */
export const formatPluginInstallFailureReasons = ({
  failed,
  lang
}: {
  failed?: PluginInstallFailureType[];
  lang?: string;
}): string | undefined => {
  if (!failed || failed.length === 0) return undefined;

  const reasons = Array.from(
    new Set(failed.map((item) => parseI18nString(item.reason, lang).trim()).filter(Boolean))
  );

  return reasons.length > 0 ? reasons.join('; ') : undefined;
};
