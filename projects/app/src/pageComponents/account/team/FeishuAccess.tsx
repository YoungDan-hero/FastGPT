import { useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Grid,
  Radio,
  RadioGroup,
  Stack,
  StackDivider,
  Text,
  type BoxProps
} from '@chakra-ui/react';
import MyIcon from '@fastgpt/web/components/common/Icon';
import MySelect from '@fastgpt/web/components/common/MySelect';
import FillRowTabs from '@fastgpt/web/components/common/Tabs/FillRowTabs';
import { useConfirm } from '@fastgpt/web/hooks/useConfirm';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { useToast } from '@fastgpt/web/hooks/useToast';
import type {
  FeishuAccessBody,
  FeishuAccessResponse
} from '@fastgpt/global/openapi/support/user/team/org/api';
import { GET, POST } from '@/web/common/api/request';

const endpoint = '/support/user/team/feishu/access';
type GrantRole = Exclude<FeishuAccessBody['role'], 'remove'>;

const principalOptions = [
  { value: 'department', label: '部门', icon: 'support/user/usersLight' },
  { value: 'member', label: '员工', icon: 'support/user/userLight' }
] satisfies Array<{ value: FeishuAccessBody['principal']; label: string; icon: string }>;
const resourceLabels = { app: 'Agent', dataset: '知识库', collection: '文档或文件夹' };
const resourceOptions = (['app', 'dataset', 'collection'] as const).map((value) => ({
  value,
  label: resourceLabels[value]
}));
const roles = {
  read: { label: '读取及使用', description: '查看内容、使用 Agent' },
  write: { label: '写入及编辑', description: '包含读取，允许写入和编辑' },
  manage: { label: '管理', description: '包含编辑，允许管理资源' }
} satisfies Record<GrantRole, { label: string; description: string }>;

const cardStyles = {
  bg: 'white',
  border: '1px solid',
  borderColor: 'myGray.200',
  borderRadius: '16px',
  boxShadow: '1'
} satisfies BoxProps;
const headingStyles = { fontSize: 'md', fontWeight: 'semibold', color: 'myGray.900' } as const;
const selectStyles = { h: '44px', borderRadius: '10px' } as const;
const pickerMenuStyles = {
  '& [role="menu"]': { maxWidth: 'calc(100vw - 32px)', overflowWrap: 'anywhere' }
};

