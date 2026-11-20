import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { LoginContainer } from '@/pageComponents/login';
import I18nLngSelector from '@/components/Select/I18nLngSelector';
import { type LoginSuccessResponseType } from '@fastgpt/global/openapi/support/user/account/login/api';

type LoginModalProps = {
  onSuccess: (e: LoginSuccessResponseType) => any;
};

const LoginModal = ({ onSuccess }: LoginModalProps) => {
  return (
    <Flex
      position="relative"
      isolation="isolate"
      alignItems="center"
      justifyContent="center"
      minH="100vh"
      px={[4, 8]}
      py={['76px', '88px']}
      bg="#e6ecf8"
      bgImage="radial-gradient(ellipse at 40% 0%, #f9fcff 0%, transparent 62%), radial-gradient(ellipse at 8% 92%, #b2cdec 0%, transparent 60%), radial-gradient(ellipse at 93% 26%, #c5c6f3 0%, transparent 58%)"
      sx={{
        '@supports (min-height: 100svh)': { minHeight: '100svh' }
      }}
    >
      <Box
        aria-hidden="true"
        position="absolute"
        inset={0}
        overflow="hidden"
        zIndex={-1}
        pointerEvents="none"
        _before={{
          content: '""',
          position: 'absolute',
          left: '50%',
          top: '50%',
          w: 'clamp(42rem, 80vw, 80rem)',
          h: 'clamp(12rem, 24vw, 26rem)',
          transform: 'translate(-74%, -55%) rotate(-31deg)',
          borderRadius: '46% 54% 44% 56% / 52% 61% 39% 48%',
          border: '1px solid rgba(255, 255, 255, 0.75)',
          bgImage:
            'linear-gradient(174deg, rgba(255, 255, 255, 0.78), rgba(238, 245, 255, 0.26) 42%, rgba(117, 155, 223, 0.34))',
          boxShadow:
            'inset 0 2px 16px rgba(255, 255, 255, 0.54), 0 30px 84px rgba(52, 83, 148, 0.17)'
        }}
        _after={{
          content: '""',
          position: 'absolute',
          left: '50%',
          top: '50%',
          w: 'clamp(34rem, 72vw, 72rem)',
          h: 'clamp(10rem, 20vw, 22rem)',
          transform: 'translate(-15%, -36%) rotate(-31deg)',
          borderRadius: '53% 47% 55% 45% / 46% 57% 43% 54%',
          border: '1px solid rgba(255, 255, 255, 0.7)',
          bgImage:
            'linear-gradient(174deg, rgba(255, 255, 255, 0.7), rgba(236, 237, 255, 0.28) 46%, rgba(135, 150, 223, 0.29))',
          boxShadow:
            'inset 0 2px 18px rgba(255, 255, 255, 0.56), 0 24px 72px rgba(62, 78, 153, 0.16)'
        }}
      />

      <Box position="absolute" top={[4, 6]} right={[4, 6]} zIndex={10}>
        <I18nLngSelector />
      </Box>

      <Flex
        flexDirection="column"
        w="full"
        maxW="512px"
        px={['clamp(20px, 7vw, 65px)', '65px']}
        py={['36px', '48px']}
        border="1px solid rgba(255, 255, 255, 0.88)"
        borderRadius={['28px', '34px']}
        bg="#f7faff"
        boxShadow="0 30px 84px -24px rgba(44, 67, 135, 0.38), 0 4px 16px rgba(44, 67, 135, 0.08), inset 0 1px 0 #fff"
        sx={{
          '@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
            background:
              'linear-gradient(145deg, rgba(255, 255, 255, 0.78), rgba(245, 249, 255, 0.38))',
            backdropFilter: 'blur(26px) saturate(135%)',
            WebkitBackdropFilter: 'blur(26px) saturate(135%)'
          },
          '@media (prefers-reduced-transparency: reduce)': {
            background: '#f7faff',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none'
          }
        }}
      >
        <LoginContainer onSuccess={onSuccess} />
      </Flex>
    </Flex>
  );
};

export default LoginModal;
