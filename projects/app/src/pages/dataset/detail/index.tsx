import React from 'react';
import { useRouter } from 'next/router';
import { Box, Flex, type FlexProps } from '@chakra-ui/react';
import { useToast } from '@fastgpt/web/hooks/useToast';
import { getErrText } from '@fastgpt/global/common/error/utils';
import dynamic from 'next/dynamic';
import PageContainer from '@/components/PageContainer';
import {
  defaultDatasetDetail,
  DatasetDetailTabEnum as TabEnum
} from '@/web/core/dataset/constants';
import { feishuKnowledgeDatasetTypes } from '@fastgpt/global/core/app/feishuHandoff';
import { useSystemStore } from '@/web/common/system/useSystemStore';
import { useRequiredQueryParam } from '@/web/common/hooks/useRequiredQueryParam';
import { useSafeTranslation } from '@fastgpt/web/hooks/useSafeTranslation';
import MetaDataCard from '@/pageComponents/dataset/detail/MetaDataCard';
import NavBar from '@/pageComponents/dataset/detail/NavBar';
import MyBox from '@fastgpt/web/components/common/MyBox';
import {
  DatasetPageContext,
  DatasetPageContextProvider
} from '@/web/core/dataset/context/datasetPageContext';
import CollectionPageContextProvider from '@/pageComponents/dataset/detail/CollectionCard/Context';
import { useContextSelector } from 'use-context-selector';
import NextHead from '@/components/common/NextHead';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { useSystem } from '@fastgpt/web/hooks/useSystem';

const CollectionCard = dynamic(
  () => import('@/pageComponents/dataset/detail/CollectionCard/index')
);
const DataCard = dynamic(() => import('@/pageComponents/dataset/detail/DataCard'));
const Test = dynamic(() => import('@/pageComponents/dataset/detail/Test'));
const Info = dynamic(() => import('@/pageComponents/dataset/detail/Info/index'));
const CollectionFolderCard = dynamic(
  () => import('@/pageComponents/dataset/detail/CollectionFolderCard')
);
const Import = dynamic(() => import('@/pageComponents/dataset/detail/Import'));
const FeishuHandoffKnowledgeReview = dynamic(
  () => import('@/pageComponents/app/detail/FeishuHandoffKnowledgeReview')
);

type Props = { datasetId: string; currentTab: TabEnum };

const sliderStyles: FlexProps = {
  bg: 'white',
  borderRadius: 'md',
  overflowY: 'auto',
  boxShadow: 2
};

