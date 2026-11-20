import React, { useCallback } from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { clearToken } from '@/web/support/user/auth';
import { useMount } from 'ahooks';
import LoginModal from '@/pageComponents/login/LoginModal';
import { useUserStore } from '@/web/support/user/useUserStore';
import { subRoute } from '@fastgpt/web/common/system/utils';
import { validateRedirectUrl } from '@/web/common/utils/uri';
import type { LoginSuccessResponseType } from '@fastgpt/global/openapi/support/user/account/login/api';
import { useLoginRedirectAfterLogin } from '@/web/support/user/loginRedirect';
import { resetUserModelCatalogAfterLogin } from '@/web/core/ai/model/useUserModelStore';
import { getFeishuLoginStartPath } from '@/web/support/user/loginRedirect/url';
import { serviceEnv } from '@fastgpt/service/env';

const Login = () => {
  const router = useRouter();
  const { lastRoute = '', lastTmbId = '' } = router.query as {
    lastRoute: string;
    lastTmbId?: string;
  };
  const { setUserInfo } = useUserStore();
  const resolveLoginRedirect = useLoginRedirectAfterLogin();

  const loginSuccess = useCallback(
    async (res: LoginSuccessResponseType) => {
      const decodeLastRoute = validateRedirectUrl(lastRoute);

      const navigateTo = await (async () => {
        if (decodeLastRoute.startsWith(`${subRoute}/config`)) {
          return '/dashboard/agent';
        }

        return decodeLastRoute;
      })();

      const targetRoute = navigateTo
        ? await resolveLoginRedirect({
            user: res.user,
            fallbackRoute: navigateTo,
            lastTmbId
          })
        : undefined;

      resetUserModelCatalogAfterLogin();
      setUserInfo(res.user);

      if (targetRoute) {
        router.replace(targetRoute);
      }
    },
    [lastRoute, lastTmbId, resolveLoginRedirect, router, setUserInfo]
  );

  useMount(() => {
    clearToken();
    router.prefetch('/dashboard/agent');
  });

  return <LoginModal onSuccess={loginSuccess} />;
};

export default Login;

export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  const { rootLogin, feishuError, loggedOut, lastRoute } = query;
  // 登录失败和主动退出停在本地页面，避免立刻发起下一次授权。
  if (
    !serviceEnv.FEISHU_ORG_ENABLED ||
    rootLogin === '1' ||
    feishuError === '1' ||
    loggedOut === '1'
  ) {
    return { props: {} };
  }

  return { redirect: { destination: getFeishuLoginStartPath(lastRoute), permanent: false } };
};
