import { getSystemInstanceConfig } from '@fastgpt/service/common/system/systemInstanceConfig/runtime';
import { getTestInstanceConfig } from '@test/utils/instanceConfigSnapshot';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { SystemErrEnum } from '@fastgpt/global/common/error/code/system';
import { TeamErrEnum } from '@fastgpt/global/common/error/code/team';

import { getModelTestDefaults, setModelTestSnapshot } from '@test/modelCache';
import createHandler from '@/pages/api/core/dataset/create';
import updateHandler from '@/pages/api/core/dataset/update';
import folderCreateHandler from '@/pages/api/core/dataset/folder/create';
import listApiFilesHandler from '@/pages/api/core/dataset/apiDataset/list';
import importApiFilesHandler from '@/pages/api/core/dataset/collection/create/apiCollectionV2';
import readCollectionHandler from '@/pages/api/core/dataset/collection/read';
import syncCollectionHandler from '@/pages/api/core/dataset/collection/sync';
import previewChunksHandler from '@/pages/api/core/dataset/file/getPreviewChunks';
import {
  CreateDatasetBodySchema,
  type CreateDatasetBody,
  type CreateDatasetResponse
} from '@fastgpt/global/openapi/core/dataset/api';
import {
  DatasetCollectionTypeEnum,
  DatasetSourceReadTypeEnum,
  DatasetTypeEnum,
  TrainingModeEnum
} from '@fastgpt/global/core/dataset/constants';
import { TeamDatasetCreatePermissionVal } from '@fastgpt/global/support/permission/user/constant';
import {
  AuthUserTypeEnum,
  OwnerRoleVal,
  PerResourceTypeEnum,
  ReadRoleVal
} from '@fastgpt/global/support/permission/constant';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import { publishSystemInstanceConfigSnapshot } from '@fastgpt/service/common/system/systemInstanceConfig/runtime';
import { getFakeUsers, getRootUser, getUser } from '@test/datas/users';
import type { parseHeaderCertRet } from '@test/mocks/request';
import { Call } from '@test/utils/request';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { MongoDatasetCollection } from '@fastgpt/service/core/dataset/collection/schema';
import { MongoDataset } from '@fastgpt/service/core/dataset/schema';
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { readApiServerFileContent } from '@fastgpt/service/core/dataset/read';
import { decryptSecret } from '@fastgpt/service/common/secret/aes256gcm';

const feishu = vi.hoisted(() => ({
  request: vi.fn(),
  tenantToken: vi.fn(),
  accessToken: vi.fn()
}));

vi.mock('@fastgpt/service/support/user/feishu/client', async (original) => ({
  ...(await original<typeof import('@fastgpt/service/support/user/feishu/client')>()),
  feishuRequest: feishu.request,
  getFeishuTenantToken: feishu.tenantToken
}));
vi.mock('@fastgpt/service/support/user/feishu/datasetAccess', async (original) => ({
  ...(await original<typeof import('@fastgpt/service/support/user/feishu/datasetAccess')>()),
  getFeishuDatasetAccessToken: feishu.accessToken
}));

