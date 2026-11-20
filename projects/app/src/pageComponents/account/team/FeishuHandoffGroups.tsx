import React, { useState } from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  ModalBody,
  ModalFooter,
  Spinner,
  Stack,
  Text
} from '@chakra-ui/react';
import MyModal from '@fastgpt/web/components/common/MyModal';
import MultipleSelect from '@fastgpt/web/components/common/MySelect/MultipleSelect';
import { useConfirm } from '@fastgpt/web/hooks/useConfirm';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { getFeishuHandoffGroups, updateFeishuHandoffGroup } from '@/web/core/app/api/feishuHandoff';

type GroupDraft = { id?: string; name: string; memberIds: string[] };

/** 系统管理员从已同步的员工中维护每个业务的接待人员名单。 */
export default function FeishuHandoffGroups() {
  const [draft, setDraft] = useState<GroupDraft>();
  const { data, loading, error, refresh } = useRequest(getFeishuHandoffGroups, {
    manual: false
  });
  const { run: save, loading: saving } = useRequest(updateFeishuHandoffGroup, {
    successToast: '客服组已更新',
    onSuccess: () => {
      setDraft(undefined);
      refresh();
    }
  });
  const { openConfirm, ConfirmModal } = useConfirm({ type: 'delete' });
  const members = new Map(data?.members.map(({ id, name }) => [id, name]));
  const memberOptions = [
    ...Array.from(members, ([value, label]) => ({ value, label })),
    ...(draft?.memberIds ?? [])
      .filter((id) => !members.has(id))
      .map((value) => ({ value, label: '员工已失效或待同步' }))
  ];
  const canSave =
    draft &&
    draft.name.trim() &&
    draft.memberIds.length > 0 &&
    draft.memberIds.length <= 49 &&
    draft.memberIds.every((id) => members.has(id));

  return (
    <Stack spacing={5} maxW="960px" mx="auto" pt={4}>
      <Flex align="center" justify="space-between" gap={4}>
        <Heading as="h1" fontSize="xl">
          飞书客服组
        </Heading>
        <Button
          size="sm"
          isDisabled={!data?.members.length || saving}
          onClick={() => setDraft({ name: '', memberIds: [] })}
        >
          新建客服组
        </Button>
      </Flex>
      {data && !data.botConfigured && (
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          请在服务端配置飞书客服机器人凭据（FEISHU_BOT_APP_ID 和 FEISHU_BOT_APP_SECRET）。
        </Alert>
      )}
      {loading && !data && <Spinner size="sm" />}
      {error && (
        <Button alignSelf="start" size="sm" onClick={refresh}>
          重新加载
        </Button>
      )}
      {data?.groups.length === 0 && (
        <Box p={6} bg="white" border="base" borderRadius="lg">
          <Text color="myGray.600">
            {data.members.length > 0
              ? '新建客服组后，可在各业务应用里选择接待人员。'
              : '暂无可选员工，请确认飞书通讯录已同步。'}
          </Text>
        </Box>
      )}
      {data?.groups.map((group) => (
        <Flex
          key={group.id}
          align={['start', 'center']}
          justify="space-between"
          direction={['column', 'row']}
          gap={3}
          p={4}
          bg="white"
          border="base"
          borderRadius="lg"
        >
          <Box minW={0}>
            <Text fontWeight="semibold">{group.name}</Text>
            <Text mt={1} fontSize="sm" color="myGray.600" overflowWrap="anywhere">
              {group.memberIds.map((id) => members.get(id) ?? '待同步员工').join('、')}
            </Text>
          </Box>
          <HStack flexShrink={0}>
            <Button
              size="sm"
              variant="whiteBase"
              isDisabled={saving}
              onClick={() => setDraft(group)}
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={saving}
              onClick={() =>
                openConfirm({
                  customContent: `删除「${group.name}」？请先解除应用对该客服组的绑定。`,
                  onConfirm: () => save({ action: 'delete', id: group.id })
                })
              }
            >
              删除
            </Button>
          </HStack>
        </Flex>
      ))}
      {draft && (
        <MyModal
          title={draft.id ? '编辑客服组' : '新建客服组'}
          onClose={() => !saving && setDraft(undefined)}
          closeOnOverlayClick={!saving}
        >
          <ModalBody>
            <Stack spacing={4}>
              <FormControl isRequired>
                <FormLabel htmlFor="feishu-support-group-name">组名</FormLabel>
                <Input
                  id="feishu-support-group-name"
                  value={draft.name}
                  maxLength={40}
                  placeholder="例如：销售支持组"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </FormControl>
              <MultipleSelect
                formLabel="接待人员"
                aria-label="接待人员"
                list={memberOptions}
                value={draft.memberIds}
                placeholder="从飞书员工中选择"
                searchPlaceholder="搜索员工"
                isSearch
                itemWrap
                closeable
                showSelectAll={false}
                onSelect={(memberIds) => setDraft({ ...draft, memberIds })}
              />
              {draft.memberIds.length > 49 && <Text color="red.600">一个客服组最多 49 人。</Text>}
            </Stack>
          </ModalBody>
          <ModalFooter gap={2}>
            <Button variant="whiteBase" isDisabled={saving} onClick={() => setDraft(undefined)}>
              取消
            </Button>
            <Button
              isLoading={saving}
              isDisabled={!canSave}
              onClick={() => save({ action: 'save', ...draft })}
            >
              保存
            </Button>
          </ModalFooter>
        </MyModal>
      )}
      <ConfirmModal />
    </Stack>
  );
}
