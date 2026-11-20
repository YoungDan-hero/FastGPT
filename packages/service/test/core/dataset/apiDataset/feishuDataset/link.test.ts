import { useFeishuLinkDatasetRequest } from '@fastgpt/service/core/dataset/apiDataset/feishuDataset/link';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), get: vi.fn(), upload: vi.fn() }));
vi.mock('@fastgpt/service/support/user/feishu/client', () => ({
  feishuRequest: mocks.request,
  getFeishuTenantToken: async () => 'test-token'
}));
vi.mock('@fastgpt/service/common/secret/aes256gcm', () => ({
  decryptSecret: () => 'test-secret',
  encryptSecret: vi.fn()
}));
vi.mock('@fastgpt/service/support/user/feishu/datasetAccess', () => ({
  getFeishuDatasetAccessToken: vi.fn()
}));
vi.mock('@fastgpt/service/common/api/axios', async (original) => ({
  ...(await original<typeof import('@fastgpt/service/common/api/axios')>()),
  axios: { get: mocks.get }
}));
vi.mock('@fastgpt/service/common/s3/utils', async (original) => ({
  ...(await original<typeof import('@fastgpt/service/common/s3/utils')>()),
  uploadImage2S3Bucket: mocks.upload
}));

const datasetId = '68ad85a7463006c963799a05';
const imageToken = 'boxImageToken';
const imagePath = `/open-apis/drive/v1/medias/${imageToken}/download`;
const connection = { appId: 'cli_test', appSecret: 'encrypted-test-secret' };
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data: pngHeader });
  mocks.upload.mockImplementation(async (_bucket, params) => params.uploadKey);
});

describe('Feishu link image import', () => {
  it('保留文档正文，读取分页图片并将同一图片只存储一次', async () => {
    mocks.request.mockImplementation(async (path, schema) => {
      const url = new URL(path, 'https://open.feishu.cn');
      if (url.pathname.endsWith('/raw_content')) {
        return schema.parse({ data: { content: '合同审批说明' } });
      }
      if (url.pathname.endsWith('/blocks')) {
        const page = url.searchParams.get('page_token');
        return schema.parse({
          data: {
            items: [{ image: { token: imageToken } }],
            has_more: !page,
            page_token: page ? null : 'next-page'
          }
        });
      }
      return schema.parse({ data: { document: { title: '飞书文档' } } });
    });
    const request = await useFeishuLinkDatasetRequest({
      ...connection,
      url: 'https://example.feishu.cn/docx/docTest'
    });

    const result = await request.getFileContent({
      apiFileId: 'docTest',
      datasetId,
      imageIndex: true
    });

    expect(result.rawText).toMatch(
      new RegExp(`^合同审批说明\\n\\n!\\[\\]\\(dataset/${datasetId}/feishu/[a-f0-9]{64}\\.png\\)$`)
    );
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(
      `https://open.feishu.cn${imagePath}`,
      expect.objectContaining({
        maxRedirects: 0,
        headers: { Authorization: 'Bearer test-token' }
      })
    );
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(
      'private',
      expect.objectContaining({ buffer: pngHeader, mimetype: 'image/png' })
    );
  });

  it('保留表格图片所属记录，只把飞书的权限参数附到固定素材接口', async () => {
    const extra = '{"bitablePerm":{"tableId":"tblTest","rev":2}}';
    mocks.request.mockImplementation(async (path, schema) =>
      schema.parse({
        data: {
          has_more: false,
          items: path.includes('/records/search')
            ? [
                {
                  fields: {
                    说明: '待审核',
                    附件: [
                      {
                        name: '流程图.png',
                        type: 'image/png',
                        file_token: imageToken,
                        url: `https://untrusted.example/image?extra=${encodeURIComponent(extra)}`
                      },
                      { name: '说明.pdf', type: 'application/pdf', file_token: 'boxPdf' }
                    ]
                  }
                }
              ]
            : [{ table_id: 'tblTest', name: '审批记录' }]
        }
      })
    );
    const request = await useFeishuLinkDatasetRequest({
      ...connection,
      url: 'https://example.feishu.cn/base/baseTest?table=tblTest'
    });

    const result = await request.getFileContent({
      apiFileId: 'tblTest',
      datasetId,
      imageIndex: true
    });

    expect(result.rawText).toContain(
      `说明：待审核\n附件：流程图.png、说明.pdf\n![](dataset/${datasetId}/feishu/`
    );
    expect(mocks.get).toHaveBeenCalledTimes(1);
    const requested = new URL(mocks.get.mock.calls[0][0]);
    expect(requested.origin).toBe('https://open.feishu.cn');
    expect(requested.pathname).toBe(imagePath);
    expect(requested.searchParams.get('extra')).toBe(extra);
  });
});