describe('Feishu dataset creation and import', () => {
  const docId = 'doccnExample';
  const docUrl = `https://example.feishu.cn/docx/${docId}`;
  const appId = 'cli_example';
  const appSecret = 'owner-app-secret';
  const body = (url: string) => ({
    type: DatasetTypeEnum.feishu,
    name: '',
    intro: '',
    apiDatasetServer: { feishuLink: { url, appId, appSecret } }
  });

  beforeEach(() => {
    feishu.request.mockReset();
    feishu.tenantToken.mockReset().mockResolvedValue('tenant-access');
    feishu.accessToken.mockReset();
  });

  it('creates the linked source, automatically queues parsing and keeps repeated imports idempotent', async () => {
    const auth = await getRootUser();
    feishu.request.mockImplementation(async (path, schema, { token }) => {
      expect(token).toBe('tenant-access');
      switch (path) {
        case `/docx/v1/documents/${docId}`:
          return schema.parse({ data: { document: { title: 'Sales playbook' } } });
        case `/docx/v1/documents/${docId}/raw_content`:
          return schema.parse({ data: { content: '签收后 7 个自然日内可以申请退款。' } });
        default:
          throw new Error(`Unexpected Feishu API ${path}`);
      }
    });
    const created = await Call(createHandler, {
      auth,
      body: {
        ...body(`${docUrl}?from=share`),
        chunkSettings: { autoIndexes: true, imageIndex: false }
      }
    });
    expect(created.code).toBe(200);
    const dataset = await MongoDataset.findById(created.data).lean();
    expect(dataset).toMatchObject({
      type: DatasetTypeEnum.feishu,
      name: 'Sales playbook',
      apiDatasetServer: { feishuLink: { url: docUrl, appId } }
    });
    const savedSecret = dataset?.apiDatasetServer?.feishuLink?.appSecret;
    expect(savedSecret).not.toBe(appSecret);
    expect(decryptSecret(savedSecret)).toBe(appSecret);
    const listed = await Call(listApiFilesHandler, { auth, body: { datasetId: created.data } });
    expect(listed.code).toBe(200);
    expect(listed.data).toEqual([expect.objectContaining({ id: docId, name: 'Sales playbook' })]);

    const imported = await Call(importApiFilesHandler, {
      auth,
      body: { datasetId: created.data, apiFiles: listed.data }
    });
    expect(imported.data).toEqual({ successCount: 0, failedCount: 0 });

    const collection = await MongoDatasetCollection.findOne({
      datasetId: created.data,
      apiFileId: docId,
      type: DatasetCollectionTypeEnum.apiFile
    }).lean();
    expect(collection).toMatchObject({ autoIndexes: true, imageIndex: false });
    expect(
      await MongoDatasetTraining.exists({
        datasetId: created.data,
        collectionId: collection?._id,
        mode: TrainingModeEnum.parse
      })
    ).not.toBeNull();
    await expect(
      readApiServerFileContent({
        apiDatasetServer: dataset?.apiDatasetServer,
        apiFileId: docId,
        teamId: auth.teamId,
        tmbId: auth.tmbId,
        datasetId: String(created.data)
      })
    ).resolves.toEqual({ title: 'Sales playbook', rawText: '签收后 7 个自然日内可以申请退款。' });
    expect(feishu.tenantToken).toHaveBeenCalledWith({ appId, secret: appSecret });
    expect(feishu.accessToken).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'app-only'])(
    'imports two independent Feishu links in a %s knowledge base',
    async (kind) => {
      const auth = await getRootUser();
      const secondId = 'doccnSecond';
      const secondUrl = `https://example.feishu.cn/docx/${secondId}`;
      feishu.request.mockImplementation(async (path, schema) => {
        const id = path.split('/')[4];
        if (id !== docId && id !== secondId) throw new Error(`Unexpected Feishu API ${path}`);
        return path.endsWith('/raw_content')
          ? schema.parse({ data: { content: `正文 ${id}` } })
          : schema.parse({ data: { document: { title: id } } });
      });

      const created = await Call(createHandler, {
        auth,
        body:
          kind === 'legacy'
            ? body(docUrl)
            : {
                ...body(docUrl),
                name: 'Shared Feishu app',
                apiDatasetServer: { feishuApp: { appId, appSecret } }
              }
      });
      expect(created.code).toBe(200);
      const datasetId = String(created.data);
      const previewNewSource = (actor: typeof auth) =>
        Call(previewChunksHandler, {
          auth: actor,
          body: {
            datasetId,
            feishuSourceUrl: secondUrl,
            sourceId: secondId,
            type: DatasetSourceReadTypeEnum.apiFile,
            overlapRatio: 0.2
          }
        });
      expect((await previewNewSource(auth)).data.chunks[0]?.q).toBe(`正文 ${secondId}`);
      const requestsBeforeDeniedPreview = feishu.request.mock.calls.length;
      expect(
        (await previewNewSource({ ...auth, authType: AuthUserTypeEnum.apikey })).code
      ).not.toBe(200);
      expect(feishu.request).toHaveBeenCalledTimes(requestsBeforeDeniedPreview);

      const append = async (url: string) => {
        const listed = await Call(listApiFilesHandler, {
          auth,
          body: { datasetId, feishuSourceUrl: url }
        });
        expect(listed.code).toBe(200);
        const result = await Call(importApiFilesHandler, {
          auth,
          body: { datasetId, feishuSourceUrl: url, apiFiles: listed.data }
        });
        expect(result.code).toBe(200);
        return result.data.successCount;
      };

      if (kind === 'legacy') {
        // 等同上线前的旧文件，只能从库级历史链接恢复来源。
        await MongoDatasetCollection.updateOne(
          { datasetId, apiFileId: docId },
          { $unset: { feishuSourceUrl: 1 } }
        );
        const overwrite = await Call(updateHandler, {
          auth,
          body: { id: datasetId, apiDatasetServer: { feishuLink: { url: secondUrl, appId } } }
        });
        expect(overwrite.code).not.toBe(200);
        expect(
          (
            await Call(updateHandler, {
              auth,
              body: { id: datasetId, apiDatasetServer: { feishuApp: { appId } } }
            })
          ).code
        ).toBe(200);
      } else {
        expect(await append(docUrl)).toBe(1);
        const setup = (await MongoDataset.findById(datasetId).lean())?.apiDatasetServer;
        expect(setup?.feishuLink).toBeUndefined();
        expect(decryptSecret(setup?.feishuApp?.appSecret)).toBe(appSecret);
      }

      const counts = await Promise.all([append(secondUrl), append(`${secondUrl}?from=share`)]);
      expect(counts.sort()).toEqual([0, 1]);
      const collections = await MongoDatasetCollection.find({ datasetId }).lean();
      expect(collections).toHaveLength(2);

      for (const [id, url] of [
        [docId, docUrl],
        [secondId, secondUrl]
      ]) {
        const collection = collections.find((item) => item.apiFileId === id)!;
        expect(collection.feishuSourceUrl).toBe(
          kind === 'legacy' && id === docId ? undefined : url
        );
        const source = await Call(readCollectionHandler, {
          auth,
          body: { collectionId: collection._id }
        });
        expect(source.data).toEqual({ type: 'url', value: url });

        const preview = await Call(previewChunksHandler, {
          auth,
          body: {
            datasetId,
            collectionId: collection._id,
            sourceId: id,
            type: DatasetSourceReadTypeEnum.apiFile,
            overlapRatio: 0.2
          }
        });
        expect(preview.data.chunks[0]?.q).toBe(`正文 ${id}`);
      }

      const second = collections.find((item) => item.apiFileId === secondId)!;
      await MongoDatasetCollection.updateOne({ _id: second._id }, { hashRawText: 'before' });
      const synced = await Call(syncCollectionHandler, {
        auth,
        body: { collectionId: second._id }
      });
      expect(
        synced.code,
        synced.error instanceof Error ? synced.error.stack : String(synced.error)
      ).toBe(200);
      expect(
        await MongoDatasetCollection.findOne({ datasetId, apiFileId: secondId }).lean()
      ).toMatchObject({ feishuSourceUrl: secondUrl, rawTextLength: `正文 ${secondId}`.length });
      expect(
        (await MongoDataset.findById(datasetId).lean())?.apiDatasetServer?.feishuLink?.url
      ).toBe(kind === 'legacy' ? docUrl : undefined);
    }
  );

  it.each(['/base/baseExample', '/wiki/wikiBase'])(
    'parses all record pages for the table and view in %s',
    async (sourcePath) => {
      const auth = await getRootUser();
      feishu.request.mockImplementation(async (path: string, schema, { body, token }) => {
        expect(token).toBe('tenant-access');
        const url = new URL(path, 'https://open.feishu.cn');
        const next = url.searchParams.get('page_token');
        switch (url.pathname) {
          case '/wiki/v2/spaces/get_node':
            return schema.parse({
              data: { node: { obj_type: 'bitable', obj_token: 'baseExample' } }
            });
          case '/bitable/v1/apps/baseExample/tables':
            return schema.parse({
              data: {
                items: [
                  { table_id: 'tbl1', name: '条款' },
                  { table_id: 'tbl2', name: '其他表' }
                ],
                has_more: false
              }
            });
          case '/bitable/v1/apps/baseExample/tables/tbl1/records/search':
            expect(body).toEqual({ view_id: 'vew1' });
            return schema.parse({
              data: {
                items: [{ fields: { 条款: [{ text: next ? '次页' : '首页' }], 生效: false } }],
                has_more: !next,
                page_token: next ? undefined : 'second-page'
              }
            });
          default:
            throw new Error(`Unexpected Feishu API ${path}`);
        }
      });
      const url = `https://example.feishu.cn${sourcePath}?table=tbl1&view=vew1`;
      const created = await Call(createHandler, { auth, body: body(url) });
      expect(created.code).toBe(200);
      const datasetId = String(created.data);
      const dataset = await MongoDataset.findById(datasetId).lean();
      const listed = await Call(listApiFilesHandler, { auth, body: { datasetId } });
      expect(listed.data).toEqual([expect.objectContaining({ id: 'tbl1', name: '条款' })]);
      await expect(
        readApiServerFileContent({
          apiDatasetServer: dataset?.apiDatasetServer,
          apiFileId: 'tbl1',
          teamId: auth.teamId,
          tmbId: auth.tmbId,
          datasetId
        })
      ).resolves.toEqual({
        title: '条款',
        rawText: '条款：首页\n生效：false\n\n条款：次页\n生效：false'
      });
      await expect(
        readApiServerFileContent({
          apiDatasetServer: dataset?.apiDatasetServer,
          apiFileId: 'tbl2',
          teamId: auth.teamId,
          tmbId: auth.tmbId,
          datasetId
        })
      ).rejects.toThrow('Unlinked Feishu file');
    }
  );

  it('leaves no dataset behind if the supplied app cannot read the link', async () => {
    const auth = await getRootUser();
    feishu.request.mockRejectedValueOnce(new Error('Document access denied'));
    const res = await Call(createHandler, { auth, body: body(docUrl) });

    expect(res.code).not.toBe(200);
    expect(await MongoDataset.countDocuments({ teamId: auth.teamId })).toBe(0);
  });

  it('preserves the saved secret on edit and requires a fresh secret for another application', async () => {
    const auth = await getRootUser();
    feishu.request.mockImplementation(async (_path, schema) =>
      schema.parse({ data: { document: { title: 'Sales playbook' } } })
    );
    const created = await Call(createHandler, { auth, body: body(docUrl) });
    expect(created.code).toBe(200);
    const current = (await MongoDataset.findById(created.data).lean())?.apiDatasetServer
      ?.feishuLink;
    const update = (id: string, secret?: string) =>
      Call(updateHandler, {
        auth,
        body: {
          id: created.data,
          apiDatasetServer: { feishuLink: { url: docUrl, appId: id, appSecret: secret } }
        }
      });

    expect((await update(appId)).code).toBe(200);
    expect((await update('cli_other')).code).not.toBe(200);
    expect(
      (await MongoDataset.findById(created.data).lean())?.apiDatasetServer?.feishuLink
    ).toEqual(current);
    expect((await update('cli_other', 'new-secret')).code).toBe(200);
    const changed = (await MongoDataset.findById(created.data).lean())?.apiDatasetServer
      ?.feishuLink;
    expect(changed?.appId).toBe('cli_other');
    expect(decryptSecret(changed?.appSecret)).toBe('new-secret');
    expect(feishu.tenantToken).toHaveBeenLastCalledWith({
      appId: 'cli_other',
      secret: 'new-secret'
    });
  });

  it('requires a signed-in employee to authorize the source link', async () => {
    const auth = await getRootUser();
    const res = await Call(createHandler, {
      auth: { ...auth, authType: AuthUserTypeEnum.apikey },
      body: body(docUrl)
    });
    expect(res.code).not.toBe(200);
    expect(feishu.tenantToken).not.toHaveBeenCalled();
  });
});

