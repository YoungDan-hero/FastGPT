import { useContextSelector } from 'use-context-selector';
import { DatasetImportContext } from '../Context';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Loading from '@fastgpt/web/components/common/MyLoading';
import {
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Input
} from '@chakra-ui/react';
import { DatasetPageContext } from '@/web/core/dataset/context/datasetPageContext';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import {
  getApiDatasetFileList,
  getApiDatasetFileListExistId
} from '@/web/core/dataset/api/apiDataset';
import MyIcon from '@fastgpt/web/components/common/Icon';
import { useTranslation } from 'next-i18next';
import { type ParentTreePathItemType } from '@fastgpt/global/common/parentFolder/type';
import FolderPath from '@/components/common/folder/Path';
import { getSourceNameIcon } from '@fastgpt/global/core/dataset/utils';
import MyBox from '@fastgpt/web/components/common/MyBox';
import { RootCollectionId } from '@fastgpt/global/core/dataset/collection/constants';
import { type APIFileItemType } from '@fastgpt/global/core/dataset/apiDataset/type';
import { parseFeishuResourceLink } from '@fastgpt/global/core/dataset/apiDataset/utils';
import SearchInput from '@fastgpt/web/components/common/Input/SearchInput';
import { useMount } from 'ahooks';

const DataProcess = dynamic(() => import('../commonProgress/DataProcess'), {
  loading: () => <Loading fixed={false} />
});
const Upload = dynamic(() => import('../commonProgress/Upload'));
const PreviewData = dynamic(() => import('../commonProgress/PreviewData'));

const APIDatasetCollection = () => {
  const activeStep = useContextSelector(DatasetImportContext, (v) => v.activeStep);

  return (
    <>
      {activeStep === 0 && <CustomAPIFileInput />}
      {activeStep === 1 && <DataProcess />}
      {activeStep === 2 && <PreviewData />}
      {activeStep === 3 && <Upload />}
    </>
  );
};

export default React.memo(APIDatasetCollection);

