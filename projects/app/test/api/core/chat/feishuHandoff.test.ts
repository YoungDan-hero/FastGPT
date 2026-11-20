import groupsHandler from '@/pages/api/support/user/team/feishu/handoffGroups';
import configHandler from '@/pages/api/core/app/feishuHandoff';
import handoffHandler from '@/pages/api/core/chat/feishuHandoff';
import {
  type FeishuHandoffBody,
  type FeishuHandoffGroupsResponse,
  type FeishuHandoffResponse,
  type FeishuHandoffTurn
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import {
  ChatRoleEnum,
  ChatSourceEnum,
  ChatSourceTypeEnum
} from '@fastgpt/global/core/chat/constants';
import { OwnerRoleVal, PerResourceTypeEnum } from '@fastgpt/global/support/permission/constant';
import { PublishChannelEnum } from '@fastgpt/global/support/outLink/constant';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { getFeishuHandoffChatOptions } from '@fastgpt/service/core/app/feishuHandoff/service';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';
import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { serviceEnv } from '@fastgpt/service/env';
import { MongoOutLink } from '@fastgpt/service/support/outLink/schema';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import * as feishuMember from '@fastgpt/service/support/user/feishu/member';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { MongoTeamMember } from '@fastgpt/service/support/user/team/teamMemberSchema';
import { getRootUser, getUser } from '@test/datas/users';
import { Call } from '@test/utils/request';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testEnv = {
  FEISHU_ORG_ENABLED: true,
  FEISHU_ORG_APP_ID: 'cli_test_directory',
  FEISHU_ORG_APP_SECRET: 'test-directory-secret',
  FEISHU_BOT_APP_ID: 'cli_test_support',
  FEISHU_BOT_APP_SECRET: 'test-support-secret'
};
const originalEnv = Object.fromEntries(
  Object.keys(testEnv).map((key) => [key, serviceEnv[key as keyof typeof testEnv]])
);

afterEach(() => {
  Object.assign(serviceEnv, originalEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const chatId = 'handoff-chat';
const citeId = '0123456789abcdef01234567';
const expenseTurn = { questionId: 'expense-question', answerId: 'expense-answer' };
const licensingTurn = { questionId: 'licensing-round', answerId: 'licensing-round' };

/** 使用隔离的 MongoDB，保留真实的客服组、应用和会话权限判断。 */
async function company() {
  const admin = await getRootUser();
  const { teamId } = admin;
  Object.assign(serviceEnv, testEnv);
  vi.spyOn(feishuMember, 'getFeishuCompanyTeamId').mockResolvedValue(teamId);
  const employee = async (name: string) => {
    const member = await getUser(name, teamId);
    await MongoTeamMember.updateOne({ _id: member.tmbId }, { name });
    await MongoUser.updateOne(
      { _id: member.userId },
      {
        feishuOrg: {
          appId: testEnv.FEISHU_ORG_APP_ID,
          teamId,
          checkedAt: new Date(),
          unionId: `on_${name}`
        }
      }
    );
    return member;
  };
  const [requester, sales, finance] = await Promise.all(
    ['requester', 'sales', 'finance'].map(employee)
  );
  for (const [name, member] of [
    ['销售', sales],
    ['财务', finance]
  ] as const) {
    expect(
      await Call(groupsHandler, {
        method: 'POST',
        auth: admin,
        body: { action: 'save', name, memberIds: [member.tmbId] }
      })
    ).toMatchObject({ code: 200 });
  }
  const groups = await Call<never, never, FeishuHandoffGroupsResponse>(groupsHandler, {
    method: 'GET',
    auth: admin
  });
  expect(groups.code).toBe(200);
  const getGroupId = (name: string) => groups.data.groups.find((group) => group.name === name)!.id;

  const app = await MongoApp.create({
    teamId,
    name: '业务问答',
    type: AppTypeEnum.workflow,
    tmbId: requester.tmbId
  });
  const appId = String(app._id);
  await MongoResourcePermission.create({
    teamId,
    resourceType: PerResourceTypeEnum.app,
    resourceId: app._id,
    tmbId: requester.tmbId,
    permission: OwnerRoleVal
  });
  expect(
    await Call(configHandler, {
      method: 'POST',
      auth: requester,
      body: {
        appId,
        config: {
          enabled: true,
          defaultGroupId: getGroupId('销售')
        }
      }
    })
  ).toMatchObject({ code: 200 });
  const target = {
    teamId,
    appId,
    chatId,
    sourceType: ChatSourceTypeEnum.app,
    tmbId: requester.tmbId
  };
  await MongoChat.create({ ...target, source: ChatSourceEnum.online });
  await MongoChatItem.insertMany([
    {
      ...target,
      dataId: expenseTurn.questionId,
      obj: ChatRoleEnum.Human,
      value: [{ text: { content: '我想确认报销流程' } }]
    },
    {
      ...target,
      dataId: expenseTurn.answerId,
      obj: ChatRoleEnum.AI,
      value: [{ text: { content: `请提交报销凭证[${citeId}](CITE)` } }]
    },
    {
      ...target,
      dataId: licensingTurn.questionId,
      obj: ChatRoleEnum.Human,
      value: [{ text: { content: '版权合作如何报价' } }]
    },
    {
      ...target,
      dataId: licensingTurn.answerId,
      obj: ChatRoleEnum.AI,
      value: [{ text: { content: '请联系版权商务' } }]
    }
  ]);
  return { admin, requester, appId, target, getGroupId };
}

function fakeFeishu() {
  let createdChats = 0;
  const createGroup = vi.fn(async (_body: Record<string, unknown>) => ({
    code: 0,
    data: { chat_id: `oc_test_${++createdChats}`, invalid_id_list: [] as string[] }
  }));
  const sendCard = vi.fn(async (_body: Record<string, unknown>) => ({
    code: 0,
    data: { message_id: 'om_test' }
  }));
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    const body = JSON.parse(String(init?.body));
    if (pathname.endsWith('/tenant_access_token/internal')) {
      expect(body.app_id).toBe(testEnv.FEISHU_BOT_APP_ID);
      return Response.json({ code: 0, tenant_access_token: 'test-token' });
    }
    if (pathname.endsWith('/im/v1/chats')) return Response.json(await createGroup(body));
    if (pathname.endsWith('/im/v1/messages')) return Response.json(await sendCard(body));
    throw new Error(`Unexpected test request: ${pathname}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, createGroup, sendCard };
}

describe('飞书转人工', () => {
  it('只向应用绑定的客服组发送所选问答，重复确认复用群并避免重复发送', async () => {
    const { admin, requester, appId, getGroupId } = await company();
    await MongoApp.collection.updateOne(
      { _id: new MongoApp.base.Types.ObjectId(appId) },
      { $set: { 'feishuHandoff.routes': [{ category: '报销', groupId: getGroupId('财务') }] } }
    );
    expect(await getFeishuHandoffChatOptions(appId, admin.teamId)).toEqual({
      categories: []
    });
    const { createGroup, sendCard } = fakeFeishu();
    const submit = (turn?: FeishuHandoffTurn) =>
      Call<FeishuHandoffBody & { category?: string }, never, FeishuHandoffResponse>(
        handoffHandler,
        {
          method: 'POST',
          auth: requester,
          body: { appId, chatId, confirmed: true, turn, category: '报销', note: '需要人工核对' }
        }
      );
    const first = await submit(expenseTurn);
    expect(first).toMatchObject({ code: 200, data: { groupName: '销售', reused: false } });
    expect(await submit(expenseTurn)).toMatchObject({
      code: 200,
      data: { chatUrl: first.data.chatUrl, reused: true }
    });
    expect(await submit()).toMatchObject({ code: 200, data: { groupName: '销售', reused: true } });
    expect(createGroup).toHaveBeenCalledTimes(1);
    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ chat_type: 'private', user_id_list: ['on_requester', 'on_sales'] })
    );
    expect(sendCard).toHaveBeenCalledTimes(2);
    const [selected, latest] = sendCard.mock.calls.map(([body]) => String(body.content));
    expect(selected).toContain('我想确认报销流程');
    expect(selected).toContain('请提交报销凭证');
    expect(selected).toContain('需要人工核对');
    expect(selected).not.toContain('版权');
    expect(selected).not.toContain(citeId);
    expect(latest).toContain('版权合作如何报价');
    expect(latest).toContain('请联系版权商务');
    expect(latest).not.toContain('报销');

    expect(await submit({ questionId: licensingTurn.questionId })).toMatchObject({ code: 200 });
    expect(sendCard).toHaveBeenCalledTimes(3);
    expect(sendCard.mock.calls[2][0].content).toContain('版权合作如何报价');
    expect(sendCard.mock.calls[2][0].content).not.toContain('请联系版权商务');
    expect(
      await Call(groupsHandler, {
        method: 'POST',
        auth: admin,
        body: { action: 'delete', id: getGroupId('销售') }
      })
    ).toMatchObject({ code: 500 });
  });

  it('拦截未确认、其他成员的会话、跨轮问答和普通员工修改客服组', async () => {
    const { admin, requester, appId, target } = await company();
    const { fetch } = fakeFeishu();
    await MongoChat.updateOne({ appId, chatId }, { tmbId: admin.tmbId });
    expect(
      await Call(handoffHandler, {
        method: 'POST',
        auth: admin,
        body: { appId, chatId, confirmed: false }
      })
    ).toMatchObject({ code: 500 });
    await MongoChat.updateOne({ appId, chatId }, { tmbId: target.tmbId });
    expect(
      await Call(handoffHandler, {
        method: 'POST',
        auth: admin,
        body: { appId, chatId, confirmed: true }
      })
    ).toMatchObject({ code: 500 });
    await MongoChatItem.updateOne(
      { ...target, dataId: expenseTurn.answerId },
      { deleteTime: new Date() }
    );
    await MongoChatItem.updateOne(
      { ...target, dataId: licensingTurn.questionId, obj: ChatRoleEnum.Human },
      { hideInUI: true }
    );
    expect(
      await Call(handoffHandler, {
        method: 'POST',
        auth: requester,
        body: {
          appId,
          chatId,
          confirmed: true,
          turn: { questionId: expenseTurn.questionId, answerId: licensingTurn.answerId }
        }
      })
    ).toMatchObject({ code: 500 });
    expect(
      await Call(groupsHandler, {
        method: 'POST',
        auth: requester,
        body: { action: 'save', name: '其他', memberIds: [requester.tmbId] }
      })
    ).toMatchObject({ code: 500 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('受保护分享页使用登录员工身份，卡片失败后复用首次建立的群', async () => {
    const { admin, requester, appId, target } = await company();
    const shareId = 'test-feishu-handoff-share';
    const share = await MongoOutLink.create({
      teamId: admin.teamId,
      tmbId: admin.tmbId,
      appId,
      shareId,
      type: PublishChannelEnum.share,
      name: '员工分享',
      allowAnonymous: false
    });
    await MongoChat.updateOne(target, {
      source: ChatSourceEnum.share,
      publishSource: { type: ChatSourceEnum.share, id: String(share._id) },
      outLinkUid: requester.tmbId
    });
    const { createGroup, sendCard } = fakeFeishu();
    sendCard.mockRejectedValueOnce(new Error('Feishu message API interrupted'));
    const submit = () =>
      Call(handoffHandler, {
        method: 'POST',
        auth: requester,
        body: { chatId, outLinkAuthData: { shareId, outLinkUid: 'browser-uid' }, confirmed: true }
      });
    expect(await submit()).toMatchObject({ code: 500 });
    expect(await submit()).toMatchObject({ code: 200, data: { groupName: '销售', reused: true } });
    expect(createGroup).toHaveBeenCalledTimes(1);
    expect(sendCard).toHaveBeenCalledTimes(2);
    expect(sendCard.mock.calls[0][0].uuid).toBe(sendCard.mock.calls[1][0].uuid);
  });
});