describe('create dataset', () => {
  it.each([undefined, null, '', '   '])(
    'only inherits the default VLM when its reference is omitted (%s)',
    async (vlmModelId) => {
      const users = await getFakeUsers(1);
      const owner = users.members[0];
      await MongoResourcePermission.create({
        resourceType: 'team',
        teamId: owner.teamId,
        resourceId: null,
        tmbId: owner.tmbId,
        permission: TeamDatasetCreatePermissionVal
      });
      const previousDefaults = getModelTestDefaults();
      setModelTestSnapshot({
        defaultModels: {
          ...previousDefaults,
          datasetImageLLM: {
            ...previousDefaults.llm!,
            config: { ...previousDefaults.llm!.config, vision: true }
          }
        }
      });
      try {
        const res = await Call<CreateDatasetBody, Record<string, never>, CreateDatasetResponse>(
          createHandler,
          {
            auth: owner,
            body: {
              name: 'optional-vision',
              intro: '',
              avatar: '',
              type: DatasetTypeEnum.dataset,
              vlmModelId
            }
          }
        );
        expect(res.code).toBe(200);
        const dataset = await MongoDataset.findById(res.data).lean();
        expect(dataset?.vlmModelId).toBe(
          vlmModelId === undefined ? previousDefaults.llm!.modelId : undefined
        );
      } finally {
        setModelTestSnapshot({ defaultModels: previousDefaults });
      }
    }
  );

  it('does not restore a legacy VLM name when the canonical selection is explicitly unset', async () => {
    const users = await getFakeUsers(1);
    const owner = users.members[0];
    await MongoResourcePermission.create({
      resourceType: 'team',
      teamId: owner.teamId,
      resourceId: null,
      tmbId: owner.tmbId,
      permission: TeamDatasetCreatePermissionVal
    });
    const res = await Call<CreateDatasetBody, Record<string, never>, CreateDatasetResponse>(
      createHandler,
      {
        auth: owner,
        body: {
          name: 'unset-vision',
          intro: '',
          avatar: '',
          type: DatasetTypeEnum.dataset,
          vlmModelId: '',
          vlmModel: 'deleted-legacy'
        }
      }
    );
    expect(res.code).toBe(200);
    expect(await MongoDataset.findById(res.data).lean()).not.toHaveProperty('vlmModelId');
  });
  it('should return 200 when create dataset success', async () => {
    const users = await getFakeUsers(2);
    await MongoResourcePermission.create({
      resourceType: 'team',
      teamId: users.members[0].teamId,
      resourceId: null,
      tmbId: users.members[0].tmbId,
      permission: TeamDatasetCreatePermissionVal
    });
    const res = await Call<CreateDatasetBody, Record<string, never>, CreateDatasetResponse>(
      createHandler,
      {
        auth: users.members[0],
        body: {
          name: 'folder',
          intro: 'intro',
          avatar: 'avatar',
          type: DatasetTypeEnum.folder
        }
      }
    );
    expect(res.error).toBeUndefined();
    expect(res.code).toBe(200);
    const folderId = res.data as string;

    const res2 = await Call<CreateDatasetBody, Record<string, never>, CreateDatasetResponse>(
      createHandler,
      {
        auth: users.members[0],
        body: {
          name: 'test',
          intro: 'intro',
          avatar: 'avatar',
          type: DatasetTypeEnum.dataset,
          parentId: folderId
        }
      }
    );

    expect(res2.error).toBeUndefined();
    expect(res2.code).toBe(200);
  });
});

