import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { LOGO_ICON } from '@fastgpt/global/common/system/constants';
import MyIcon from '@fastgpt/web/components/common/Icon';
import MyImage from '@fastgpt/web/components/common/Image/MyImage';
import { getWebReqUrl } from '@fastgpt/web/common/system/utils';
import { LoginPageTypeEnum } from '@/web/support/user/login/constants';
import {
  resolveAutoLoginProvider,
  resolveInitialLoginPageType
} from '@/web/support/user/login/utils';
import type { LoginMethodItem } from '@/web/support/user/login/utils';
import { useSystemStore } from '@/web/common/system/useSystemStore';
import { useChatStore } from '@/web/core/chat/context/useChatStore';
import ChineseRedirectModal from './components/ChineseRedirectModal';
import CookieConsentModal from './components/CookieConsentModal';
import LoginFormPanel from './components/LoginFormPanel';
import type { LoginSuccessResponseType } from '@fastgpt/global/openapi/support/user/account/login/api';
import { useRouter } from 'next/router';
import { getFeishuLoginStartPath } from '@/web/support/user/loginRedirect/url';
import { checkIsWecomTerminal } from '@fastgpt/global/support/user/login/constants';
import { useLoginMethods } from './LoginForm/useLoginMethods';
import LoginGuideLink from './LoginForm/LoginGuideLink';

type LoginSuccessHandler = (res: LoginSuccessResponseType) => void | Promise<void>;

