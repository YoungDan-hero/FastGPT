import React, { useEffect } from 'react';
import type { GetServerSideProps } from 'next';
import Loading from '@fastgpt/web/components/common/MyLoading';
import { useRouter } from 'next/router';
import { TokenName } from '@fastgpt/service/support/permission/auth/common';
import { serviceEnv } from '@fastgpt/service/env';
import { getFeishuLoginStartPath } from '@/web/support/user/loginRedirect/url';

const index = () => {
  const router = useRouter();
  useEffect(() => {
    router.push('/dashboard/agent');
  }, [router]);
  return <Loading></Loading>;
};

export default index;

export const getServerSideProps: GetServerSideProps = async ({ req }) =>
  serviceEnv.FEISHU_ORG_ENABLED && !req.cookies[TokenName]
    ? { redirect: { destination: getFeishuLoginStartPath(), permanent: false } }
    : { props: {} };