describe('generic dataset creation quota', () => {
  it('applies a newly published folder limit to both creation routes', async () => {
    const owner = await getRootUser();
    const originalSnapshot = getTestInstanceConfig();
    const publishLimit = (datasetFolderMaxAmount: number) => {
      publishSystemInstanceConfigSnapshot({
        snapshot: {
          ...originalSnapshot,
          resource: { ...originalSnapshot.resource, datasetFolderMaxAmount }
        }
      });
    };
    const createGenericFolder = (name: string) =>
      Call(createHandler, {
        auth: owner,
        body: { name, intro: '', type: DatasetTypeEnum.folder }
      });
    const createDedicatedFolder = (name: string) =>
      Call(folderCreateHandler, { auth: owner, body: { name, intro: '' } });

    try {
      publishLimit(0);
      expect((await createGenericFolder('generic-denied')).error).toBe(
        TeamErrEnum.datasetFolderAmountNotEnough
      );
      expect((await createDedicatedFolder('dedicated-denied')).error).toBe(
        TeamErrEnum.datasetFolderAmountNotEnough
      );
      expect(await MongoDataset.countDocuments({ teamId: owner.teamId })).toBe(0);

      publishLimit(1);
      const allowed = await createGenericFolder('generic-allowed');
      expect(allowed.code).toBe(200);
      expect((await MongoDataset.findById(allowed.data).lean())?.type).toBe(DatasetTypeEnum.folder);
      expect((await createDedicatedFolder('dedicated-overflow')).error).toBe(
        TeamErrEnum.datasetFolderAmountNotEnough
      );
      expect((await createGenericFolder('generic-overflow')).error).toBe(
        TeamErrEnum.datasetFolderAmountNotEnough
      );
      expect(
        await MongoDataset.countDocuments({ teamId: owner.teamId, type: DatasetTypeEnum.folder })
      ).toBe(1);
    } finally {
      publishSystemInstanceConfigSnapshot({ snapshot: originalSnapshot });
    }
  });

  it('enforces the dataset license quota for datasets while allowing folders on both routes', async () => {
    const owner = await getRootUser();
    await MongoDataset.create({
      name: 'existing-dataset',
      teamId: owner.teamId,
      tmbId: owner.tmbId,
      type: DatasetTypeEnum.dataset
    });
    const originalLicense = getSystemInstanceConfig().license.data;

    try {
      getSystemInstanceConfig().license.data = { maxDatasets: 1 } as ReturnType<
        typeof getSystemInstanceConfig
      >['license']['data'];
      const dataset = await Call(createHandler, {
        auth: owner,
        body: { name: 'denied-dataset', intro: '', type: DatasetTypeEnum.dataset }
      });
      const genericFolder = await Call(createHandler, {
        auth: owner,
        body: { name: 'generic-folder', intro: '', type: DatasetTypeEnum.folder }
      });
      const dedicatedFolder = await Call(folderCreateHandler, {
        auth: owner,
        body: { name: 'dedicated-folder', intro: '' }
      });

      expect(dataset.error).toBe(SystemErrEnum.licenseDatasetAmountLimit);
      expect(genericFolder.code).toBe(200);
      expect(dedicatedFolder.code).toBe(200);
      expect(
        await MongoDataset.countDocuments({ teamId: owner.teamId, type: DatasetTypeEnum.folder })
      ).toBe(2);
    } finally {
      getSystemInstanceConfig().license.data = originalLicense;
    }
  });
});

