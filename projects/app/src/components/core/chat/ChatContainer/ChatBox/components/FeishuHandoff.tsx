import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Select,
  Stack,
  Text,
  Textarea
} from '@chakra-ui/react';
import MyIcon from '@fastgpt/web/components/common/Icon';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { ChatRoleEnum, ChatStatusEnum } from '@fastgpt/global/core/chat/constants';
import { getChatItemTextContent } from '@fastgpt/global/core/chat/utils';
import {
  getFeishuHandoffMessageText,
  getFeishuHandoffRequest
} from '@fastgpt/global/core/app/feishuHandoff';
import type {
  FeishuHandoffBody,
  FeishuHandoffTurn
} from '@fastgpt/global/openapi/core/app/feishuHandoff/api';
import { postFeishuHandoff } from '@/web/core/app/api/feishuHandoff';
import type { ChatSiteItemType } from '../type';
import {
  FeishuHandoffModal,
  handoffFieldStyle,
  handoffPrimaryAction,
  handoffSecondaryAction
} from './FeishuHandoffModal';

type ChatTarget = Pick<FeishuHandoffBody, 'appId' | 'chatId' | 'outLinkAuthData'>;
type TurnPreview = FeishuHandoffTurn & {
  question: string;
  answer?: string;
  standaloneRequest: boolean;
};
const HandoffContext = createContext<
  | {
      answerIds: Set<string>;
      open: (answerId: string) => void;
    }
  | undefined
>(undefined);

/** 将回复中的客服入口渲染为可预览交接内容的会话卡片。 */
export function FeishuHandoffCard({
  children,
  answerId
}: {
  children?: ReactNode;
  answerId?: string;
}) {
  const handoff = useContext(HandoffContext);
  if (!handoff || !answerId) return <>{children}</>;
  if (!handoff.answerIds.has(answerId)) return null;

  return (
    <Flex
      as="span"
      display="inline-flex"
      align="center"
      wrap="wrap"
      gap={3}
      w="full"
      maxW="460px"
      px={3}
      py={3}
      border="1px solid"
      borderColor="#dce1ef"
      borderRadius="16px"
      bgGradient="linear(to-br, whiteAlpha.800, #eef1fc)"
    >
      <Flex as="span" align="center" gap={2} flex="1 1 230px" color="#303b59">
        <MyIcon
          name="core/app/headphones"
          boxSize="18px"
          flexShrink={0}
          color="#4147a2"
          aria-hidden
        />
        <Text as="span" fontSize="sm" lineHeight="shorter">
          可以请人工客服在飞书群继续处理。
        </Text>
      </Flex>
      <Button
        {...handoffPrimaryAction}
        type="button"
        aria-haspopup="dialog"
        flexShrink={0}
        onClick={() => handoff.open(answerId)}
      >
        {children ?? '转人工客服'}
      </Button>
    </Flex>
  );
}

/** 从已加载的可见消息中按顺序配对提问和回答。 */
function getTurnPreviews(records: readonly ChatSiteItemType[]) {
  const messages = records.filter(
    ({ obj }) => obj === ChatRoleEnum.Human || obj === ChatRoleEnum.AI
  );
  return messages
    .flatMap<TurnPreview>((item, index) => {
      if (item.obj !== ChatRoleEnum.Human || item.hideInUI || item.deleteTime || !item.dataId)
        return [];

      const next = messages[index + 1];
      const answer =
        next?.obj === ChatRoleEnum.AI &&
        next.status === ChatStatusEnum.finish &&
        !next.hideInUI &&
        !next.deleteTime
          ? next
          : undefined;
      return [
        {
          questionId: item.dataId,
          question: getFeishuHandoffMessageText(item.value),
          answerId: answer?.dataId,
          answer: answer ? getFeishuHandoffMessageText(answer.value) : undefined,
          standaloneRequest:
            getFeishuHandoffRequest(getChatItemTextContent(item.value)) === 'standalone'
        }
      ];
    })
    .reverse();
}

/** 卡片预选所在轮次。单独的转人工指令优先交接此前的业务问答。 */
export function FeishuHandoffChat({
  target,
  enabled,
  records,
  children
}: {
  target?: ChatTarget;
  enabled: boolean;
  records: readonly ChatSiteItemType[];
  children: ReactNode;
}) {
  const [openFor, setOpenFor] = useState<{ key: string; answerId: string }>();
  const key =
    target && JSON.stringify([target.appId, target.chatId, target.outLinkAuthData?.shareId]);
  const turns = useMemo(() => (enabled ? getTurnPreviews(records) : []), [enabled, records]);
  const controls = useMemo(
    () =>
      key && enabled
        ? {
            answerIds: new Set(turns.flatMap(({ answerId }) => (answerId ? [answerId] : []))),
            open: (answerId: string) => setOpenFor({ key, answerId })
          }
        : undefined,
    [key, enabled, turns]
  );
  const index =
    openFor && openFor.key === key
      ? turns.findIndex((turn) => turn.answerId === openFor.answerId)
      : -1;
  const current = turns[index];
  const initialTurn = current?.standaloneRequest
    ? (turns
        .slice(index + 1)
        .find((turn) => !turn.standaloneRequest && (turn.question || turn.answer)) ?? current)
    : current;

  return (
    <HandoffContext.Provider value={controls}>
      {children}
      {target && initialTurn && (
        <FeishuHandoffDialog
          key={key}
          target={target}
          turns={turns}
          initialQuestionId={initialTurn.questionId}
          onClose={() => setOpenFor(undefined)}
        />
      )}
    </HandoffContext.Provider>
  );
}

