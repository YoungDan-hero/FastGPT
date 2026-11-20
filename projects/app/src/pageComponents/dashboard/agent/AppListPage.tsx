'use client';
import React, { useState } from 'react';
import { Box, Button, Flex, Grid, useDisclosure } from '@chakra-ui/react';
import { useSafeTranslation } from '@fastgpt/web/hooks/useSafeTranslation';
import dynamic from 'next/dynamic';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { postCreateAppFolder } from '@/web/core/app/api/app';
import type { EditFolderFormType } from '@fastgpt/web/components/common/MyModal/EditFolderModal';
import { useContextSelector } from 'use-context-selector';
import AppListContextProvider, { AppListContext } from '@/pageComponents/dashboard/agent/context';
import FolderPath from '@/components/common/folder/Path';
import { useRouter } from 'next/router';
import FolderSlideCard from '@/components/common/folder/SlideCard';
import { delAppById, resumeInheritPer } from '@/web/core/app/api';
import { AppRoleList } from '@fastgpt/global/support/permission/app/constant';
import { getCollaboratorList, postUpdateAppCollaborators } from '@/web/core/app/api/collaborator';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import MyBox from '@fastgpt/web/components/common/MyBox';
import { useSystem } from '@fastgpt/web/hooks/useSystem';
import JsonImportModal from '@/pageComponents/dashboard/agent/JsonImportModal';
import DashboardContainer from '@/pageComponents/dashboard/Container';
import List from '@/pageComponents/dashboard/agent/List';
import { getUtmWorkflow } from '@/web/support/marketing/utils';
import { useMount } from 'ahooks';
import SearchInput from '@fastgpt/web/components/common/Input/SearchInput';
import { useUserStore } from '@/web/support/user/useUserStore';
import { useSystemStore } from '@/web/common/system/useSystemStore';
import {
  canCreateSubFolder,
  DEFAULT_MAX_FOLDER_DEPTH
} from '@fastgpt/global/common/parentFolder/depth';
import MyIcon from '@fastgpt/web/components/common/Icon';
import { ReadRoleVal } from '@fastgpt/global/support/permission/constant';
import MyTooltip from '@fastgpt/web/components/common/MyTooltip';
import AppListFilters from './filters/AppListFilters';
import { hasAppListActiveFilter, type AppListFilterScene } from './filters/utils';
import WorkspaceArtwork from './WorkspaceArtwork';
import styles from './AppListPage.module.scss';

const EditFolderModal = dynamic(
  () => import('@fastgpt/web/components/common/MyModal/EditFolderModal')
);

