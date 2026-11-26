import z from 'zod';
import type { PluginPermissionEnumType } from '../../../sdk/fastgpt-plugin';

const permissions = {
  'userInfo:read': 'userInfo:read',
  'teamInfo:read': 'teamInfo:read',
  'model:read': 'model:read',
  'dataset:read': 'dataset:read',
  'file-upload:allow': 'file-upload:allow',
  unknown: 'unknown'
} satisfies { [Permission in PluginPermissionEnumType]: Permission };

// 表单与数据展示共用 SDK 的权限值和未知值回退规则。
export const PluginPermissionSchema = z.enum(permissions).catch('unknown');