describe('create dataset inheritPermission', () => {
  it('parses an omitted inheritPermission as true', () => {
    expect(
      CreateDatasetBodySchema.parse({
        name: 'folder',
        intro: '',
        type: DatasetTypeEnum.folder
      }).inheritPermission
    ).toBe(true);
  });

  /** 父级 folder + 一个 read 协作者：子级是否合并父级快照可以直接观察。 */
  const setupParentFolder = async () => {
    const users = await getFakeUsers(2);
    const [owner, collaborator] = users.members;
    const teamId = users.owner.teamId;
    await MongoResourcePermission.create({
      resourceType: 'team',
      teamId,
      resourceId: null,
      tmbId: owner.tmbId,
      permission: TeamDatasetCreatePermissionVal
    });
    const parent = await MongoDataset.create({
      name: 'parent-folder',
      type: DatasetTypeEnum.folder,
      teamId,
      tmbId: owner.tmbId
    });
    await MongoResourcePermission.create([
      {
        resourceType: PerResourceTypeEnum.dataset,
        teamId,
        resourceId: parent._id,
        tmbId: owner.tmbId,
        permission: OwnerRoleVal
      },
      {
        resourceType: PerResourceTypeEnum.dataset,
        teamId,
        resourceId: parent._id,
        tmbId: collaborator.tmbId,
        permission: ReadRoleVal
      }
    ]);
    return { owner, collaborator, teamId, parent };
  };

  /** dataset ACL 快照的可比较形式（协作者 + 权限位）。 */
  const datasetPermissions = async ({
    teamId,
    datasetId
  }: {
    teamId: string;
    datasetId: string;
  }) => {
    const rows = await MongoResourcePermission.find(
      { resourceType: PerResourceTypeEnum.dataset, teamId, resourceId: datasetId },
      'tmbId permission'
    ).lean();
    return rows.map((row) => `${String(row.tmbId)}:${row.permission}`).sort();
  };

  const createChild = async ({
    owner,
    parentId,
    type,
    inheritPermission
  }: {
    owner: parseHeaderCertRet;
    parentId: string;
    type: DatasetTypeEnum;
    inheritPermission?: boolean;
  }) => {
    const res = await Call<CreateDatasetBody, Record<string, never>, CreateDatasetResponse>(
      createHandler,
      {
        auth: owner,
        body: { name: 'child', intro: '', avatar: '', type, parentId, inheritPermission }
      }
    );
    return { res, dataset: await MongoDataset.findById(res.data).lean() };
  };

  it('inherits the parent snapshot when inheritPermission is omitted', async () => {
    const { owner, collaborator, teamId, parent } = await setupParentFolder();

    const { res, dataset } = await createChild({
      owner,
      parentId: String(parent._id),
      type: DatasetTypeEnum.folder
    });

    expect(res.code).toBe(200);
    expect(dataset?.inheritPermission).toBe(true);
    await expect(datasetPermissions({ teamId, datasetId: String(dataset?._id) })).resolves.toEqual(
      [
        `${String(owner.tmbId)}:${OwnerRoleVal}`,
        `${String(collaborator.tmbId)}:${ReadRoleVal}`
      ].sort()
    );
  });

  it('writes only the owner snapshot for an independent folder', async () => {
    const { owner, teamId, parent } = await setupParentFolder();

    const { res, dataset } = await createChild({
      owner,
      parentId: String(parent._id),
      type: DatasetTypeEnum.folder,
      inheritPermission: false
    });

    expect(res.code).toBe(200);
    expect(dataset?.inheritPermission).toBe(false);
    await expect(datasetPermissions({ teamId, datasetId: String(dataset?._id) })).resolves.toEqual([
      `${String(owner.tmbId)}:${OwnerRoleVal}`
    ]);
  });

  // 普通知识库与 folder 一致：非 folder 类型同样写入并生效。
  it('writes only the owner snapshot for an independent dataset', async () => {
    const { owner, teamId, parent } = await setupParentFolder();

    const { res, dataset } = await createChild({
      owner,
      parentId: String(parent._id),
      type: DatasetTypeEnum.dataset,
      inheritPermission: false
    });

    expect(res.code).toBe(200);
    expect(dataset?.inheritPermission).toBe(false);
    await expect(datasetPermissions({ teamId, datasetId: String(dataset?._id) })).resolves.toEqual([
      `${String(owner.tmbId)}:${OwnerRoleVal}`
    ]);
  });

  it('inherits the parent snapshot for a dataset when inheritPermission is omitted', async () => {
    const { owner, collaborator, teamId, parent } = await setupParentFolder();

    const { res, dataset } = await createChild({
      owner,
      parentId: String(parent._id),
      type: DatasetTypeEnum.dataset
    });

    expect(res.code).toBe(200);
    expect(dataset?.inheritPermission).toBe(true);
    await expect(datasetPermissions({ teamId, datasetId: String(dataset?._id) })).resolves.toEqual(
      [
        `${String(owner.tmbId)}:${OwnerRoleVal}`,
        `${String(collaborator.tmbId)}:${ReadRoleVal}`
      ].sort()
    );
  });
});

