import React, {
  useRef,
  forwardRef,
  useMemo,
  useEffect,
  useImperativeHandle,
  type ForwardedRef,
  useState,
  useCallback
} from 'react';
import {
  Menu,
  MenuList,
  MenuItem,
  Button,
  useDisclosure,
  MenuButton,
  Box,
  Flex
} from '@chakra-ui/react';
import type { ButtonProps, MenuItemProps, MenuProps } from '@chakra-ui/react';
import MyIcon from '../Icon';
import { useRequest } from '../../../hooks/useRequest';
import { useCloseOnFlowNodeDragAreaPointerDown } from '../../../hooks/useCloseOnFlowNodeDragAreaPointerDown';
import { useStaticVirtualList } from '../../../hooks/useVirtualList';
import MyDivider from '../MyDivider';
import type { useScrollPagination } from '../../../hooks/useScrollPagination';
import Avatar from '../Avatar';
import EmptyTip from '../EmptyTip';
import FilterSearchInput, { filterSelectOptionsBySearch } from '../TagFilter/FilterSearchInput';
import { useTranslation } from 'next-i18next';

/** 选择组件 Props 类型
 * value: 选中的值
 * placeholder: 占位符
 * list: 列表数据
 * isLoading: 是否加载中
 * ScrollData: 分页滚动数据控制器 [useScrollPagination] 的返回值
 * customOnOpen: 自定义打开回调
 * customOnClose: 自定义关闭回调
 * */
export type SelectProps<T = any> = Omit<ButtonProps, 'onChange' | 'value'> & {
  value?: T;
  valueLabel?: string | React.ReactNode;
  placeholder?: string;
  isSearch?: boolean;
  onSearchChange?: (val: string) => void;
  list: {
    icon?: string;
    iconSize?: string;
    label: string | React.ReactNode;
    description?: string;
    value: T;
    showBorder?: boolean;
    searchText?: string;
  }[];
  isLoading?: boolean;
  /** 远程分页或搜索初始化加载态；与触发器切换态 isLoading 分离，不会关闭已展开菜单。 */
  isListLoading?: boolean;
  onChange?: (val: T) => any | Promise<any>;
  ScrollData?: ReturnType<typeof useScrollPagination>['ScrollData'];
  /** 已加载的大型单行选项列表使用虚拟滚动。 */
  virtualScroll?: boolean;
  customOnOpen?: () => void;
  customOnClose?: () => void;
  menuPlacement?: MenuProps['placement'];

  isInvalid?: boolean;
  isDisabled?: boolean;
};

export const menuItemStyles: MenuItemProps = {
  borderRadius: 'sm',
  py: 2,
  display: 'flex',
  alignItems: 'center',
  _hover: {
    backgroundColor: 'myGray.100'
  },
  _focus: {
    backgroundColor: 'myGray.100'
  },
  _notLast: {
    mb: 1
  }
};

const virtualRowHeight = 36;

