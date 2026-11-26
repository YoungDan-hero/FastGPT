import React, { type ReactNode } from 'react';
import {
  Flex,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  usePrefersReducedMotion,
  type ButtonProps
} from '@chakra-ui/react';
import MyIcon from '@fastgpt/web/components/common/Icon';

export const handoffPrimaryAction = {
  variant: 'unstyled',
  display: 'inline-flex',
  minH: '44px',
  px: 4,
  fontSize: 'sm',
  fontWeight: 'semibold',
  borderRadius: '12px',
  color: 'white',
  bgGradient: 'linear(to-br, #4e54ba, #363b90)',
  boxShadow: '0 5px 12px rgba(54, 59, 144, .24), inset 0 1px 0 rgba(255, 255, 255, .18)',
  transition: 'box-shadow 150ms ease, transform 150ms ease',
  _hover: {
    bgGradient: 'linear(to-br, #4449ac, #2e337c)',
    boxShadow: '0 7px 16px rgba(54, 59, 144, .30), inset 0 1px 0 rgba(255, 255, 255, .18)'
  },
  _active: { transform: 'scale(.98)' },
  _focusVisible: { outline: '2px solid #494caf', outlineOffset: '3px' },
  sx: { '@media (prefers-reduced-motion: reduce)': { transition: 'none', transform: 'none' } }
} satisfies ButtonProps;

export const handoffSecondaryAction = {
  type: 'button',
  variant: 'ghost',
  minH: '44px',
  color: '#4c5b73',
  borderRadius: '12px',
  _hover: { bg: '#e8ebf7' }
} satisfies ButtonProps;

export const handoffFieldStyle = {
  minH: '44px',
  borderRadius: '12px',
  bg: '#f8f9fe',
  borderColor: '#dce1ef',
  color: '#202c45',
  fontSize: 'sm',
  _hover: { borderColor: '#aeb8db' },
  _focusVisible: { borderColor: '#555cc2', boxShadow: '0 0 0 3px #555cc222' }
};

/** 应用设置和聊天转接共用视觉外壳，并在提交期间保护确认状态。 */
export function FeishuHandoffModal({
  title,
  busy,
  success = false,
  onClose,
  children,
  actions
}: {
  title: string;
  busy: boolean;
  success?: boolean;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <Modal
      isOpen
      isCentered
      scrollBehavior="inside"
      motionPreset={prefersReducedMotion ? 'none' : 'scale'}
      onClose={() => !busy && onClose()}
      closeOnOverlayClick={!busy}
      closeOnEsc={!busy}
      blockScrollOnMount={false}
      allowPinchZoom
    >
      <ModalOverlay bg="rgba(31, 39, 71, .28)" backdropFilter="blur(5px)" />
      <ModalContent
        w="calc(100% - 32px)"
        maxW="460px"
        maxH="calc(100dvh - 32px)"
        my={4}
        borderRadius="24px"
        border="1px solid"
        borderColor="whiteAlpha.800"
        bg="transparent"
        isolation="isolate"
        // 毛玻璃放在背景层，避免改变下拉菜单的固定定位基准。
        _before={{
          content: '""',
          position: 'absolute',
          inset: 0,
          zIndex: -1,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          bg: 'rgba(247, 249, 255, .72)',
          bgImage: 'linear-gradient(145deg, rgba(255, 255, 255, .92), rgba(240, 244, 255, .8))',
          backdropFilter: 'blur(18px) saturate(130%)'
        }}
        boxShadow="0 28px 80px rgba(33, 40, 78, .22), 0 4px 14px rgba(33, 40, 78, .08)"
      >
        <ModalHeader display="flex" alignItems="center" gap={3} px={6} pt={6} pb={0} pr="64px">
          <Flex
            boxSize="44px"
            flexShrink={0}
            borderRadius="14px"
            align="center"
            justify="center"
            bg={success ? '#e3f4ec' : '#e8ebfc'}
            color={success ? '#17644d' : '#4147a2'}
          >
            <MyIcon
              name={success ? 'common/check' : 'core/app/headphones'}
              w="22px"
              h="22px"
              aria-hidden
            />
          </Flex>
          <Text
            as="span"
            color="#202c45"
            fontSize="xl"
            fontWeight="semibold"
            lineHeight="shorter"
            sx={{ textWrap: 'balance' }}
          >
            {title}
          </Text>
        </ModalHeader>
        <ModalCloseButton
          top={3}
          right={3}
          boxSize="44px"
          borderRadius="12px"
          color="#52617a"
          _hover={{ bg: '#e8ebf7' }}
          aria-label="关闭人工客服弹窗"
          isDisabled={busy}
        />
        <ModalBody px={6} pt={4} pb={0}>
          {children}
        </ModalBody>
        <ModalFooter px={6} py={6} gap={2}>
          {actions}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
