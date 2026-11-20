import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { DatasetErrEnum } from '@fastgpt/global/common/error/code/dataset';
import { ChatRoleEnum, type ChatSourceTypeEnum } from '@fastgpt/global/core/chat/constants';
import { buildChatSourceAggregateMatch } from '@fastgpt/service/core/chat/source';
import { serviceEnv } from '@fastgpt/service/env';
import { ReadPermissionVal } from '@fastgpt/global/support/permission/constant';
import { authDatasetCollectionByTmbId } from '@fastgpt/service/support/permission/dataset/auth';
import { assertFeishuOrgMember } from '@fastgpt/service/support/user/feishu/member';

type ChatCollectionActor = { teamId: string; tmbId: string; isRoot: boolean };

export const authFeishuChatCollections = async (
  collectionIds: string[],
  actor?: ChatCollectionActor
) => {
  if (!serviceEnv.FEISHU_ORG_ENABLED || collectionIds.length === 0) return;
  if (!actor) throw DatasetErrEnum.unAuthDatasetFile;
  if (!actor.isRoot) await assertFeishuOrgMember(actor);
  await Promise.all(
    [...new Set(collectionIds)].map((collectionId) =>
      authDatasetCollectionByTmbId({ ...actor, collectionId, per: ReadPermissionVal })
    )
  );
};

/**
 * 校验文档是否来自当前会话引用。
 *
 * 只依赖 ChatItem 上的 citeCollectionIds 判断 collection 是否在当前会话中被引用，
 * 避免读取和解析完整 responseData。
 */
export const authCollectionInChat = async ({
  actor,
  collectionIds,
  sourceType,
  sourceId,
  chatId
}: {
  actor?: ChatCollectionActor;
  collectionIds: string[];
  sourceType: ChatSourceTypeEnum;
  sourceId: string;
  chatId: string;
}) => {
  const targetCollectionIds = collectionIds.map(String);
  await authFeishuChatCollections(targetCollectionIds, actor);

  const [authResult] = await MongoChatItem.aggregate<{ isAuthorized: boolean }>([
    {
      $match: {
        ...buildChatSourceAggregateMatch({ sourceType, sourceId }),
        chatId,
        obj: ChatRoleEnum.AI
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 50 },
    { $unwind: '$citeCollectionIds' },
    {
      $group: {
        _id: null,
        citeCollectionIds: { $addToSet: { $toString: '$citeCollectionIds' } }
      }
    },
    {
      $project: {
        _id: 0,
        isAuthorized: { $setIsSubset: [targetCollectionIds, '$citeCollectionIds'] }
      }
    }
  ]);

  if (authResult?.isAuthorized) {
    return;
  }
  return Promise.reject(DatasetErrEnum.unAuthDatasetFile);
};