const Detail = ({ datasetId, currentTab: requestedTab }: Props) => {
  const { t } = useSafeTranslation();
  const { toast } = useToast();
  const router = useRouter();
  const { isPc } = useSystem();
  const feishuOrgLogin = useSystemStore((state) => state.feConfigs?.feishuOrgLogin);
  const datasetDetail = useContextSelector(DatasetPageContext, (v) => v.datasetDetail);
  const loadDatasetDetail = useContextSelector(DatasetPageContext, (v) => v.loadDatasetDetail);
  const collectionFolderAccessMode = useContextSelector(
    DatasetPageContext,
    (v) => v.collectionFolderAccessMode
  );

  const queryParentId = router.query.parentId;
  const parentId = typeof queryParentId === 'string' ? queryParentId : '';
  const canReviewHandoff = Boolean(
    feishuOrgLogin &&
    datasetDetail.permission.hasWritePer &&
    feishuKnowledgeDatasetTypes.some((type) => type === datasetDetail.type)
  );
  const currentTab =
    requestedTab === TabEnum.handoffReview && datasetDetail._id && !canReviewHandoff
      ? TabEnum.collectionCard
      : requestedTab;
  const handoffReview =
    currentTab === TabEnum.handoffReview && canReviewHandoff ? (
      <Box maxW="780px" mx="auto" px={[4, 6]} py={5}>
        <FeishuHandoffKnowledgeReview datasetId={datasetId} />
      </Box>
    ) : null;

  useRequest(
    () => {
      if (!datasetId) return Promise.resolve(defaultDatasetDetail);
      return loadDatasetDetail(datasetId);
    },
    {
      refreshDeps: [datasetId],
      onError(err: any) {
        router.replace(`/dataset/list`);
        toast({
          title: t(getErrText(err, t('common:load_failed')) as any),
          status: 'error'
        });
      },
      manual: false
    }
  );

  return (
    <>
      <NextHead title={datasetDetail?.name} icon={datasetDetail?.avatar} />

      {isPc ? (
        <Flex h={'100%'} py={3} pl={1} pr={3} gap={2}>
          <Flex flex={1} w={0} bg={'white'} flexDir={'column'} boxShadow={'2'} borderRadius={'md'}>
            {currentTab !== TabEnum.import && (
              <NavBar currentTab={currentTab} canReviewHandoff={canReviewHandoff} />
            )}
            <Box flex={'1'} overflowY={'auto'}>
              {currentTab === TabEnum.collectionCard && (
                <CollectionPageContextProvider>
                  <CollectionCard />
                </CollectionPageContextProvider>
              )}
              {currentTab === TabEnum.test && <Test datasetId={datasetId} />}
              {currentTab === TabEnum.dataCard && <DataCard />}
              {currentTab === TabEnum.import && <Import />}
              {handoffReview}
            </Box>
          </Flex>

          {/* Slider */}
          <>
            {currentTab === TabEnum.dataCard && (
              <Flex {...sliderStyles} flex={'0 0 20rem'}>
                <MetaDataCard datasetId={datasetId} />
              </Flex>
            )}
            {/* 仅导航目录（无真实权限）和路径未加载时不展示右栏，避免请求目录详情被拒绝后跳回根目录 */}
            {[TabEnum.collectionCard, TabEnum.test].includes(currentTab) &&
              !(
                currentTab === TabEnum.collectionCard &&
                parentId &&
                collectionFolderAccessMode !== 'read'
              ) && (
                <Flex {...sliderStyles} flex={'0 0 17rem'}>
                  {/* 子目录浏览态右栏=该目录自身；知识库根目录右栏=知识库 Info（不变） */}
                  {currentTab === TabEnum.collectionCard && parentId ? (
                    <CollectionFolderCard datasetId={datasetId} collectionId={parentId} />
                  ) : (
                    <Info datasetId={datasetId} />
                  )}
                </Flex>
              )}
          </>
        </Flex>
      ) : (
        <PageContainer insertProps={{ bg: 'white' }}>
          <MyBox display={'flex'} flexDirection={'column'} h={'100%'} pt={1}>
            <NavBar currentTab={currentTab} canReviewHandoff={canReviewHandoff} />

            {!!datasetDetail._id && (
              <Box flex={'1 0 0'} pb={0} overflow={'auto'}>
                {currentTab === TabEnum.collectionCard && (
                  <CollectionPageContextProvider>
                    <CollectionCard />
                  </CollectionPageContextProvider>
                )}
                {currentTab === TabEnum.dataCard && <DataCard />}
                {currentTab === TabEnum.test && <Test datasetId={datasetId} />}
                {currentTab === TabEnum.info && <Info datasetId={datasetId} />}
                {currentTab === TabEnum.import && <Import />}
                {handoffReview}
              </Box>
            )}
          </MyBox>
        </PageContainer>
      )}
    </>
  );
};

const Render = () => {
  const datasetId = useRequiredQueryParam('datasetId', {
    fallbackRoute: '/dataset/list'
  });
  const { query } = useRouter();
  const currentTab = (query.currentTab as TabEnum) || TabEnum.collectionCard;

  if (!datasetId) {
    return null;
  }

  return (
    <DatasetPageContextProvider key={datasetId} datasetId={datasetId}>
      <Detail datasetId={datasetId} currentTab={currentTab} />
    </DatasetPageContextProvider>
  );
};

export default Render;
