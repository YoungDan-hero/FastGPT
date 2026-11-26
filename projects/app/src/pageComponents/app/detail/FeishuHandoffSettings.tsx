import React, { useState } from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Flex,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Switch,
  Text,
  Textarea
} from '@chakra-ui/react';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { useDebounce } from 'ahooks';
import MySelect from '@fastgpt/web/components/common/MySelect';
import { DatasetCollectionTypeEnum } from '@fastgpt/global/core/dataset/constants';
import {
  defaultFeishuHandoffAutoClose,
  feishuKnowledgeDatasetTypes,
  type FeishuHandoffConfig
} from '@fastgpt/global/core/app/feishuHandoff';
import { FeishuHandoffConfigBodySchema } from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
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
import { getDatasetById, getDatasetsV2 } from '@/web/core/dataset/api';
import { getDatasetCollectionById, getDatasetCollections } from '@/web/core/dataset/api/collection';
import FeishuHandoffKnowledgeReview from './FeishuHandoffKnowledgeReview';

/** 为当前 Agent 配置飞书客服接待、群结束时间和知识沉淀位置。 */
export default function FeishuHandoffSettings({
  appId,
  onClose
}: {
  appId: string;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<FeishuHandoffConfig>();
  const [showReview, setShowReview] = useState(false);
  const [datasetSearch, setDatasetSearch] = useState('');
  const searchKey = useDebounce(datasetSearch, { wait: 300 });
  const { data, loading, error, refresh } = useRequest(() => getFeishuHandoffConfig(appId), {
    manual: false,
    onSuccess: ({ config }) => setConfig(config)
  });
  const { run: save, loading: saving } = useRequest(updateFeishuHandoffConfig, {
    successToast: '人工客服配置已保存',
    onSuccess: onClose
  });
  const autoClose = config?.autoClose ?? defaultFeishuHandoffAutoClose;
  const mining = config?.knowledgeMining ?? { enabled: false, retainDays: 30 };
  const {
    data: datasetOptions = [],
    loading: loadingDatasets,
    error: datasetListError,
    refresh: reloadDatasets
  } = useRequest(
    async () => {
      if (!config?.enabled || !autoClose.enabled || !mining.enabled) return [];
      const type = [...feishuKnowledgeDatasetTypes];
      const [available, selected] = await Promise.all([
        getDatasetsV2({ searchKey: searchKey.trim(), type, pageSize: 50, offset: 0 }),
        mining.datasetId ? getDatasetById(mining.datasetId).catch(() => undefined) : undefined
      ]);
      const options = new Map(
        [...available.list, ...(selected ? [selected] : [])]
          .filter(
            (dataset) =>
              dataset.permission.hasWritePer && type.some((type) => type === dataset.type)
          )
          .map((dataset) => [dataset._id, dataset])
      );
      return Array.from(options.values());
    },
    {
      manual: false,
      errorToast: '',
      refreshDeps: [config?.enabled, autoClose.enabled, mining.enabled, mining.datasetId, searchKey]
    }
  );
  const validation = FeishuHandoffConfigBodySchema.safeParse({ appId, config });
  const setAutoClose = (patch: Partial<typeof autoClose>) =>
    setConfig((current) => current && { ...current, autoClose: { ...autoClose, ...patch } });
  const setMining = (patch: Partial<typeof mining>) =>
    setConfig((current) => current && { ...current, knowledgeMining: { ...mining, ...patch } });

  if (showReview) {
    return (
      <FeishuHandoffModal
        key="review"
        title="待审核客服问答"
        busy={saving}
        onClose={onClose}
        actions={
          <Button {...handoffSecondaryAction} onClick={() => setShowReview(false)}>
            返回设置
          </Button>
        }
      >
        <FeishuHandoffKnowledgeReview appId={appId} />
      </FeishuHandoffModal>
    );
  }

  return (
    <FeishuHandoffModal
      key="settings"
      title="人工客服设置"
      busy={saving}
      onClose={onClose}
      actions={
        <>
          {config?.knowledgeMining && (
            <Button
              {...handoffSecondaryAction}
              mr="auto"
              isDisabled={saving}
              onClick={() => setShowReview(true)}
            >
              待审核问答
            </Button>
          )}
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
              if (validation.success) save(validation.data);
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
          {config.enabled && (
            <Stack spacing={4} borderTop="1px solid" borderColor="#dce1ef" pt={4}>
              <Flex align="center" justify="space-between" gap={3}>
                <FormLabel
                  htmlFor="app-handoff-auto-close"
                  mb={0}
                  fontSize="sm"
                  fontWeight="semibold"
                >
                  自动解散客服群
                </FormLabel>
                <Switch
                  id="app-handoff-auto-close"
                  isChecked={autoClose.enabled}
                  isDisabled={saving}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setConfig({
                      ...config,
                      autoClose: { ...autoClose, enabled },
                      knowledgeMining: { ...mining, enabled: enabled && mining.enabled }
                    });
                  }}
                />
              </Flex>
              {autoClose.enabled && (
                <>
                  <Text fontSize="sm" color="#4c5b73">
                    新建客服群静默到期后，FastGPT 会先询问，再等待解散。任何人发言都会重新计时。
                  </Text>
                  <SimpleGrid columns={[1, 2]} spacing={3}>
                    <FormControl>
                      <FormLabel htmlFor="app-handoff-idle" fontSize="sm">
                        无人发言时长（分钟）
                      </FormLabel>
                      <Input
                        {...handoffFieldStyle}
                        id="app-handoff-idle"
                        type="number"
                        min={1}
                        max={1440}
                        value={autoClose.idleMinutes || ''}
                        isDisabled={saving}
                        onChange={(event) =>
                          setAutoClose({ idleMinutes: Number(event.target.value) })
                        }
                        isInvalid={autoClose.idleMinutes < 1 || autoClose.idleMinutes > 1440}
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel htmlFor="app-handoff-grace" fontSize="sm">
                        提醒后等待（分钟）
                      </FormLabel>
                      <Input
                        {...handoffFieldStyle}
                        id="app-handoff-grace"
                        type="number"
                        min={1}
                        max={120}
                        value={autoClose.graceMinutes || ''}
                        isDisabled={saving}
                        onChange={(event) =>
                          setAutoClose({ graceMinutes: Number(event.target.value) })
                        }
                        isInvalid={autoClose.graceMinutes < 1 || autoClose.graceMinutes > 120}
                      />
                    </FormControl>
                  </SimpleGrid>
                  <Box as="details" color="#4c5b73" fontSize="sm">
                    <Box as="summary" cursor="pointer" fontWeight="medium">
                      自定义提醒和告别语
                    </Box>
                    <Stack spacing={3} mt={3}>
                      <FormControl isRequired>
                        <FormLabel htmlFor="app-handoff-idle-prompt" fontSize="sm">
                          提醒语
                        </FormLabel>
                        <Textarea
                          {...handoffFieldStyle}
                          id="app-handoff-idle-prompt"
                          rows={2}
                          maxLength={300}
                          value={autoClose.prompt}
                          isDisabled={saving}
                          onChange={(event) => setAutoClose({ prompt: event.target.value })}
                        />
                        <FormHelperText>{'{minutes} 会替换为提醒后的等待分钟数。'}</FormHelperText>
                      </FormControl>
                      <FormControl>
                        <FormLabel htmlFor="app-handoff-farewell" fontSize="sm">
                          告别语
                        </FormLabel>
                        <Textarea
                          {...handoffFieldStyle}
                          id="app-handoff-farewell"
                          rows={2}
                          maxLength={300}
                          value={autoClose.farewell}
                          isDisabled={saving}
                          onChange={(event) => setAutoClose({ farewell: event.target.value })}
                        />
                      </FormControl>
                    </Stack>
                  </Box>
                  <Flex align="center" justify="space-between" gap={3}>
                    <FormLabel
                      htmlFor="app-handoff-mining"
                      mb={0}
                      fontSize="sm"
                      fontWeight="semibold"
                    >
                      沉淀客服问答
                    </FormLabel>
                    <Switch
                      id="app-handoff-mining"
                      isChecked={mining.enabled}
                      isDisabled={saving}
                      onChange={(event) => setMining({ enabled: event.target.checked })}
                    />
                  </Flex>
                  {mining.enabled && (
                    <Stack spacing={3} bg="#eef1fc" p={3} borderRadius="14px">
                      <Text fontSize="sm" color="#4c5b73">
                        解散前保存群聊，用知识库的文本理解模型整理客服答复。审核通过的问答会写入所选集合。
                      </Text>
                      <FormControl isRequired>
                        <FormLabel htmlFor="app-handoff-knowledge-target" fontSize="sm">
                          沉淀知识库
                        </FormLabel>
                        <Input
                          {...handoffFieldStyle}
                          aria-label="搜索知识库名称"
                          placeholder="搜索知识库名称"
                          mb={2}
                          value={datasetSearch}
                          onChange={(event) => setDatasetSearch(event.target.value)}
                          isDisabled={saving}
                        />
                        <Select
                          {...handoffFieldStyle}
                          id="app-handoff-knowledge-target"
                          placeholder={
                            loadingDatasets ? '正在加载知识库' : '请选择有写入权限的知识库'
                          }
                          value={mining.datasetId ?? ''}
                          isDisabled={saving}
                          onChange={(event) =>
                            setMining({
                              datasetId: event.target.value || undefined,
                              targetCollectionId: undefined
                            })
                          }
                        >
                          {datasetOptions.map(({ _id, name }) => (
                            <option key={_id} value={_id}>
                              {name}
                            </option>
                          ))}
                        </Select>
                        {datasetListError && (
                          <FormHelperText>
                            知识库列表加载失败。{' '}
                            <Button variant="link" size="sm" onClick={reloadDatasets}>
                              重试
                            </Button>
                          </FormHelperText>
                        )}
                      </FormControl>
                      {mining.datasetId && (
                        <FeishuHandoffCollectionSelect
                          key={mining.datasetId}
                          datasetId={mining.datasetId}
                          value={mining.targetCollectionId}
                          disabled={saving}
                          onChange={(id) => setMining({ targetCollectionId: id })}
                        />
                      )}
                      <FormControl>
                        <FormLabel htmlFor="app-handoff-retention" fontSize="sm">
                          群聊原文保留（天）
                        </FormLabel>
                        <Input
                          {...handoffFieldStyle}
                          id="app-handoff-retention"
                          type="number"
                          min={1}
                          max={90}
                          value={mining.retainDays || ''}
                          isDisabled={saving}
                          onChange={(event) =>
                            setMining({ retainDays: Number(event.target.value) })
                          }
                        />
                      </FormControl>
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          )}
        </Stack>
      )}
    </FeishuHandoffModal>
  );
}

/** 显示知识库中可写的手动录入集合，支持按名称搜索子目录。 */
function FeishuHandoffCollectionSelect({
  datasetId,
  value,
  disabled,
  onChange
}: {
  datasetId: string;
  value?: string;
  disabled: boolean;
  onChange: (value?: string) => void;
}) {
  const [search, setSearch] = useState('');
  const searchText = useDebounce(search, { wait: 300 });
  const {
    data: collections = [],
    loading,
    error,
    refresh
  } = useRequest(
    async () => {
      const { list } = await getDatasetCollections({
        datasetId,
        searchText: searchText.trim(),
        pageSize: 50,
        offset: 0,
        simple: true
      });
      const selected =
        value && !list.some(({ _id }) => _id === value)
          ? await getDatasetCollectionById(value).catch(() => undefined)
          : undefined;
      return [...list, ...(selected && String(selected.datasetId) === datasetId ? [selected] : [])]
        .filter(
          ({ type, forbid, permission }) =>
            type === DatasetCollectionTypeEnum.virtual && !forbid && permission.hasWritePer
        )
        .map(({ _id, name }) => ({ label: name, value: _id }));
    },
    { manual: false, errorToast: '', refreshDeps: [datasetId, searchText, value] }
  );

  return (
    <FormControl isRequired>
      <FormLabel htmlFor="app-handoff-knowledge-collection" fontSize="sm">
        写入集合
      </FormLabel>
      <MySelect
        {...handoffFieldStyle}
        id="app-handoff-knowledge-collection"
        value={value ?? ''}
        list={collections}
        placeholder={
          value ? (loading ? '正在加载集合' : '当前集合不可用') : '请选择库内的手动录入集合'
        }
        onChange={(id) => onChange(id || undefined)}
        isDisabled={disabled}
        isListLoading={loading}
        isSearch
        onSearchChange={setSearch}
      />
      {error && (
        <FormHelperText>
          集合列表加载失败。{' '}
          <Button variant="link" size="sm" onClick={refresh}>
            重试
          </Button>
        </FormHelperText>
      )}
      {collections.length > 0 && (
        <FormHelperText>建议使用专门存放客服问答的手动录入集合。</FormHelperText>
      )}
      {!loading && !error && collections.length === 0 && !searchText.trim() && (
        <FormHelperText>该知识库暂无可写的手动录入集合，可在知识库中先新建一个。</FormHelperText>
      )}
    </FormControl>
  );
}