/** 等待系统配置和自动登录结果，避免方式选择页在自动跳转前短暂闪现。 */
export const LoginContainer = ({
  children,
  onSuccess
}: {
  children?: React.ReactNode;
  onSuccess: LoginSuccessHandler;
}) => {
  const router = useRouter();
  const { initd, feConfigs } = useSystemStore();
  const { resetChatCache } = useChatStore();
  const loginGuideDocUrl = feConfigs?.loginGuideDocUrl?.trim();
  const initializedRef = useRef(false);

  const [selectedPageType, setPageType] = useState<`${LoginPageTypeEnum}`>();
  const [autoLoginFailed, setAutoLoginFailed] = useState(false);
  const { startLogin } = useLoginMethods({
    mode: 'selection',
    pageType: LoginPageTypeEnum.methodSelection,
    setPageType
  });
  const rootLogin = router.query.rootLogin === '1';
  const feishuOrgLogin = feConfigs?.feishuOrgLogin === true && !rootLogin;
  const isWecomTerminal = typeof navigator === 'undefined' ? false : checkIsWecomTerminal();
  const initialPageType = resolveInitialLoginPageType({
    rootLogin,
    // 共享策略消费服务端派生的 SSO 能力，不需要下发 SSO 根地址。
    sso: feConfigs?.sso
  });
  const autoLoginProvider = resolveAutoLoginProvider({
    rootLogin,
    ssoAvailable: feConfigs?.sso?.enabled === true,
    ssoAutoLogin: feConfigs?.sso?.autoLogin === true,
    wecomAvailable: Boolean(feConfigs?.oauth?.wecom),
    isWecomTerminal,
    canWecomTerminalAutoRedirect: !isWecomTerminal || feConfigs?.wecomLoginAutoRedirect === true
  });
  // 自动跳转渠道（含仅终端内可用的企业微信）不一定出现在可选按钮列表里，
  // 这里按 Provider 直接构造跳转入口，与旧实现 onClickOauth({ provider }) 的口径一致。
  const autoLoginMethod = useMemo<LoginMethodItem | undefined>(
    () =>
      autoLoginProvider
        ? {
            id: `oauth:${autoLoginProvider}`,
            type: 'oauth',
            provider: autoLoginProvider,
            label: ''
          }
        : undefined,
    [autoLoginProvider]
  );
  const pageType =
    selectedPageType ??
    (initd && (!autoLoginMethod || autoLoginFailed) ? initialPageType : undefined);

  const loginSuccess = useCallback(
    async (res: LoginSuccessResponseType) => {
      await onSuccess?.(res);
    },
    [onSuccess]
  );

  useEffect(() => {
    resetChatCache();
  }, [feConfigs?.oauth?.wechat, resetChatCache]);

  useEffect(() => {
    // 配置暂不可用后可能由既有轮询恢复；只有实际开始自动登录才消耗唯一尝试。
    if (!initd || initializedRef.current || !autoLoginMethod || feishuOrgLogin) return;
    initializedRef.current = true;

    void startLogin(autoLoginMethod).catch(() => setAutoLoginFailed(true));
  }, [autoLoginMethod, initd, startLogin, feishuOrgLogin]);

  return (
    <>
      <Flex
        my={['', pageType === LoginPageTypeEnum.wechat ? '-15px' : '']}
        position="relative"
        w="full"
        flexDirection="column"
      >
        {feishuOrgLogin ? (
          <Flex direction="column" align="center" textAlign="center" w="full">
            <Flex
              boxSize="64px"
              align="center"
              justify="center"
              mb={4}
              borderRadius="20px"
              border="1px solid rgba(255, 255, 255, 0.94)"
              bg="linear-gradient(145deg, #fff, rgba(225, 234, 254, 0.72))"
              boxShadow="0 8px 22px rgba(49, 77, 149, 0.13), inset 0 1px 0 #fff"
            >
              <MyImage src={LOGO_ICON} boxSize="36px" alt="" />
            </Flex>
            <Text
              as="h1"
              mb={8}
              fontSize="clamp(28px, 6vw, 34px)"
              fontWeight="bold"
              lineHeight="1.15"
              letterSpacing="-0.035em"
              color="myGray.900"
              overflowWrap="anywhere"
            >
              {feConfigs?.systemTitle || 'FastGPT'}
            </Text>
            <Button
              as="a"
              w="full"
              h="52px"
              borderRadius="14px"
              fontSize="md"
              fontWeight="semibold"
              bg="linear-gradient(140deg, #405fcf, #2e48aa)"
              boxShadow="0 8px 20px rgba(46, 72, 170, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.26)"
              _hover={{ filter: 'brightness(1.06)' }}
              _focusVisible={{ outline: '2px solid #304bad', outlineOffset: '3px' }}
              leftIcon={
                <Flex
                  as="span"
                  aria-hidden="true"
                  boxSize="25px"
                  align="center"
                  justify="center"
                  borderRadius="7px"
                  bg="white"
                >
                  <MyIcon name="core/app/publish/lark" w="17px" h="17px" />
                </Flex>
              }
              href={getWebReqUrl(
                getFeishuLoginStartPath(
                  router.pathname === '/chat' ? router.asPath : router.query.lastRoute
                )
              )}
            >
              使用飞书登录
            </Button>
            {router.query.feishuError === '1' && (
              <Text
                role="alert"
                mt={4}
                px={3}
                py={2}
                borderRadius="10px"
                bg="red.50"
                color="red.700"
                fontSize="sm"
                textAlign="left"
              >
                飞书登录未完成，请重试，或请管理员确认你在应用可用范围内。
              </Text>
            )}
          </Flex>
        ) : (
          <LoginFormPanel
            pageType={pageType}
            setPageType={setPageType}
            loginSuccess={loginSuccess}
            reserveLoginGuideSpace={
              pageType === LoginPageTypeEnum.passwordLogin && Boolean(loginGuideDocUrl)
            }
          />
        )}

        {children}

        {(feishuOrgLogin || pageType === LoginPageTypeEnum.passwordLogin) && (
          <LoginGuideLink mt={feishuOrgLogin ? 5 : 8} />
        )}
      </Flex>

      <CookieConsentModal />
      <ChineseRedirectModal />
    </>
  );
};

export default LoginContainer;
