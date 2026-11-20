import { getFeishuAccess, updateFeishuAccess } from '@/web/support/user/team/org/api';
import {
  Box,
  Button,
  Flex,
  IconButton,
  Stack,
  StackDivider,
  Text,
  useDisclosure
} from '@chakra-ui/react';
import type {
  FeishuAccessBody,
  FeishuAccessCollaborator
} from '@fastgpt/global/openapi/support/user/team/org/api';
import MyIcon from '@fastgpt/web/components/common/Icon';
import MySelect from '@fastgpt/web/components/common/MySelect';
import MyModal from '@fastgpt/web/components/v2/common/MyModal';
import { useConfirm } from '@fastgpt/web/hooks/useConfirm';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { useSafeTranslation } from '@fastgpt/web/hooks/useSafeTranslation';
import React, { useState } from 'react';

type GrantRole = Exclude<FeishuAccessBody['role'], 'remove'>;
type Principal = Pick<FeishuAccessCollaborator, 'principal' | 'id' | 'name'>;

const roleLabels = { read: '读取及使用', write: '写入及编辑', manage: '管理', owner: '所有者' };
const roleOptions = (['read', 'write', 'manage'] as const).map((value) => ({
  value,
  label: roleLabels[value]
}));
const principalLabels = { department: '部门', member: '员工' };
const principalKey = ({ principal, id }: Principal) => `${principal}:${id}`;

