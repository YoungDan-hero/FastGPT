import { z } from 'zod';
import { createHash } from 'node:crypto';
import { UserError } from '@fastgpt/global/common/error/utils';
import type {
  APIFileItemType,
  FeishuApp,
  FeishuLink
} from '@fastgpt/global/core/dataset/apiDataset/type';
import {
  classifyApiDatasetError,
  parseFeishuResourceLink,
  toApiDatasetError,
  toApiDatasetSuccess
} from '@fastgpt/global/core/dataset/apiDataset/utils';
import { decryptSecret, encryptSecret } from '../../../../common/secret/aes256gcm';
import { axios } from '../../../../common/api/axios';
import {
  DEFAULT_IMAGE_DOWNLOAD_MAX_SIZE,
  detectImageTypeFromBuffer
} from '../../../../common/file/image/utils';
import { uploadImage2S3Bucket } from '../../../../common/s3/utils';
import { resolveMimeExtension } from '../../../../common/s3/utils/mime';
import { feishuRequest, getFeishuTenantToken } from '../../../../support/user/feishu/client';
import {
  getFeishuDatasetAccessToken,
  type FeishuDatasetActor
} from '../../../../support/user/feishu/datasetAccess';

const ResourceTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const WikiNodeSchema = z.object({
  data: z.object({ node: z.object({ obj_type: z.string(), obj_token: ResourceTokenSchema }) })
});
const DocumentSchema = z.object({ data: z.object({ document: z.object({ title: z.string() }) }) });
const DocumentTextSchema = z.object({ data: z.object({ content: z.string() }) });
const DocumentBlockSchema = z.object({
  image: z.object({ token: ResourceTokenSchema }).nullish()
});
const TableSchema = z.object({ table_id: ResourceTokenSchema, name: z.string() });
const RecordSchema = z.object({ fields: z.record(z.string(), z.json()) });
const ImageAttachmentSchema = z.object({
  file_token: ResourceTokenSchema,
  type: z.string().startsWith('image/'),
  url: z.string().optional()
});

