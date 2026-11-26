import React, { useState } from 'react';
import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  Select,
  Stack,
  Text,
  Textarea
} from '@chakra-ui/react';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import type {
  FeishuHandoffDatasetKnowledgePage,
  FeishuHandoffKnowledgeList
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import {
  handoffFieldStyle,
  handoffPrimaryAction,
  handoffSecondaryAction
} from '@/components/core/chat/ChatContainer/ChatBox/components/FeishuHandoffModal';
import {
  getDatasetFeishuHandoffKnowledge,
  getFeishuHandoffKnowledge,
  submitFeishuHandoffKnowledgeReview
} from '@/web/core/app/api/feishuHandoff';

type ReviewProps = { appId: string; datasetId?: never } | { datasetId: string; appId?: never };
const pageSize = 20;
const legacyCollectionLabel = '自动沉淀集合（历史）';

/** 在应用或目标知识库内对照客服原话，调整问答后发布到指定集合。 */
export default function FeishuHandoffKnowledgeReview({ appId, datasetId }: ReviewProps) {
  type Candidate = FeishuHandoffKnowledgeList[number];
  const [draft, setDraft] = useState<Candidate>();
  const [reason, setReason] = useState<string>();
  const [targetCollectionId, setTargetCollectionId] = useState<string>();
  const [pageNum, setPageNum] = useState(1);
  const { data, loading, error, refresh } = useRequest(
    async (): Promise<FeishuHandoffDatasetKnowledgePage> => {
      if (datasetId) {
        return getDatasetFeishuHandoffKnowledge({
          datasetId,
          targetCollectionId,
          pageNum,
          pageSize
        });
      }
      const list = await getFeishuHandoffKnowledge(appId);
      return { list, total: list.length, collections: [] };
    },
    {
      manual: false,
      refreshDeps: [appId, datasetId, targetCollectionId, pageNum],
      onSuccess: ({ total, collections }) => {
        if (targetCollectionId && !collections.some(({ id }) => id === targetCollectionId)) {
          setTargetCollectionId(undefined);
          setPageNum(1);
          return;
        }
        const lastPage = Math.max(1, Math.ceil(total / pageSize));
        if (pageNum > lastPage) setPageNum(lastPage);
      }
    }
  );
  const { run: submit, loading: submitting } = useRequest(submitFeishuHandoffKnowledgeReview, {
    successToast: '审核结果已保存',
    onSuccess: () => {
      setDraft(undefined);
      setReason(undefined);
      refresh();
    }
  });

  if (loading && !data)
    return (
      <Text role="status" fontSize="sm">
        正在读取待审核问答
      </Text>
    );
  if (error)
    return (
      <Button {...handoffSecondaryAction} onClick={refresh}>
        重新加载
      </Button>
    );
  if (!draft) {
    const list = data?.list ?? [];
    const total = data?.total ?? 0;
    const collections = data?.collections ?? [];
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    return (
      <Stack spacing={3}>
        {datasetId && collections.length > 0 && (
          <FormControl maxW="280px">
            <FormLabel htmlFor="handoff-review-collection-filter" fontSize="sm">
              写入集合
            </FormLabel>
            <Select
              {...handoffFieldStyle}
              id="handoff-review-collection-filter"
              value={targetCollectionId ?? ''}
              onChange={(event) => {
                setTargetCollectionId(event.target.value || undefined);
                setPageNum(1);
              }}
            >
              <option value="">全部集合</option>
              {collections.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name ?? '集合不可用'}
                </option>
              ))}
            </Select>
          </FormControl>
        )}
        {loading ? (
          <Text role="status" fontSize="sm">
            正在读取待审核问答
          </Text>
        ) : list.length === 0 ? (
          <Text fontSize="sm" color="#4c5b73">
            暂无待审核的客服问答。
          </Text>
        ) : (
          list.map((item) => {
            const collectionName =
              item.collectionName === null ? '集合不可用' : item.collectionName;
            const subtitle = datasetId
              ? `${item.appName} · ${collectionName ?? legacyCollectionLabel}`
              : [item.datasetName, collectionName].filter(Boolean).join(' / ');
            return (
              <Button
                key={item.id}
                variant="ghost"
                justifyContent="flex-start"
                h="auto"
                py={3}
                textAlign="left"
                fontWeight="medium"
                borderRadius="12px"
                bg="#eef1fc"
                onClick={() => setDraft(item)}
              >
                <Box minW={0}>
                  <Text whiteSpace="normal" fontSize="sm">
                    {item.question}
                  </Text>
                  <Text mt={1} color="#4c5b73" fontSize="xs">
                    {subtitle}
                  </Text>
                </Box>
              </Button>
            );
          })
        )}
        {datasetId && (pageNum > 1 || lastPage > 1) && (
          <Flex justify="flex-end" align="center" gap={2} wrap="wrap">
            <Text fontSize="sm" color="#4c5b73">
              共 {total} 条
            </Text>
            <Button
              size="sm"
              variant="whitePrimaryOutline"
              isDisabled={loading || pageNum <= 1}
              onClick={() => setPageNum(pageNum - 1)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="whitePrimaryOutline"
              isDisabled={loading || pageNum >= lastPage}
              onClick={() => setPageNum(pageNum + 1)}
            >
              下一页
            </Button>
          </Flex>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Button
        {...handoffSecondaryAction}
        alignSelf="flex-start"
        isDisabled={submitting}
        onClick={() => {
          setDraft(undefined);
          setReason(undefined);
        }}
      >
        返回待审核列表
      </Button>
      {!appId && (
        <Text fontSize="sm" color="#4c5b73">
          来自应用「{draft.appName}」
        </Text>
      )}
      <Text fontSize="sm" color="#4c5b73">
        写入「{draft.datasetName}
        {draft.collectionName && ` / ${draft.collectionName}`}」
      </Text>
      {draft.collectionName === null && (
        <Text fontSize="sm" color="red.700">
          所选集合已不可用，请检查集合和写入权限。
        </Text>
      )}
      <FormControl>
        <FormLabel htmlFor="handoff-review-question" fontSize="sm">
          问题
        </FormLabel>
        <Input
          {...handoffFieldStyle}
          id="handoff-review-question"
          maxLength={240}
          value={draft.question}
          onChange={(event) => setDraft({ ...draft, question: event.target.value })}
          isDisabled={submitting}
        />
      </FormControl>
      <FormControl>
        <FormLabel htmlFor="handoff-review-answer" fontSize="sm">
          回答
        </FormLabel>
        <Textarea
          {...handoffFieldStyle}
          id="handoff-review-answer"
          maxLength={1000}
          rows={4}
          value={draft.answer}
          onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
          isDisabled={submitting}
        />
      </FormControl>
      <Box as="details" bg="#eef1fc" px={3} py={2} borderRadius="12px">
        <Box as="summary" fontSize="sm" cursor="pointer">
          客服原话
        </Box>
        <Stack spacing={2} my={2} fontSize="sm" color="#4c5b73">
          {draft.partialHistory && <Text>群聊较长，仅保留最近的部分记录。</Text>}
          {draft.evidence.length === 0 ? (
            <Text>原始群聊已过保留期。</Text>
          ) : (
            draft.evidence.map((text, index) => (
              <Text key={index} whiteSpace="pre-wrap">
                {text}
              </Text>
            ))
          )}
        </Stack>
      </Box>
      {reason !== undefined && (
        <FormControl isRequired>
          <FormLabel htmlFor="handoff-review-reason" fontSize="sm">
            驳回原因
          </FormLabel>
          <Textarea
            {...handoffFieldStyle}
            id="handoff-review-reason"
            value={reason}
            maxLength={300}
            rows={2}
            isDisabled={submitting}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormControl>
      )}
      <Flex gap={2} justify="flex-end" mt={1}>
        <Button
          {...handoffSecondaryAction}
          isDisabled={submitting || reason?.trim() === ''}
          onClick={() => {
            if (reason === undefined) setReason('');
            else
              void submit({
                appId: draft.appId,
                ...(datasetId && { datasetId }),
                action: 'reject',
                candidateId: draft.id,
                reason
              });
          }}
        >
          {reason === undefined ? '驳回' : '确认驳回'}
        </Button>
        <Button
          {...handoffPrimaryAction}
          isLoading={submitting}
          isDisabled={
            draft.collectionName === null || !draft.question.trim() || !draft.answer.trim()
          }
          onClick={() =>
            void submit({
              appId: draft.appId,
              ...(datasetId && { datasetId }),
              action: 'publish',
              candidateId: draft.id,
              question: draft.question,
              answer: draft.answer
            })
          }
        >
          通过并入库
        </Button>
      </Flex>
    </Stack>
  );
}