const AppListContent = ({
  MenuIcon,
  scene
}: {
  MenuIcon: JSX.Element;
  scene: AppListFilterScene;
}) => {
  const { t } = useSafeTranslation();
  const router = useRouter();
  const { isPc } = useSystem();
  const isTool = scene === 'tool';
  const searchLabel = isTool ? t('app:search_tool') : t('app:search_agent');
  const {
    paths,
    parentId,
    appType,
    loadMyApps,
    onUpdateApp,
    setMoveAppId,
    folderDetail,
    refetchFolderDetail,
    searchKey,
    setSearchKey,
    listFilters,
    setListFilters,
    isEmpty,
    isBatchMode,
    setIsBatchMode
  } = useContextSelector(AppListContext, (v) => v);
  const [editFolder, setEditFolder] = useState<EditFolderFormType>();
  const { userInfo } = useUserStore();
  const { feConfigs } = useSystemStore();
  const maxFolderDepth = feConfigs?.limit?.maxFolderDepth ?? DEFAULT_MAX_FOLDER_DEPTH;
  const canCreateFolder = canCreateSubFolder(parentId, paths, maxFolderDepth);
  const folderDepthLimitTip = t('common:folder_depth_limit_tip');

  const {
    isOpen: isOpenJsonImportModal,
    onOpen: onOpenJsonImportModal,
    onClose: onCloseJsonImportModal
  } = useDisclosure();
  const hasCreatePer = parentId
    ? Boolean(folderDetail?.permission.hasWritePer && folderDetail.type !== AppTypeEnum.httpPlugin)
    : Boolean(userInfo?.team.permission.hasAppCreatePer);
  const showEmptyWorkspace =
    isEmpty &&
    !parentId &&
    !isBatchMode &&
    hasCreatePer &&
    !hasAppListActiveFilter({
      searchKey,
      type: appType,
      creatorMode: listFilters.creator.mode,
      applyToolbarFilters: isPc
    });

  // 保留通过工作流分享链接进入时自动打开导入弹窗的行为。
  useMount(() => {
    if (getUtmWorkflow()) {
      onOpenJsonImportModal();
    }
  });

  const { runAsync: onCreateFolder } = useRequest(postCreateAppFolder, {
    onSuccess() {
      loadMyApps();
    },
    errorToast: 'Error'
  });
  const { runAsync: onDeleFolder } = useRequest(delAppById, {
    onSuccess(data) {
      data.forEach((appId) => {
        localStorage.removeItem(`app_log_keys_${appId}`);
      });

      router.replace({
        query: {
          parentId: folderDetail?.parentId
        }
      });
    },
    errorToast: 'Error'
  });

  const folderPath = paths.length > 0 && (
    <Box minW={0} overflowX={'auto'}>
      <FolderPath
        paths={paths}
        hoverStyle={{ bg: 'myGray.200' }}
        forbidLastClick
        onClick={(parentId) => router.push({ query: { ...router.query, parentId } })}
      />
    </Box>
  );

  return (
    <Flex flexDirection={'column'} h={'100%'}>
      <Flex gap={5} flex={'1 0 0'} h={0}>
        <Flex
          flex={'1 0 0'}
          flexDirection={'column'}
          h={'100%'}
          pr={folderDetail ? [3, 2] : [3, 6]}
          pl={[3, 6]}
          pt={[4, 6]}
          pb={[3, 5]}
          gap={[3, 4]}
          minW={0}
          position={'relative'}
          isolation={'isolate'}
          overflowY={'hidden'}
          overflowX={'hidden'}
        >
          {!parentId && !showEmptyWorkspace && <Box className={styles.listBackdrop} aria-hidden />}
          <Flex as={'header'} alignItems={'center'} flexWrap={'wrap'} gap={3} flexShrink={0}>
            <Flex alignItems={'center'} gap={3} minW={0} maxW={'full'}>
              {!isPc && MenuIcon}
              {isPc && folderPath ? (
                folderPath
              ) : (
                <Box
                  as={'h1'}
                  color={'myGray.900'}
                  fontSize={['xl', '2xl']}
                  fontWeight={'semibold'}
                  lineHeight={'short'}
                  letterSpacing={'-0.025em'}
                >
                  {isTool ? t('common:navbar.Tools') : 'Agents'}
                </Box>
              )}
            </Flex>

            {!showEmptyWorkspace && (
              <Box w={isPc ? 'clamp(160px, 14vw, 220px)' : 'full'} order={isPc ? 0 : 1}>
                <SearchInput
                  value={searchKey}
                  placeholder={searchLabel}
                  aria-label={searchLabel}
                  onChange={(e) => setSearchKey(e.target.value)}
                  maxLength={30}
                />
              </Box>
            )}
            {isPc && !showEmptyWorkspace && (
              <AppListFilters scene={scene} value={listFilters} onChange={setListFilters} />
            )}

            <Flex alignItems={'center'} flexWrap={'wrap'} gap={1} ml={'auto'}>
              {isPc && !showEmptyWorkspace && (
                <Button
                  variant={'transparentBase'}
                  px={3}
                  iconSpacing={1.5}
                  {...(isBatchMode && {
                    color: 'primary.600',
                    bg: 'primary.50',
                    _hover: { bg: 'primary.100' }
                  })}
                  leftIcon={<MyIcon name={'common/checkSquareBroken'} boxSize={4} />}
                  onClick={() => setIsBatchMode((prev) => !prev)}
                  isDisabled={isEmpty && !isBatchMode}
                  aria-pressed={isBatchMode}
                >
                  {t('common:batch_manage')}
                </Button>
              )}
              {hasCreatePer && (
                <>
                  <MyTooltip label={canCreateFolder ? '' : folderDepthLimitTip}>
                    <Button
                      variant={'transparentBase'}
                      h={10}
                      px={3}
                      iconSpacing={1.5}
                      leftIcon={<MyIcon name={'common/add2'} boxSize={4} />}
                      onClick={() => setEditFolder({})}
                      isDisabled={!canCreateFolder}
                    >
                      {t('common:Folder')}
                    </Button>
                  </MyTooltip>
                  {!showEmptyWorkspace && (
                    <Button
                      variant={'transparentBase'}
                      h={10}
                      px={3}
                      iconSpacing={1.5}
                      leftIcon={<MyIcon name={'common/importLight'} boxSize={4} />}
                      onClick={onOpenJsonImportModal}
                    >
                      {t('common:Import')}
                    </Button>
                  )}
                </>
              )}
            </Flex>
          </Flex>
          {!isPc && folderPath}

          <MyBox flex={'1 0 0'} minH={0} overflowY={showEmptyWorkspace ? 'auto' : undefined}>
            {showEmptyWorkspace ? (
              <Grid
                minH={{ md: 'full' }}
                templateColumns={{
                  base: 'minmax(0, 1fr)',
                  md: 'minmax(0, 0.88fr) minmax(0, 1.12fr)'
                }}
                templateRows={{ base: 'auto auto', md: 'minmax(390px, 1fr)' }}
                overflow={'hidden'}
              >
                <Flex
                  direction={'column'}
                  justifyContent={'center'}
                  alignItems={{ base: 'center', md: 'flex-start' }}
                  textAlign={{ base: 'center', md: 'left' }}
                  gap={6}
                  px={{ base: 4, md: 8, lg: 14, '2xl': 20 }}
                  pt={{ base: 12, md: 16, xl: 20 }}
                  pb={{ base: 0, md: 16, xl: 20 }}
                >
                  <Box
                    as={'h2'}
                    fontSize={'clamp(1.75rem, 2.58vw, 2.75rem)'}
                    fontWeight={'medium'}
                    color={'myGray.800'}
                    lineHeight={1.2}
                    letterSpacing={'-0.025em'}
                    sx={{ textWrap: 'balance' }}
                  >
                    {isTool ? t('app:create_your_first_tool') : t('app:create_your_first_agent')}
                  </Box>
                  <Flex gap={3} flexWrap={'wrap'}>
                    <Button
                      variant={'primary'}
                      h={11}
                      px={5}
                      borderRadius={'full'}
                      leftIcon={<MyIcon name={'common/add2'} boxSize={4} aria-hidden />}
                      onClick={() =>
                        router.push(
                          `/dashboard/create?appType=${isTool ? AppTypeEnum.workflowTool : AppTypeEnum.workflow}`
                        )
                      }
                    >
                      {t('common:new_create')}
                    </Button>
                    <Button
                      variant={'whiteBase'}
                      h={11}
                      px={5}
                      borderRadius={'full'}
                      boxShadow={'none'}
                      leftIcon={<MyIcon name={'common/importLight'} boxSize={4} aria-hidden />}
                      onClick={onOpenJsonImportModal}
                    >
                      {t('common:Import')}
                    </Button>
                  </Flex>
                </Flex>
                <Flex
                  alignItems={'center'}
                  justifyContent={'center'}
                  px={{ base: 0, md: 4, xl: 6 }}
                  pt={{ base: 2, md: 8 }}
                  pb={{ base: 6, md: 8 }}
                >
                  <WorkspaceArtwork scene={scene} />
                </Flex>
              </Grid>
            ) : (
              <List />
            )}
          </MyBox>
        </Flex>

        {/* Folder slider */}
        {!!folderDetail && isPc && (
          <Box pt={[4, 6]} pr={[4, 6]} h={'100%'} pb={4} overflow={'auto'}>
            <FolderSlideCard
              refetchResource={() => Promise.all([refetchFolderDetail(), loadMyApps()])}
              resumeInheritPermission={() => resumeInheritPer(folderDetail._id)}
              isInheritPermission={folderDetail.inheritPermission}
              hasParent={!!folderDetail.parentId}
              refreshDeps={[folderDetail._id, folderDetail.inheritPermission]}
              name={folderDetail.name}
              intro={folderDetail.intro}
              onEdit={() => {
                setEditFolder({
                  id: folderDetail._id,
                  name: folderDetail.name,
                  intro: folderDetail.intro
                });
              }}
              onMove={() => setMoveAppId(folderDetail._id)}
              deleteTip={t('app:confirm_delete_folder_tip')}
              onDelete={() => onDeleFolder(folderDetail._id)}
              managePer={{
                defaultRole: ReadRoleVal,
                permission: folderDetail.permission,
                onGetCollaboratorList: () => getCollaboratorList(folderDetail._id),
                roleList: AppRoleList,
                onUpdateCollaborators: (props) =>
                  postUpdateAppCollaborators({
                    ...props,
                    appId: folderDetail._id
                  }),
                refreshDeps: [folderDetail._id, folderDetail.inheritPermission]
              }}
            />
          </Box>
        )}
      </Flex>

      {!!editFolder && (
        <EditFolderModal
          {...editFolder}
          showInheritPermission={!!parentId}
          onClose={() => setEditFolder(undefined)}
          onCreate={(data) =>
            onCreateFolder({
              ...data,
              parentId,
              type: isTool ? AppTypeEnum.toolFolder : AppTypeEnum.folder
            })
          }
          onEdit={({ id, ...data }) => onUpdateApp(id, data)}
        />
      )}
      {isOpenJsonImportModal && <JsonImportModal scene={scene} onClose={onCloseJsonImportModal} />}
    </Flex>
  );
};

function AppListPage({ scene }: { scene: AppListFilterScene }) {
  return (
    <DashboardContainer>
      {({ MenuIcon }) => (
        <AppListContextProvider showPaginationTip={false}>
          <AppListContent MenuIcon={MenuIcon} scene={scene} />
        </AppListContextProvider>
      )}
    </DashboardContainer>
  );
}

export default AppListPage;