const CustomAPIFileInput = () => {
  const { t } = useTranslation();
  const datasetDetail = useContextSelector(DatasetPageContext, (v) => v.datasetDetail);
  const isFeishuLink = Boolean(
    datasetDetail.apiDatasetServer?.feishuApp || datasetDetail.apiDatasetServer?.feishuLink
  );
  const goToNext = useContextSelector(DatasetImportContext, (v) => v.goToNext);

  const sources = useContextSelector(DatasetImportContext, (v) => v.sources);
  const setSources = useContextSelector(DatasetImportContext, (v) => v.setSources);

  const [linkInput, setLinkInput] = useState(sources[0]?.feishuSourceUrl ?? '');
  const [feishuSourceUrl, setFeishuSourceUrl] = useState(sources[0]?.feishuSourceUrl);
  const [invalidLink, setInvalidLink] = useState(false);
  const [selectFiles, setSelectFiles] = useState<APIFileItemType[]>([]);
  const [isRootSelected, setIsRootSelected] = useState(false);
  const [parent, setParent] = useState<ParentTreePathItemType>({
    parentId: '',
    parentName: ''
  });
  const [paths, setPaths] = useState<ParentTreePathItemType[]>([]);

  const [searchKey, setSearchKey] = useState('');

  const {
    data: listedFiles,
    loading,
    refresh
  } = useRequest(
    async () => ({
      feishuSourceUrl,
      files: await getApiDatasetFileList({
        datasetId: datasetDetail._id,
        parentId: parent?.parentId,
        searchKey,
        feishuSourceUrl
      })
    }),
    {
      ready: !isFeishuLink || Boolean(feishuSourceUrl),
      refreshDeps: [
        datasetDetail._id,
        datasetDetail.apiDatasetServer,
        parent,
        searchKey,
        feishuSourceUrl
      ],
      throttleWait: 500,
      manual: false
    }
  );

  const { data: existIdList, loading: loadingExistingIds } = useRequest(
    async () => {
      return new Set<string>(await getApiDatasetFileListExistId({ datasetId: datasetDetail._id }));
    },
    {
      manual: false
    }
  );

  const hasCurrentSource =
    !isFeishuLink ||
    (Boolean(feishuSourceUrl) &&
      listedFiles?.feishuSourceUrl === feishuSourceUrl &&
      parseFeishuResourceLink(linkInput)?.url === feishuSourceUrl);
  const fileList = hasCurrentSource ? (listedFiles?.files ?? []) : [];
  const isLoading = loading || loadingExistingIds;
  const canSelectFiles = hasCurrentSource && !isLoading && existIdList !== undefined;
  const selectableFiles = fileList.filter((file) => !existIdList?.has(file.id));
  const selectedIds = new Set(selectFiles.map((file) => file.id));
  // 飞书直链返回完整文件列表。目录来源仍由服务端遍历选中的目录。
  const selectedFiles = isFeishuLink
    ? selectableFiles.filter((file) => selectedIds.has(file.id))
    : selectFiles.filter((file) => !existIdList?.has(file.id));
  const canSelectAll = canSelectFiles && (!isFeishuLink || selectableFiles.length > 0);
  const isAllSelected =
    isRootSelected ||
    (isFeishuLink && selectableFiles.length > 0 && selectedFiles.length === selectableFiles.length);
  const canContinue = canSelectFiles && (selectedFiles.length > 0 || isRootSelected);

  // Init selected files
  useMount(() => {
    const hasRootFolder = sources.some((item) => item.apiFile?.id === RootCollectionId);
    if (hasRootFolder && !isFeishuLink) {
      setIsRootSelected(true);
    } else {
      setSelectFiles(sources.map((item) => item.apiFile).filter(Boolean) as APIFileItemType[]);
    }
  });

  const onClickNext = () => {
    if (!canContinue) return;

    const finalSelectedFiles: APIFileItemType[] = isRootSelected
      ? [
          {
            id: RootCollectionId,
            rawId: RootCollectionId,
            parentId: '',
            name: 'ROOT_FOLDER',
            type: 'folder',
            hasChild: true,
            updateTime: new Date(),
            createTime: new Date()
          }
        ]
      : selectedFiles;

    setSources(
      finalSelectedFiles.map((item) => ({
        id: item.id,
        apiFileId: item.id,
        feishuSourceUrl,
        apiFile: item,
        createStatus: 'waiting',
        sourceName: item.name,
        icon:
          item.type === 'folder'
            ? 'common/folderFill'
            : (getSourceNameIcon({ sourceName: item.name }) as any)
      }))
    );
    goToNext();
  };

  const loadFeishuSource = () => {
    const link = parseFeishuResourceLink(linkInput);
    setInvalidLink(!link);
    if (!link) return;
    if (link.url === feishuSourceUrl) {
      refresh();
      return;
    }
    setSelectFiles([]);
    setFeishuSourceUrl(link.url);
  };

  const handleSelectAll = () => {
    if (parent.parentId || !canSelectAll) return;
    if (isFeishuLink) {
      setSelectFiles(isAllSelected ? [] : selectableFiles);
      return;
    }
    setIsRootSelected((selected) => !selected);
    setSelectFiles([]);
  };

  const toggleFileSelection = (item: APIFileItemType) => {
    if (!canSelectFiles || existIdList?.has(item.id)) return;
    if (isRootSelected) {
      setIsRootSelected(false);
      setSelectFiles(selectableFiles.filter((file) => file.id !== item.id));
      return;
    }
    setSelectFiles((files) =>
      files.some((file) => file.id === item.id)
        ? files.filter((file) => file.id !== item.id)
        : [...files, item]
    );
  };

  return (
    <MyBox isLoading={isLoading} position="relative" h="full">
      <Flex flexDirection={'column'} h="full">
        {isFeishuLink ? (
          <Flex
            as="form"
            alignItems="flex-start"
            gap={3}
            onSubmit={(event) => {
              event.preventDefault();
              loadFeishuSource();
            }}
          >
            <FormControl isInvalid={invalidLink} maxW="620px">
              <FormLabel htmlFor="feishu-source-link">{t('dataset:feishu_link_label')}</FormLabel>
              <Input
                id="feishu-source-link"
                value={linkInput}
                placeholder={t('dataset:feishu_link_placeholder')}
                maxLength={2048}
                onChange={(event) => {
                  setLinkInput(event.target.value);
                  setInvalidLink(false);
                }}
              />
              <FormErrorMessage>{t('dataset:feishu_link_invalid')}</FormErrorMessage>
            </FormControl>
            <Button
              alignSelf="flex-start"
              mt={8}
              type="submit"
              isLoading={loading}
              isDisabled={!linkInput.trim()}
            >
              {t('dataset:feishu_link_load')}
            </Button>
          </Flex>
        ) : (
          <Flex justifyContent={'space-between'}>
            <FolderPath
              forbidLastClick
              paths={paths}
              onClick={(parentId) => {
                const index = paths.findIndex((item) => item.parentId === parentId);
                if (index === -1) {
                  setParent({
                    parentId: '',
                    parentName: ''
                  });
                  setPaths([]);
                  return;
                }
                setParent(paths[index]);
                setPaths(paths.slice(0, index + 1));
              }}
            />
            {datasetDetail?.apiDatasetServer?.apiServer && (
              <Box w={'240px'}>
                <SearchInput
                  value={searchKey}
                  onChange={(e) => setSearchKey(e.target.value)}
                  placeholder={t('common:core.workflow.template.Search')}
                />
              </Box>
            )}
          </Flex>
        )}
        <Box flex={1} overflowY="auto" mb={16} userSelect={'none'}>
          <Box ml={2} mt={3} display={hasCurrentSource ? 'block' : 'none'}>
            <Flex
              alignItems={'center'}
              py={3}
              cursor={'pointer'}
              bg={'myGray.50'}
              pl={7}
              rounded={'8px'}
              fontSize={'sm'}
              fontWeight={'medium'}
              color={'myGray.900'}
            >
              {parent?.parentId ? (
                <>{t('dataset:filename')}</>
              ) : (
                <Checkbox
                  className="checkbox"
                  isChecked={isAllSelected}
                  isDisabled={!canSelectAll}
                  onChange={handleSelectAll}
                >
                  <Box>{t('dataset:Select_all')}</Box>
                </Checkbox>
              )}
            </Flex>

            {fileList.map((item) => {
              const isExists = existIdList?.has(item.id);
              const isChecked = isExists || selectedIds.has(item.id) || isRootSelected;
              const canEnter = item.hasChild && !isChecked;

              return (
                <Flex
                  key={item.id}
                  py={3}
                  _hover={{ bg: 'primary.50' }}
                  pl={7}
                  cursor={'pointer'}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('.checkbox')) {
                      return;
                    }
                    if (item.hasChild) {
                      if (!canEnter) return;
                      setPaths((state) => [...state, { parentId: item.id, parentName: item.name }]);
                      return setParent({
                        parentId: item.id,
                        parentName: item.name
                      });
                    }
                    toggleFileSelection(item);
                  }}
                >
                  <Checkbox
                    className="checkbox"
                    mr={2.5}
                    isChecked={isChecked}
                    isDisabled={!canSelectFiles || isExists}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleFileSelection(item);
                    }}
                  />
                  <MyIcon
                    name={
                      item.type === 'folder'
                        ? 'common/folderFill'
                        : (getSourceNameIcon({ sourceName: item.name }) as any)
                    }
                    w={'18px'}
                    mr={1.5}
                  />
                  <Box fontSize={'sm'} fontWeight={'medium'} color={'myGray.900'}>
                    {item.name}
                  </Box>
                  {canEnter && <MyIcon name="core/chat/chevronRight" w={'18px'} ml={2} />}
                </Flex>
              );
            })}
          </Box>
        </Box>

        <Box
          position="absolute"
          display={'flex'}
          justifyContent={'end'}
          bottom={0}
          left={0}
          right={0}
          p={4}
        >
          <Button isDisabled={!canContinue} onClick={onClickNext}>
            {selectedFiles.length > 0
              ? `${t('dataset:total_num_files', { total: selectedFiles.length })} | `
              : ''}
            {t('common:next_step')}
          </Button>
        </Box>
      </Flex>
    </MyBox>
  );
};