/** 为已同步的飞书部门或员工配置指定资源的权限。 */
export default function FeishuAccess() {
  const { toast } = useToast();
  const { openConfirm, ConfirmModal } = useConfirm({ type: 'delete' });
  const [form, setForm] = useState<Omit<FeishuAccessBody, 'role'> & { role: GrantRole }>({
    principal: 'department',
    principalId: '',
    resource: 'app',
    resourceId: '',
    role: 'read'
  });
  const { data, loading, error, refresh } = useRequest(() => GET<FeishuAccessResponse>(endpoint), {
    manual: false,
    errorToast: ''
  });
  const { runAsync: save, loading: saving } = useRequest(
    (body: FeishuAccessBody) => POST(endpoint, body),
    {
      errorToast: '权限更新失败',
      onSuccess: (_, [body]) =>
        toast({ status: 'success', title: body.role === 'remove' ? '已移除授权' : '已保存授权' })
    }
  );

  const isDepartment = form.principal === 'department';
  const principalLabel = isDepartment ? '部门' : '员工';
  const resourceLabel = resourceLabels[form.resource];
  const principals = (isDepartment ? data?.departments : data?.members) ?? [];
  const resources = data?.[form.resource] ?? [];
  const selectedPrincipal = principals.find(({ id }) => id === form.principalId);
  const selectedResource = resources.find(({ id }) => id === form.resourceId);
  const canSave = Boolean(selectedPrincipal && selectedResource && !loading && !error && !saving);
  const summary = [
    {
      label: '授权对象',
      value: selectedPrincipal?.name,
      detail: selectedPrincipal && isDepartment ? '包含所选部门及其子部门' : undefined
    },
    { label: resourceLabel, value: selectedResource?.name },
    { label: '权限', value: roles[form.role].label }
  ];
  const listStatus = data
    ? `${data.departments.length} 个部门 · ${data.members.length} 名在职员工`
    : '正在载入飞书组织和资源…';

  const confirmRemoval = () => {
    if (!canSave || !selectedPrincipal || !selectedResource) return;
    openConfirm({
      title: '移除授权？',
      customContent: `将移除「${selectedPrincipal.name}」在「${selectedResource.name}」上的这项授权。`,
      confirmText: '移除授权',
      onConfirm: () => save({ ...form, role: 'remove' })
    })();
  };

  return (
    <Box maxW="1120px" mx="auto">
      <Flex
        as="header"
        align="center"
        gap={[3, 4]}
        wrap="wrap"
        p={[4, 6]}
        mb={[4, 5]}
        border="1px solid"
        borderColor="myGray.200"
        borderRadius="16px"
        bg="linear-gradient(115deg, #edf4ff, #f9fbff 64%, #edf6f9)"
      >
        <Flex
          align="center"
          justify="center"
          flexShrink={0}
          boxSize={['42px', '52px']}
          borderRadius="14px"
          bg="white"
          boxShadow="1"
        >
          <MyIcon
            name="core/app/publish/lark"
            w={['23px', '28px']}
            h={['23px', '28px']}
            aria-hidden
          />
        </Flex>
        <Box flex="1 1 168px" minW={0}>
          <Text
            as="h1"
            fontSize={['lg', '2xl']}
            fontWeight="bold"
            color="myGray.900"
            lineHeight="1.2"
          >
            飞书组织授权
          </Text>
          {error ? (
            <Text role="alert" color="red.700" fontSize="sm" mt={1}>
              组织和资源列表加载失败，请重新加载。
            </Text>
          ) : (
            <Text role="status" color="myGray.600" fontSize="sm" mt={1}>
              {listStatus}
            </Text>
          )}
        </Box>
        <Button
          type="button"
          ml="auto"
          variant="whitePrimaryOutline"
          borderRadius="8px"
          leftIcon={<MyIcon name="common/refreshLight" w={4} aria-hidden />}
          isLoading={loading}
          isDisabled={saving}
          onClick={refresh}
        >
          {error ? '重新加载' : '刷新列表'}
        </Button>
      </Flex>

      <Grid
        templateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(260px, 308px)' }}
        alignItems="start"
        gap={[4, 5]}
      >
        <Stack
          as="fieldset"
          disabled={saving}
          minW={0}
          m={0}
          p={0}
          spacing={0}
          divider={<StackDivider borderColor="myGray.150" />}
          {...cardStyles}
        >
          <Box
            as="section"
            aria-labelledby="feishu-principal-heading"
            p={[4, 5]}
            sx={pickerMenuStyles}
          >
            <Text as="h2" id="feishu-principal-heading" mb={3} {...headingStyles}>
              授权对象
            </Text>
            <FillRowTabs
              aria-label="授权对象类型"
              list={principalOptions}
              value={form.principal}
              onChange={(principal) =>
                setForm((current) => ({ ...current, principal, principalId: '' }))
              }
              itemHeight="36px"
              iconSize="16px"
              mb={3}
            />
            <MySelect
              key={form.principal}
              aria-label={
                selectedPrincipal
                  ? `${principalLabel} ${selectedPrincipal.name}`
                  : `选择${principalLabel}`
              }
              placeholder={
                data && !principals.length
                  ? `暂无可选${principalLabel}`
                  : `搜索并选择${principalLabel}`
              }
              value={selectedPrincipal?.id}
              list={principals.map(({ id, name }) => ({ value: id, label: name }))}
              onChange={(principalId) => setForm((current) => ({ ...current, principalId }))}
              isSearch
              isDisabled={!principals.length || loading || saving || Boolean(error)}
              {...selectStyles}
            />
            {isDepartment && (
              <Text mt={2} fontSize="xs" color="myGray.600">
                部门授权范围包含所选部门及其子部门。
              </Text>
            )}
          </Box>

          <Box
            as="section"
            aria-labelledby="feishu-resource-heading"
            p={[4, 5]}
            sx={pickerMenuStyles}
          >
            <Text as="h2" id="feishu-resource-heading" mb={3} {...headingStyles}>
              授权资源
            </Text>
            <FillRowTabs
              aria-label="资源类型"
              list={resourceOptions}
              value={form.resource}
              onChange={(resource) =>
                setForm((current) => ({ ...current, resource, resourceId: '' }))
              }
              itemHeight="36px"
              px={[2, 4]}
              mb={3}
            />
            <MySelect
              key={form.resource}
              aria-label={
                selectedResource
                  ? `${resourceLabel} ${selectedResource.name}`
                  : `选择${resourceLabel}`
              }
              placeholder={
                data && !resources.length
                  ? `暂无可选${resourceLabel}`
                  : `搜索并选择${resourceLabel}`
              }
              value={selectedResource?.id}
              list={resources.map(({ id, name }) => ({ value: id, label: name }))}
              onChange={(resourceId) => setForm((current) => ({ ...current, resourceId }))}
              isSearch
              isDisabled={!resources.length || loading || saving || Boolean(error)}
              {...selectStyles}
            />
            {form.resource === 'collection' && (
              <Text
                mt={3}
                px={3}
                py={2}
                borderRadius="8px"
                bg="primary.50"
                fontSize="sm"
                color="myGray.700"
              >
                请先在知识库开启文档权限。员工需要同时拥有知识库读取权限和目标文档写入权限，才能沉淀知识。
              </Text>
            )}
          </Box>

          <Box as="section" aria-labelledby="feishu-permission-heading" p={[4, 5]}>
            <Text as="h2" id="feishu-permission-heading" mb={3} {...headingStyles}>
              权限级别
            </Text>
            <RadioGroup
              name="feishu-access-role"
              aria-labelledby="feishu-permission-heading"
              value={form.role}
              onChange={(role) => setForm((current) => ({ ...current, role: role as GrantRole }))}
            >
              <Grid templateColumns={['1fr', 'repeat(3, minmax(0, 1fr))']} gap={2}>
                {(['read', 'write', 'manage'] as const).map((role) => (
                  <Radio
                    key={role}
                    value={role}
                    border="1px solid"
                    borderColor={form.role === role ? 'primary.300' : 'myGray.200'}
                    bg={form.role === role ? 'primary.50' : 'white'}
                    borderRadius="10px"
                    px={3}
                    py={3}
                    alignItems="center"
                    _hover={{ borderColor: 'primary.300' }}
                    _focusWithin={{ borderColor: 'primary.500' }}
                  >
                    <Text
                      as="span"
                      display="block"
                      fontSize="sm"
                      fontWeight="medium"
                      color="myGray.900"
                    >
                      {roles[role].label}
                    </Text>
                    <Text as="span" display="block" mt={0.5} fontSize="xs" color="myGray.600">
                      {roles[role].description}
                    </Text>
                  </Radio>
                ))}
              </Grid>
            </RadioGroup>
          </Box>
        </Stack>

        <Box
          as="aside"
          aria-labelledby="feishu-preview-heading"
          position={{ md: 'sticky' }}
          top={4}
          {...cardStyles}
        >
          <Box
            px={[4, 5]}
            py={4}
            borderBottom="1px solid"
            borderColor="myGray.150"
            bg="myGray.50"
            borderTopRadius="16px"
          >
            <Text as="h2" id="feishu-preview-heading" {...headingStyles}>
              授权预览
            </Text>
          </Box>
          <Stack spacing={4} p={[4, 5]}>
            <Stack as="dl" divider={<StackDivider borderColor="myGray.150" />} spacing={3}>
              {summary.map(({ label, value, detail }) => (
                <Box key={label}>
                  <Text as="dt" fontSize="xs" color="myGray.600">
                    {label}
                  </Text>
                  <Text
                    as="dd"
                    mt={1}
                    fontSize="sm"
                    fontWeight="medium"
                    overflowWrap="anywhere"
                    color={value ? 'myGray.900' : 'myGray.500'}
                  >
                    {value ?? '待选择'}
                    {detail && (
                      <Text
                        as="span"
                        display="block"
                        mt={1}
                        fontSize="xs"
                        fontWeight="normal"
                        color="myGray.600"
                      >
                        {detail}
                      </Text>
                    )}
                  </Text>
                </Box>
              ))}
            </Stack>
            {(!selectedPrincipal || !selectedResource) && (
              <Text fontSize="xs" color="myGray.600">
                选好授权对象和资源后即可保存。
              </Text>
            )}
            <Button
              type="button"
              h="42px"
              borderRadius="10px"
              isDisabled={!canSave}
              isLoading={saving}
              onClick={() => canSave && void save(form).catch(() => {})}
            >
              保存授权
            </Button>
            <Button
              type="button"
              variant="transparentDanger"
              size="sm"
              alignSelf="center"
              color="red.700"
              isDisabled={!canSave}
              onClick={confirmRemoval}
            >
              移除授权
            </Button>
          </Stack>
        </Box>
      </Grid>
      <ConfirmModal />
    </Box>
  );
}