function FeishuHandoffDialog({
  target,
  turns,
  initialQuestionId,
  onClose
}: {
  target: ChatTarget;
  turns: TurnPreview[];
  initialQuestionId: string;
  onClose: () => void;
}) {
  const [questionId, setQuestionId] = useState(initialQuestionId);
  const [note, setNote] = useState('');
  const { run, loading, data: result } = useRequest(postFeishuHandoff);
  const turn = turns.find((item) => item.questionId === questionId);

  return (
    <FeishuHandoffModal
      title={result ? '已转人工' : '转给飞书人工客服'}
      busy={loading}
      success={Boolean(result)}
      onClose={onClose}
      actions={
        <>
          <Button {...handoffSecondaryAction} isDisabled={loading} onClick={onClose}>
            {result ? '关闭' : '取消'}
          </Button>
          {result ? (
            <Button
              {...handoffPrimaryAction}
              as="a"
              href={result.chatUrl}
              target="_blank"
              rel="noopener noreferrer"
              rightIcon={<MyIcon name="common/arrowRight" w="16px" h="16px" aria-hidden />}
            >
              打开飞书群
            </Button>
          ) : (
            <Button
              {...handoffPrimaryAction}
              type="button"
              isLoading={loading}
              isDisabled={!turn}
              loadingText="正在转接…"
              onClick={() => {
                if (turn) {
                  run({
                    ...target,
                    turn: { questionId: turn.questionId, answerId: turn.answerId },
                    note: note.trim() || undefined,
                    confirmed: true
                  });
                }
              }}
            >
              确认转人工
            </Button>
          )}
        </>
      }
    >
      {result ? (
        <Text role="status" fontSize="sm" color="#4c5b73" lineHeight="tall" overflowWrap="anywhere">
          已将所选问答交给
          <Text as="strong" color="#202c45">
            「{result.groupName}」
          </Text>
          。请到飞书群与客服继续沟通。
        </Text>
      ) : (
        <Stack spacing={4}>
          {turns.length > 1 && (
            <FormControl>
              <FormLabel htmlFor="feishu-handoff-turn" fontSize="sm" color="#202c45" mb={2}>
                要交接的问答
              </FormLabel>
              <Select
                {...handoffFieldStyle}
                id="feishu-handoff-turn"
                value={questionId}
                placeholder="请选择一轮问答"
                isDisabled={loading}
                onChange={(event) => setQuestionId(event.target.value)}
              >
                {turns.map((item) => (
                  <option key={item.questionId} value={item.questionId}>
                    {item.question.replace(/\s+/g, ' ').slice(0, 36) || '仅附件或交互消息'}
                  </option>
                ))}
              </Select>
            </FormControl>
          )}
          {turn && (
            <Box bg="#f8f9fe" border="1px solid" borderColor="#dce1ef" borderRadius="14px" p={4}>
              <Text mb={3} color="#202c45" fontWeight="semibold" fontSize="sm">
                将发到飞书客服群
              </Text>
              <Stack as="dl" spacing={3} maxH="200px" overflowY="auto">
                <Box>
                  <Text as="dt" fontSize="xs" fontWeight="semibold" color="#4147a2">
                    问题
                  </Text>
                  <Text as="dd" fontSize="sm" mt={1} whiteSpace="pre-wrap" overflowWrap="anywhere">
                    {turn.question || '这轮没有文字提问'}
                  </Text>
                </Box>
                <Box>
                  <Text as="dt" fontSize="xs" fontWeight="semibold" color="#4147a2">
                    回答
                  </Text>
                  <Text as="dd" fontSize="sm" mt={1} whiteSpace="pre-wrap" overflowWrap="anywhere">
                    {turn.answer || '这轮没有文字回答'}
                  </Text>
                </Box>
              </Stack>
            </Box>
          )}
          <FormControl>
            <FormLabel htmlFor="feishu-handoff-note" fontSize="sm" color="#202c45" mb={2}>
              补充说明
              <Text as="span" ml={2} color="#626f87" fontWeight="normal">
                选填
              </Text>
            </FormLabel>
            <Textarea
              {...handoffFieldStyle}
              id="feishu-handoff-note"
              value={note}
              isDisabled={loading}
              minH="84px"
              maxLength={500}
              placeholder="填写需要一起发给客服的信息"
              _placeholder={{ color: '#626f87' }}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormControl>
        </Stack>
      )}
    </FeishuHandoffModal>
  );
}
