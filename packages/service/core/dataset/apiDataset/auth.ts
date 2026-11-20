import {
  AuthUserTypeEnum,
  ManagePermissionVal,
  WritePermissionVal
} from '@fastgpt/global/support/permission/constant';
import { authDatasetCollectionMoves } from '../../../support/permission/collection/moveAuth';
import type { AuthModeType } from '../../../support/permission/type';
import type { ApiFileParentUpdate } from './utils';
import { UserError } from '@fastgpt/global/common/error/utils';
import { DatasetTypeEnum } from '@fastgpt/global/core/dataset/constants';
import type { DatasetSchemaType } from '@fastgpt/global/core/dataset/type';

/** 导入任意新链接会使用库的飞书授权，沿用飞书来源原有的创建者校验。 */
export function assertCanImportFeishuSource({
  dataset,
  authType,
  tmbId
}: {
  dataset: Pick<DatasetSchemaType, 'type' | 'tmbId'>;
  authType?: `${AuthUserTypeEnum}`;
  tmbId: string;
}) {
  if (
    dataset.type !== DatasetTypeEnum.feishu ||
    authType !== AuthUserTypeEnum.token ||
    String(dataset.tmbId) !== String(tmbId)
  ) {
    throw new UserError(
      'Cannot import a Feishu source',
      '请由知识库创建者登录后导入新的飞书链接。'
    );
  }
}

export type ApiFileImportChanges = {
  /** 新建节点所在的最近已有父级；新目录由调用者创建，其下的写权限由该授权承接。 */
  creationParentIds: (string | null)[];
  newFolderIds: Set<string>;
  moves: ApiFileParentUpdate[];
  /** 兼容转换会复用旧目录权限，必须有该目录的 manage。 */
  permissionSourceIds?: string[];
};

/**
 * 对实际导入计划鉴权：新建要求真实父级 write，移动沿用普通移动的源/目标 manage 与根目录团队权限。
 * 本轮新建目录的 owner 是调用者，创建授权通过后无需查询尚未落库的目录；已有目录必须独立鉴权。
 */
export const authApiFileImportChanges = async ({
  datasetId,
  creationParentIds,
  newFolderIds,
  moves,
  permissionSourceIds = [],
  ...auth
}: AuthModeType & ApiFileImportChanges & { datasetId: string }): Promise<void> => {
  await authDatasetCollectionMoves({
    ...auth,
    datasetId,
    creationParentIds,
    newFolderIds,
    moves: moves
      .filter((item) => item.oldParentId !== item.newParentId)
      .map((item) => ({ collectionId: item._id, targetParentId: item.newParentId })),
    // 仅清理远端父字段仍按节点 write 校验。
    collectionChecks: [
      ...moves
        .filter((item) => item.oldParentId === item.newParentId)
        .map((item) => ({ collectionId: item._id, per: WritePermissionVal })),
      ...permissionSourceIds.map((collectionId) => ({ collectionId, per: ManagePermissionVal }))
    ]
  });
};