/** 在当前知识库内管理飞书授权，侧栏和弹窗使用同一份授权列表。 */
export default function FeishuDatasetCollaborators({ datasetId }: { datasetId: string }) {
  const { t } = useSafeTranslation();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { openConfirm, ConfirmModal } = useConfirm();
  const [principalValue, setPrincipalValue] = useState('');
  const [role, setRole] = useState<GrantRole>('read');
  const { data, error, loading, refresh } = useRequest(() => getFeishuAccess({ datasetId }), {
    manual: false,
    errorToast: ''
  });
  const { run: update, loading: saving } = useRequest(updateFeishuAccess, {
    errorToast: '权限更新失败',
    successToast: '已更新授权',
    onSuccess() {
      setPrincipalValue('');
      setRole('read');
      refresh();
    }
  });

  const collaborators = data?.collaborators ?? [];
  const currentByKey = new Map(collaborators.map((item) => [principalKey(item), item]));
  const principals: Principal[] = [
    ...(data?.departments ?? []).map((item) => ({ ...item, principal: 'department' as const })),
    ...(data?.members ?? []).map((item) => ({ ...item, principal: 'member' as const }))
  ].filter((item) => currentByKey.get(principalKey(item))?.role !== 'owner');
  const selected = principals.find((item) => principalKey(item) === principalValue);
  const disabled = Boolean(error || loading || saving || !data);

  const selectPrincipal = (value: string) => {
    setPrincipalValue(value);
    const existingRole = currentByKey.get(value)?.role;
    setRole(existingRole && existingRole !== 'owner' ? existingRole : 'read');
  };

  const save = (target: Principal, nextRole: FeishuAccessBody['role']) => {
    const existing = currentByKey.get(principalKey(target));
    if (disabled || existing?.role === 'owner') return;
    const onConfirm = () =>
      update({
        resource: 'dataset',
        resourceId: datasetId,
        principal: target.principal,
        principalId: target.id,
        role: nextRole
      });

    if (nextRole === 'remove' || existing?.inherited) {
      openConfirm({
        title: nextRole === 'remove' ? '撤销授权' : '修改继承的授权',
        customContent: (
          <Stack spacing={2}>
            <Text>
              {nextRole === 'remove' ? `撤销「${target.name}」在当前知识库的授权？` : target.name}
            </Text>
            {existing?.inherited && <Text>此操作可能关闭当前知识库的权限继承。</Text>}
          </Stack>
        ),
        onConfirm
      })();
      return;
    }
    onConfirm();
  };

  const manageLabel = t('user:team.manage_collaborators');
  const listStatus = (() => {
    if (error) return '授权列表加载失败';
    if (!data && loading) return '正在加载授权…';
    if (collaborators.length === 0) return t('common:permission.Not collaborator');
  })();

  return (
    <Box>
      <Flex align="center" justify="space-between">
        <Text fontSize="mini" fontWeight="bold" color="myGray.900">
          {t('common:permission.Collaborator')}
        </Text>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={manageLabel}
          title={manageLabel}
          icon={<MyIcon name="common/setting" w="16px" />}
          onClick={() => {
            selectPrincipal('');
            refresh();
            onOpen();
          }}
        />
      </Flex>
      <Stack
        mt={2}
        p={2}
        spacing={1}
        maxH="140px"
        overflowY="auto"
        bg="myGray.100"
        borderRadius="md"
      >
        {listStatus ? (
          <Text p={2} fontSize="xs" color="myGray.600" textAlign="center">
            {listStatus}
          </Text>
        ) : (
          collaborators.map((item) => (
            <Flex key={principalKey(item)} align="center" justify="space-between" gap={2}>
              <Text isTruncated title={item.name} fontSize="xs">
                {item.name}
              </Text>
              <Text flexShrink={0} fontSize="xs" color="myGray.600">
                {roleLabels[item.role]}
              </Text>
            </Flex>
          ))
        )}
      </Stack>

      {isOpen && (
        <MyModal
          isOpen
          onClose={onClose}
          size="lg"
          title={manageLabel}
          isLoading={loading && !data}
          footer={
            <Button variant="whiteBase" onClick={onClose}>
              {t('common:Close')}
            </Button>
          }
        >
          <Stack spacing={4}>
            {data?.dataset[0] && <Text fontWeight="medium">{data.dataset[0].name}</Text>}
            {error ? (
              <Flex align="center" gap={3} role="alert">
                <Text fontSize="sm">授权列表加载失败</Text>
                <Button size="sm" variant="whiteBase" onClick={refresh}>
                  重试
                </Button>
              </Flex>
            ) : (
              <Stack spacing={0} divider={<StackDivider borderColor="myGray.200" />}>
                {collaborators.length === 0 && (
                  <Text fontSize="sm" color="myGray.600">
                    {listStatus}
                  </Text>
                )}
                {collaborators.map((item) => (
                  <Flex key={principalKey(item)} align="center" gap={3} py={2}>
                    <Box flex={1} minW={0}>
                      <Text isTruncated title={item.name} fontSize="sm">
                        {item.name}
                      </Text>
                      <Text fontSize="xs" color="myGray.600">
                        {principalLabels[item.principal]} · {roleLabels[item.role]}
                        {item.inherited && ' · 含上级授权'}
                      </Text>
                    </Box>
                    {item.role !== 'owner' && (
                      <Flex gap={1}>
                        <Button
                          size="xs"
                          variant="ghost"
                          isDisabled={disabled}
                          onClick={() => selectPrincipal(principalKey(item))}
                        >
                          编辑
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          color="red.600"
                          isDisabled={disabled}
                          onClick={() => save(item, 'remove')}
                        >
                          撤销
                        </Button>
                      </Flex>
                    )}
                  </Flex>
                ))}
              </Stack>
            )}
            <Flex gap={2} wrap="wrap" align="center">
              <Box flex="1 1 240px" minW={0}>
                <MySelect
                  width="full"
                  aria-label="选择飞书部门或员工"
                  placeholder="搜索飞书部门或员工"
                  value={principalValue}
                  list={principals.map((item) => ({
                    value: principalKey(item),
                    label: `${principalLabels[item.principal]} · ${item.name}`
                  }))}
                  onChange={selectPrincipal}
                  isSearch
                  isDisabled={disabled || principals.length === 0}
                />
              </Box>
              <MySelect
                aria-label="选择授权角色"
                width="132px"
                value={role}
                list={roleOptions}
                onChange={setRole}
                isDisabled={disabled}
              />
              <Button
                isLoading={saving}
                isDisabled={
                  disabled || !selected || currentByKey.get(principalValue)?.role === role
                }
                onClick={() => selected && save(selected, role)}
              >
                保存授权
              </Button>
            </Flex>
            {selected?.principal === 'department' && (
              <Text fontSize="xs" color="myGray.600">
                部门授权包含所选部门及其子部门。
              </Text>
            )}
          </Stack>
        </MyModal>
      )}
      <ConfirmModal />
    </Box>
  );
}