const feishuOpenApi = 'https://open.feishu.cn/open-apis';
const supportedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** 从固定的飞书素材接口下载，媒体内容按哈希保存在当前知识库的私有路径。 */
async function copyFeishuImage({
  fileToken,
  token,
  datasetId,
  extra
}: {
  fileToken: string;
  token: string;
  datasetId: string;
  extra?: string;
}) {
  const url = new URL(`${feishuOpenApi}/drive/v1/medias/${fileToken}/download`);
  if (extra) url.searchParams.set('extra', extra);
  const { data } = await axios
    .get<ArrayBuffer>(url.href, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${token}` },
      maxRedirects: 0,
      timeout: 20_000,
      maxContentLength: DEFAULT_IMAGE_DOWNLOAD_MAX_SIZE
    })
    .catch(() => {
      // Axios 错误对象可能包含飞书 Authorization 请求头。
      throw new UserError(
        'Cannot download Feishu image',
        '无法下载飞书图片，请检查素材下载权限和图片大小（最多 10 MB）。'
      );
    });
  const buffer = Buffer.from(data);
  const mimetype = detectImageTypeFromBuffer(buffer);
  if (!mimetype || !supportedImageMimeTypes.has(mimetype)) {
    throw new UserError('Unsupported Feishu image', '飞书图片须为 PNG、JPG、GIF 或 WebP 格式。');
  }
  const filename =
    createHash('sha256').update(buffer).digest('hex') + resolveMimeExtension(mimetype);
  const key = await uploadImage2S3Bucket('private', {
    buffer,
    filename,
    mimetype,
    uploadKey: `dataset/${datasetId}/feishu/${filename}`
  });
  return `![](${key})`;
}

/** 读取完整分页，防止飞书返回缺失或重复游标时只导入部分数据。 */
async function fetchPages<T extends z.ZodType>({
  path,
  schema,
  token,
  pageSize,
  body
}: {
  path: string;
  schema: T;
  token: string;
  pageSize: number;
  body?: Record<string, unknown>;
}) {
  const responseSchema = z.object({
    data: z.object({
      items: z.array(schema).nullish(),
      has_more: z.boolean(),
      page_token: z.string().nullish()
    })
  });
  const items: z.infer<T>[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) query.set('page_token', pageToken);
    const { data } = await feishuRequest(`${path}?${query}`, responseSchema, { token, body });
    items.push(...(data.items ?? []));
    if (!data.has_more) return items;
    if (!data.page_token || seen.has(data.page_token)) {
      throw new Error('Feishu API returned an invalid page token');
    }
    pageToken = data.page_token;
    seen.add(pageToken);
  } while (pageToken);
  return items;
}

const cellText = (value: z.infer<ReturnType<typeof z.json>>): string => {
  if (value === null) return '';
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join('、');
  if (typeof value !== 'object') return String(value);
  if (typeof value.text === 'string') return value.text;
  if (typeof value.name === 'string') return value.name;
  if ('value' in value) return cellText(value.value);
  return JSON.stringify(value);
};

const getFeishuAppToken = ({ appId, appSecret }: FeishuApp) => {
  const secret = decryptSecret(appSecret);
  if (!appId || !secret) {
    throw new UserError(
      'Missing Feishu app credentials',
      '请填写飞书应用的 App ID 和 App Secret。'
    );
  }
  return getFeishuTenantToken({ appId, secret }).catch(() => {
    throw new UserError(
      'Cannot authenticate the Feishu app',
      '无法获取飞书应用凭据，请核对 App ID 和 App Secret。'
    );
  });
};

/** 将单个飞书来源映射为文档或数据表，并使用知识库配置的飞书应用读取。 */
export async function useFeishuLinkDatasetRequest(source: FeishuLink, actor?: FeishuDatasetActor) {
  const link = parseFeishuResourceLink(source.url);
  if (!link)
    throw new UserError('Invalid Feishu resource link', '请输入有效的飞书云文档或多维表格链接。');
  const token = await (async () => {
    if (source.appId) return getFeishuAppToken(source);
    if (!actor) throw new UserError('Missing Feishu dataset owner');
    return getFeishuDatasetAccessToken(actor);
  })();

  const resource = await (async () => {
    if (link.type !== 'wiki') return { type: link.type, token: link.token };
    const query = new URLSearchParams({ token: link.token });
    const { data } = await feishuRequest(`/wiki/v2/spaces/get_node?${query}`, WikiNodeSchema, {
      token
    });
    const { obj_type, obj_token } = data.node;
    if (obj_type === 'docx') return { type: 'docx', token: obj_token };
    if (obj_type === 'bitable') return { type: 'base', token: obj_token };
    throw new UserError('Unsupported Feishu Wiki node', '该知识库页面需对应飞书云文档或多维表格。');
  })();

  const documentPath = `/docx/v1/documents/${resource.token}`;
  const tablesPath = `/bitable/v1/apps/${resource.token}/tables`;
  let files: Promise<APIFileItemType[]> | undefined;
  const listFiles = async ({ parentId }: { parentId?: string | null; searchKey?: string } = {}) => {
    if (parentId) return [];
    files ??= (async () => {
      const entries = await (async () => {
        if (resource.type === 'docx') {
          const { data } = await feishuRequest(documentPath, DocumentSchema, { token });
          return [{ id: resource.token, name: data.document.title }];
        }
        const tables = await fetchPages({
          path: tablesPath,
          schema: TableSchema,
          token,
          pageSize: 100
        });
        const selected = link.tableId
          ? tables.filter((table) => table.table_id === link.tableId)
          : tables;
        if (link.tableId && selected.length === 0) {
          throw new UserError(
            'Feishu data table unavailable',
            '无法读取链接指定的数据表，请确认链接和飞书权限。'
          );
        }
        return selected.map(({ table_id, name }) => ({ id: table_id, name }));
      })();

      return entries.map(({ id, name }) => ({
        id,
        rawId: id,
        name,
        type: 'file' as const,
        createTime: new Date(),
        updateTime: new Date()
      }));
    })();
    return files;
  };

  const getFileDetail = async ({ apiFileId }: { apiFileId: string }) => {
    try {
      const file = (await listFiles()).find((item) => item.id === apiFileId);
      return file
        ? toApiDatasetSuccess(file)
        : toApiDatasetError({ code: 'INVALID_PARAMS', message: '当前飞书链接不包含该来源。' });
    } catch (error) {
      return classifyApiDatasetError(error);
    }
  };

  const requireFile = async (apiFileId: string) => {
    const file = (await listFiles()).find((item) => item.id === apiFileId);
    if (!file) throw new UserError('Unlinked Feishu file', '当前飞书链接不包含该来源。');
    return file;
  };

  return {
    sourceUrl: link.url,
    listFiles,
    getFileDetail,
    getFileRawId: (id: string) => id,
    async getFilePreviewUrl({ apiFileId }: { apiFileId: string }) {
      await requireFile(apiFileId);
      const preview = new URL(link.url);
      if (resource.type === 'base') preview.searchParams.set('table', apiFileId);
      return preview.href;
    },
    async getFileContent({
      apiFileId,
      datasetId,
      imageIndex
    }: {
      apiFileId: string;
      datasetId?: string;
      imageIndex?: boolean;
      usageId?: string;
    }) {
      const file = await requireFile(apiFileId);
      const images = new Map<string, string>();
      const readImage = async (fileToken: string, extra?: string) => {
        if (!datasetId) throw new Error('Feishu images require a datasetId');
        const imageId = JSON.stringify([fileToken, extra]);
        const cached = images.get(imageId);
        if (cached) return cached;
        const markdown = await copyFeishuImage({ fileToken, extra, token, datasetId });
        images.set(imageId, markdown);
        return markdown;
      };
      if (resource.type === 'docx') {
        const { data } = await feishuRequest(`${documentPath}/raw_content`, DocumentTextSchema, {
          token
        });
        if (!imageIndex) return { title: file.name, rawText: data.content };

        const blocks = await fetchPages({
          path: `${documentPath}/blocks`,
          schema: DocumentBlockSchema,
          token,
          pageSize: 200
        });
        const rawText = [data.content];
        const fileTokens = new Set(blocks.flatMap(({ image }) => (image ? [image.token] : [])));
        for (const fileToken of fileTokens) rawText.push(await readImage(fileToken));
        return { title: file.name, rawText: rawText.filter(Boolean).join('\n\n') };
      }
      const records = await fetchPages({
        path: `${tablesPath}/${file.rawId}/records/search`,
        schema: RecordSchema,
        token,
        pageSize: 200,
        body: link.viewId ? { view_id: link.viewId } : {}
      });
      const rows: string[] = [];
      for (const { fields } of records) {
        const cells: string[] = [];
        for (const [field, value] of Object.entries(fields)) {
          cells.push(`${field}：${cellText(value)}`);
          if (!imageIndex || !Array.isArray(value)) continue;
          for (const item of value) {
            const parsed = ImageAttachmentSchema.safeParse(item);
            if (!parsed.success) continue;
            const attachment = parsed.data;
            // 多维表格高级权限使用 extra 校验附件归属，不向响应提供的 URL 转发令牌。
            const extra = attachment.url
              ? (URL.parse(attachment.url)?.searchParams.get('extra') ?? undefined)
              : undefined;
            cells.push(await readImage(attachment.file_token, extra));
          }
        }
        rows.push(cells.join('\n'));
      }
      return { title: file.name, rawText: rows.join('\n\n') };
    }
  };
}

const prepareFeishuDatasetApp = (input?: FeishuApp, current?: FeishuApp) => {
  const appId = input?.appId?.trim() || current?.appId;
  const secret = input?.appSecret?.trim();
  const appSecret = secret
    ? encryptSecret(secret)
    : appId === current?.appId
      ? current?.appSecret
      : undefined;
  if (!appId || !appSecret) {
    throw new UserError(
      'Missing Feishu app credentials',
      '请填写飞书自建应用的 App ID 和 App Secret。'
    );
  }
  return { appId, appSecret };
};

/** 校验知识库共用的飞书应用，保留同一应用已保存的密钥，并加密新密钥。 */
export async function verifyFeishuDatasetApp(input?: FeishuApp, current?: FeishuApp) {
  const app = prepareFeishuDatasetApp(input, current);
  await getFeishuAppToken(app);
  return app;
}

/** 兼容旧的创建和修改接口，提交前验证已有飞书来源。 */
export async function verifyFeishuDatasetLink(input?: FeishuLink, current?: FeishuLink) {
  const app = prepareFeishuDatasetApp(input, current);
  try {
    const request = await useFeishuLinkDatasetRequest({ url: input?.url ?? '', ...app });
    const files = await request.listFiles();
    if (files.length === 0)
      throw new UserError('Empty Feishu Base', '这个链接下没有可读取的数据表。');
    return { source: { url: request.sourceUrl, ...app }, title: files[0].name, files };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(
      'Cannot read the Feishu link',
      '无法读取该飞书链接，请确认应用已开通读取权限，且该文档或多维表格已授权该应用访问。',
      {
        cause: error
      }
    );
  }
}