describe('generic dataset creation parent checks', () => {
  it('rejects a foreign-team ancestor behind an authorized parent folder', async () => {
    const { owner } = await getFakeUsers(1);
    const foreign = await getUser('foreign-team-owner');
    const ancestor = await MongoDataset.create({
      name: 'foreign-ancestor',
      type: DatasetTypeEnum.folder,
      teamId: foreign.teamId,
      tmbId: foreign.tmbId
    });
    const parent = await MongoDataset.create({
      name: 'local-parent',
      type: DatasetTypeEnum.folder,
      parentId: ancestor._id,
      teamId: owner.teamId,
      tmbId: owner.tmbId
    });
    const result = await Call(createHandler, {
      auth: owner,
      body: {
        name: 'invalid-child',
        intro: '',
        type: DatasetTypeEnum.dataset,
        parentId: String(parent._id)
      }
    });
    expect(result.error).toBe(CommonErrEnum.invalidParams);
    expect(await MongoDataset.countDocuments({ name: 'invalid-child' })).toBe(0);
  });

  it('enforces folder depth at the boundary and permits a dataset in the deepest folder', async () => {
    const { owner } = await getFakeUsers(1);
    const ids: string[] = [];
    for (let i = 0; i < getTestInstanceConfig().resource.maxFolderDepth - 1; i++) {
      const folder = await MongoDataset.create({
        name: `level-${i}`,
        type: DatasetTypeEnum.folder,
        parentId: ids.at(-1) ?? null,
        teamId: owner.teamId,
        tmbId: owner.tmbId
      });
      ids.push(String(folder._id));
    }
    const last = await Call(createHandler, {
      auth: owner,
      body: { name: 'last', intro: '', type: DatasetTypeEnum.folder, parentId: ids.at(-1) }
    });
    expect(last.code).toBe(200);
    expect((await MongoDataset.findById(last.data).lean())?.ancestorIds.map(String)).toEqual(ids);
    const overflow = await Call(createHandler, {
      auth: owner,
      body: { name: 'overflow', intro: '', type: DatasetTypeEnum.folder, parentId: last.data }
    });
    expect(overflow.error).toBe(CommonErrEnum.folderDepthLimit);
    expect(await MongoDataset.countDocuments({ name: 'overflow' })).toBe(0);
    const leaf = await Call(createHandler, {
      auth: owner,
      body: { name: 'leaf', intro: '', type: DatasetTypeEnum.dataset, parentId: last.data }
    });
    expect(leaf.code).toBe(200);
    const historical = await MongoDataset.create({
      name: 'historical-deep-folder',
      type: DatasetTypeEnum.folder,
      parentId: last.data,
      teamId: owner.teamId,
      tmbId: owner.tmbId
    });
    const deepLeaf = await Call(createHandler, {
      auth: owner,
      body: {
        name: 'invalid-deep-leaf',
        intro: '',
        type: DatasetTypeEnum.dataset,
        parentId: String(historical._id)
      }
    });
    expect(deepLeaf.error).toBe(CommonErrEnum.folderDepthLimit);
    expect(await MongoDataset.countDocuments({ name: 'invalid-deep-leaf' })).toBe(0);
  });

  it.each([DatasetTypeEnum.folder, DatasetTypeEnum.dataset])(
    'rejects a dataset as the parent of %s',
    async (type) => {
      const { owner } = await getFakeUsers(1);
      const parent = await MongoDataset.create({
        name: 'leaf-parent',
        type: DatasetTypeEnum.dataset,
        teamId: owner.teamId,
        tmbId: owner.tmbId
      });
      const res = await Call(createHandler, {
        auth: owner,
        body: { name: 'invalid', intro: '', type, parentId: String(parent._id) }
      });
      expect(res.error).toBe(CommonErrEnum.invalidParams);
      expect(await MongoDataset.countDocuments({ parentId: parent._id })).toBe(0);
    }
  );
});
