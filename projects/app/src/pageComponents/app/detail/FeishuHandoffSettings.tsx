import React, { useState } from 'react';
import {
  Alert,
  AlertIcon,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Select,
  Spinner,
  Stack,
  Switch,
  Text
} from '@chakra-ui/react';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import {
  FeishuHandoffConfigSchema,
  type FeishuHandoffConfig
} from '@fastgpt/global/core/app/feishuHandoff';
import {
  FeishuHandoffModal,
  handoffFieldStyle,
  handoffPrimaryAction,
  handoffSecondaryAction
} from '@/components/core/chat/ChatContainer/ChatBox/components/FeishuHandoffModal';
import {
  getFeishuHandoffConfig,
  updateFeishuHandoffConfig
} from '@/web/core/app/api/feishuHandoff';

/** 为当前 Agent 启用飞书客服并指定接待组。 */
export default function FeishuHandoffSettings({
  appId,
  onClose
}: {
  appId: string;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<FeishuHandoffConfig>();
  const { data, loading, error, refresh } = useRequest(() => getFeishuHandoffConfig(appId), {
    manual: false,
    onSuccess: ({ config }) => setConfig(config)
  });
  const { run: save, loading: saving } = useRequest(updateFeishuHandoffConfig, {
    successToast: '人工客服配置已保存',
    onSuccess: onClose
  });
  const validation = FeishuHandoffConfigSchema.safeParse(config);

  return (
    <FeishuHandoffModal
      title="人工客服设置"
      busy={saving}
      onClose={onClose}
      actions={
        <>
          <Button {...handoffSecondaryAction} isDisabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            {...handoffPrimaryAction}
            type="button"
            minW="88px"
            isLoading={saving}
            loadingText="正在保存"
            isDisabled={!validation.success || loading || Boolean(error)}
            onClick={() => {
              if (validation.success) save({ appId, config: validation.data });
            }}
          >
            保存
          </Button>
        </>
      }
    >
      {loading && !data && (
        <Flex gap={3} align="center" minH="44px" role="status">
          <Spinner size="sm" color="#4147a2" />
          <Text fontSize="sm" color="#4c5b73">
            正在读取人工客服设置
          </Text>
        </Flex>
      )}
      {error && (
        <Button {...handoffSecondaryAction} onClick={refresh}>
          重新加载
        </Button>
      )}
      {config && (
        <Stack spacing={5}>
          {data && !data.botConfigured && (
            <Alert status="warning" borderRadius="12px" fontSize="sm">
              <AlertIcon />
              请管理员先配置飞书客服机器人。
            </Alert>
          )}
          <Flex
            align="center"
            justify="space-between"
            gap={3}
            bg="#eef1fc"
            borderRadius="14px"
            px={4}
            py={3}
          >
            <FormLabel
              htmlFor="app-handoff-enabled"
              mb={0}
              color="#202c45"
              fontWeight="semibold"
              fontSize="sm"
            >
              启用飞书转人工
            </FormLabel>
            <Switch
              id="app-handoff-enabled"
              isChecked={config.enabled}
              isDisabled={saving}
              onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
            />
          </Flex>
          <FormControl isRequired={config.enabled}>
            <FormLabel htmlFor="app-handoff-default-group" color="#202c45" fontSize="sm" mb={2}>
              接待客服组
            </FormLabel>
            <Select
              {...handoffFieldStyle}
              id="app-handoff-default-group"
              placeholder="请选择客服组"
              value={config.defaultGroupId ?? ''}
              isDisabled={saving || !data?.groups.length}
              onChange={(event) =>
                setConfig({ ...config, defaultGroupId: event.target.value || undefined })
              }
            >
              {data?.groups.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            {data?.groups.length === 0 && (
              <Text mt={2} fontSize="sm" color="#4c5b73">
                请管理员先到「团队管理 → 客服组」创建接待组。
              </Text>
            )}
          </FormControl>
        </Stack>
      )}
    </FeishuHandoffModal>
  );
}