const MySelect = <T = any,>(
  {
    bg = '#fff',
    placeholder,
    value,
    valueLabel,
    isSearch = false,
    onSearchChange,
    width = '100%',
    list = [],
    onChange,
    isLoading = false,
    isListLoading = false,
    ScrollData,
    virtualScroll = false,
    customOnOpen,
    customOnClose,
    menuPlacement,
    isInvalid,
    isDisabled,
    ...props
  }: SelectProps<T>,
  ref: ForwardedRef<{
    focus: () => void;
  }>
) => {
  const { t } = useTranslation();
  const ButtonRef = useRef<HTMLButtonElement>(null);
  const MenuRef = useRef<HTMLDivElement>(null);
  const MenuListRef = useRef<HTMLDivElement>(null);
  const SelectedItemRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { isOpen, onOpen: defaultOnOpen, onClose: defaultOnClose } = useDisclosure();
  const selectedIndex = useMemo(
    () => list.findIndex((item) => item.value === value),
    [list, value]
  );
  const selectItem = list[selectedIndex];

  const [search, setSearch] = useState('');

  const onOpen = useCallback(() => {
    defaultOnOpen();
    customOnOpen?.();
  }, [customOnOpen, defaultOnOpen]);

  const onClose = useCallback(() => {
    defaultOnClose();
    if (isSearch) {
      setSearch('');
      onSearchChange?.('');
    }
    customOnClose?.();
  }, [customOnClose, defaultOnClose, isSearch, onSearchChange]);

  useCloseOnFlowNodeDragAreaPointerDown(MenuRef, onClose, isOpen);

  const filterList = useMemo(() => {
    // 传入 onSearchChange 时由远程分页/搜索接口作为唯一过滤源，避免前端二次过滤抢数据。
    if (!isSearch || !search || onSearchChange) {
      return list;
    }
    return filterSelectOptionsBySearch(list, search);
  }, [list, onSearchChange, search, isSearch]);

  const shouldUseVirtualList = virtualScroll && !ScrollData;
  const {
    containerRef: virtualListRef,
    virtualDataList,
    topPlaceholderHeight,
    bottomPlaceholderHeight,
    scrollToTop
  } = useStaticVirtualList({
    data: filterList,
    itemHeight: virtualRowHeight,
    overscan: 6
  });

  useImperativeHandle(ref, () => ({
    focus() {
      onOpen();
    }
  }));

  // Auto scroll
  useEffect(() => {
    if (!isOpen || ScrollData) return;
    if (shouldUseVirtualList && virtualListRef.current && selectedIndex >= 0) {
      virtualListRef.current.scrollTop = Math.max(0, (selectedIndex - 2) * virtualRowHeight);
    } else if (MenuListRef.current && SelectedItemRef.current) {
      const menu = MenuListRef.current;
      const selectedItem = SelectedItemRef.current;
      menu.scrollTop = selectedItem.offsetTop - menu.offsetTop - 100;
    }
  }, [ScrollData, isOpen, selectedIndex, shouldUseVirtualList, virtualListRef]);

  const { runAsync: onClickChange, loading } = useRequest((val: T) => onChange?.(val));

  const ListRender = useMemo(() => {
    if (!filterList.length) {
      return isListLoading ? (
        <Flex justifyContent={'center'} py={2}>
          <MyIcon name={'common/loading'} w={'1rem'} />
        </Flex>
      ) : (
        <EmptyTip py={0} />
      );
    }

    const renderItem = (item: (typeof filterList)[number], i: number) => (
      <Box key={i}>
        <MenuItem
          {...menuItemStyles}
          {...(value === item.value
            ? {
                ref: SelectedItemRef,
                color: 'primary.700',
                bg: 'myGray.100'
              }
            : {
                color: 'myGray.900'
              })}
          onClick={(e) => {
            e.stopPropagation();
            if (value !== item.value) {
              onClickChange(item.value);
            }
          }}
          whiteSpace={'pre-wrap'}
          fontSize={'sm'}
          display={'block'}
          mb={0.5}
          {...(shouldUseVirtualList && {
            h: `${virtualRowHeight}px`,
            py: 0,
            mb: 0,
            _notLast: { mb: 0 },
            whiteSpace: 'nowrap',
            title: typeof item.label === 'string' ? item.label : undefined
          })}
        >
          <Flex alignItems={'center'}>
            {item.icon && <Avatar mr={2} src={item.icon as any} w={item.iconSize ?? '1rem'} />}
            {shouldUseVirtualList ? <Box noOfLines={1}>{item.label}</Box> : item.label}
          </Flex>
          {item.description && (
            <Box color={'myGray.500'} fontSize={'xs'}>
              {item.description}
            </Box>
          )}
        </MenuItem>
        {item.showBorder && <MyDivider my={2} />}
      </Box>
    );
    return shouldUseVirtualList
      ? virtualDataList.map(({ data, index }) => renderItem(data, index))
      : filterList.map(renderItem);
  }, [filterList, isListLoading, onClickChange, shouldUseVirtualList, value, virtualDataList]);

  const isSelecting = loading || isLoading;
  return (
    <Box ref={MenuRef}>
      <Menu
        autoSelect={isSearch}
        isLazy={shouldUseVirtualList}
        initialFocusRef={isSearch ? searchInputRef : undefined}
        isOpen={isOpen && !isSelecting}
        onOpen={onOpen}
        onClose={onClose}
        strategy={'fixed'}
        placement={menuPlacement}
      >
        <MenuButton
          as={Button}
          ref={ButtonRef}
          width={width}
          px={3}
          rightIcon={<MyIcon name={'core/chat/chevronDown'} w={4} color={'myGray.500'} />}
          variant={'whitePrimaryOutline'}
          size={'md'}
          fontSize={'sm'}
          textAlign={'left'}
          whiteSpace={'pre-wrap'}
          wordBreak={'break-word'}
          transition={'border-color 0.1s ease-in-out, box-shadow 0.1s ease-in-out'}
          isDisabled={isDisabled}
          _active={{
            transform: 'none'
          }}
          bg={isDisabled ? 'myWhite.300' : bg ? (isOpen ? '#fff' : bg) : '#fff'}
          color={isDisabled ? 'myGray.400' : isOpen ? 'primary.700' : 'myGray.700'}
          fontWeight={'normal'}
          borderColor={isInvalid ? 'red.500' : isOpen ? 'primary.300' : 'myGray.200'}
          boxShadow={
            isOpen
              ? isInvalid
                ? '0px 0px 0px 2.4px rgba(255, 0, 0, 0.15)'
                : '0px 0px 0px 2.4px rgba(51, 112, 255, 0.15)'
              : 'none'
          }
          opacity={isDisabled ? 0.4 : 1}
          _hover={isInvalid ? { borderColor: 'red.400' } : { borderColor: 'primary.300' }}
          {...props}
        >
          <Flex alignItems={'center'} justifyContent="space-between" w="100%" minW={0}>
            <Flex alignItems={'center'} flex={'1 1 0'} minW={0} overflow={'hidden'}>
              {isSelecting && <MyIcon mr={2} name={'common/loading'} w={'1rem'} />}
              {valueLabel ? (
                <>{valueLabel}</>
              ) : (
                <>
                  {selectItem?.icon && (
                    <Avatar mr={2} src={selectItem.icon as any} w={selectItem.iconSize ?? '1rem'} />
                  )}
                  <Box
                    noOfLines={1}
                    {...(!selectItem
                      ? {
                          color: 'myGray.500'
                        }
                      : {})}
                  >
                    {selectItem?.label || placeholder}
                  </Box>
                </>
              )}
            </Flex>
          </Flex>
        </MenuButton>

        <MenuList
          ref={MenuListRef}
          className={props.className}
          minW={(() => {
            /* eslint-disable react-hooks/refs */
            const w = ButtonRef.current?.clientWidth;
            if (w) {
              return `${w}px !important`;
            }
            /* eslint-enable react-hooks/refs */
            return Array.isArray(width)
              ? width.map((item) => `${item} !important`)
              : `${width} !important`;
          })()}
          w={'max-content'}
          px={'6px'}
          py={'6px'}
          border={'1px solid #fff'}
          boxShadow={
            '0px 2px 4px rgba(161, 167, 179, 0.25), 0px 0px 1px rgba(121, 141, 159, 0.25);'
          }
          zIndex={99}
          maxH={'45vh'}
          display={ScrollData || shouldUseVirtualList ? 'flex' : undefined}
          flexDirection={ScrollData || shouldUseVirtualList ? 'column' : undefined}
          overflowY={ScrollData || shouldUseVirtualList ? 'hidden' : 'auto'}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {isSearch && (
            <Box mb={1} flexShrink={0}>
              <FilterSearchInput
                ref={searchInputRef}
                value={search}
                placeholder={t('common:Search')}
                onChange={(val) => {
                  scrollToTop();
                  setSearch(val);
                  onSearchChange?.(val);
                }}
              />
            </Box>
          )}
          {ScrollData ? (
            <ScrollData
              flex={'1 1 auto'}
              minH={0}
              h={'auto'}
              overflowY={'auto'}
              overflowX={'hidden'}
            >
              {ListRender}
            </ScrollData>
          ) : shouldUseVirtualList && filterList.length > 0 ? (
            <Box
              ref={virtualListRef}
              minH={0}
              h={`${Math.min(filterList.length, 8) * virtualRowHeight}px`}
              overflowY={'auto'}
            >
              {topPlaceholderHeight > 0 && <Box h={`${topPlaceholderHeight}px`} aria-hidden />}
              {ListRender}
              {bottomPlaceholderHeight > 0 && (
                <Box h={`${bottomPlaceholderHeight}px`} aria-hidden />
              )}
            </Box>
          ) : (
            ListRender
          )}
        </MenuList>
      </Menu>
    </Box>
  );
};

export default forwardRef(MySelect) as <T>(
  props: SelectProps<T> & { ref?: React.Ref<HTMLSelectElement> }
) => JSX.Element;
