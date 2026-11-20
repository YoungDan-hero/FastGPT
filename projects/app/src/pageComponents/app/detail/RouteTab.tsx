import { Box, Button, HStack, useDisclosure } from '@chakra-ui/react';
import React, { useCallback, useMemo } from 'react';
import { AppContext, TabEnum } from './context';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useContextSelector } from 'use-context-selector';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { feishuHandoffAppTypes } from '@fastgpt/global/core/app/feishuHandoff';
import { useSystemStore } from '@/web/common/system/useSystemStore';
import dynamic from 'next/dynamic';

const FeishuHandoffSettings = dynamic(() => import('./FeishuHandoffSettings'));

const RouteTab = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { appDetail, currentTab } = useContextSelector(AppContext, (v) => v);
  const feishuOrgLogin = useSystemStore((state) => state.feConfigs?.feishuOrgLogin);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const canConfigureHandoff =
    feishuOrgLogin &&
    appDetail.permission.hasWritePer &&
    feishuHandoffAppTypes.some((type) => type === appDetail.type);

  const setCurrentTab = useCallback(
    (tab: TabEnum) => {
      router.replace({
        query: {
          ...router.query,
          currentTab: tab
        }
      });
    },
    [router]
  );

  const tabList = useMemo(
    () => [
      ...(appDetail.permission.hasWritePer
        ? [
            {
              label:
                appDetail.type === AppTypeEnum.workflowTool
                  ? t('app:setting_plugin')
                  : t('app:setting_app'),
              value: TabEnum.appEdit
            }
          ]
        : []),
      ...(appDetail.permission.hasManagePer
        ? [
            {
              label: t('app:publish_channel'),
              value: TabEnum.publish
            }
          ]
        : []),
      ...(appDetail.permission.hasReadChatLogPer
        ? [{ label: t('app:chat_logs'), value: TabEnum.logs }]
        : [])
    ],
    [
      appDetail.permission.hasManagePer,
      appDetail.permission.hasReadChatLogPer,
      appDetail.permission.hasWritePer,
      appDetail.type,
      t
    ]
  );

  return (
    <HStack borderRadius={'md'} bg={'rgba(244, 244, 245, 0.63)'} backdropBlur={'blur(5px)'} p={1}>
      {tabList.map((tab) => (
        <HStack
          key={tab.value}
          justifyContent={'center'}
          cursor={'pointer'}
          w={canConfigureHandoff ? ['auto', '150px'] : '196px'}
          px={canConfigureHandoff ? [2, 0] : undefined}
          h={8}
          fontSize={'12px'}
          fontWeight={'medium'}
          userSelect={'none'}
          {...(currentTab === tab.value
            ? {
                bg: 'white',
                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                color: 'black',
                borderRadius: '2px'
              }
            : {
                color: 'myGray.500',
                onClick: () => setCurrentTab(tab.value)
              })}
        >
          <Box>{tab.label}</Box>
        </HStack>
      ))}
      {canConfigureHandoff && (
        <Button
          size="sm"
          variant="ghost"
          fontSize="12px"
          color="myGray.500"
          flexShrink={0}
          onClick={onOpen}
        >
          人工客服
        </Button>
      )}
      {canConfigureHandoff && isOpen && (
        <FeishuHandoffSettings key={appDetail._id} appId={appDetail._id} onClose={onClose} />
      )}
    </HStack>
  );
};

export default RouteTab;
