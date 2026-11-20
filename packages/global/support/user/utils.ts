import type { UserType } from './type';

export const getRandomUserAvatar = () => {
  const defaultAvatars = [
    '/imgs/avatar/RoyalBlueAvatar.svg',
    '/imgs/avatar/PurpleAvatar.svg',
    '/imgs/avatar/AdoraAvatar.svg',
    '/imgs/avatar/OrangeAvatar.svg',
    '/imgs/avatar/RedAvatar.svg',
    '/imgs/avatar/GrayModernAvatar.svg',
    '/imgs/avatar/TealAvatar.svg',
    '/imgs/avatar/GreenAvatar.svg',
    '/imgs/avatar/BrightBlueAvatar.svg',
    '/imgs/avatar/BlueAvatar.svg'
  ];

  return defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];
};

/** 历史缺失、null 和空字符串都表示用户尚未设置本地密码。 */
export const hasStoredPassword = (password: unknown): password is string =>
  typeof password === 'string' && password.length > 0;

/** 保留已登录 root 的历史响应兼容，飞书管理员使用服务端签发的身份。 */
export const isSystemAdminUser = (user?: Pick<UserType, 'username' | 'isSystemAdmin'> | null) =>
  user?.isSystemAdmin === true || user?.username === 'root';
