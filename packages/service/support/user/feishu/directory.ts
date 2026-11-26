import pLimit from 'p-limit';
import { z } from 'zod';
import { feishuRequest, getFeishuTenantToken } from './client';

const Id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const Department = z.object({
  open_department_id: Id,
  parent_department_id: Id,
  name: z.string().min(1).optional()
});
const Employee = z.object({
  open_id: Id,
  union_id: Id.nullish(),
  name: z.string().min(1),
  nickname: z.string().trim().nullish(),
  avatar: z.object({ avatar_72: z.string().nullish(), avatar_240: z.string().nullish() }).nullish(),
  department_ids: z.array(Id).default([]),
  status: z.object({
    is_activated: z.boolean(),
    is_frozen: z.boolean().optional(),
    is_exited: z.boolean().optional(),
    is_resigned: z.boolean().optional(),
    is_unjoin: z.boolean().optional()
  })
});

export type FeishuEmployee = z.infer<typeof Employee>;
export const getFeishuAvatar = (employee: FeishuEmployee) => {
  const source = employee.avatar?.avatar_240 || employee.avatar?.avatar_72;
  const avatar = source && URL.parse(source);
  if (avatar && avatar.protocol === 'https:' && avatar.hostname.endsWith('.feishucdn.com')) {
    return avatar.toString();
  }
};

export const getFeishuDepartmentFallbackName = (id: string) => `部门 ${id.slice(-8)}`;

export const isActiveFeishuEmployee = ({ status }: FeishuEmployee) =>
  status.is_activated &&
  !status.is_frozen &&
  !status.is_exited &&
  !status.is_resigned &&
  !status.is_unjoin;

const params = { department_id_type: 'open_department_id', user_id_type: 'open_id' };
const Page = z.object({
  has_more: z.boolean().default(false),
  page_token: z.string().optional()
});

async function* pages<T extends z.ZodRawShape>(
  path: string,
  shape: T,
  token: string,
  extra: Record<string, string> = {}
) {
  const schema = z.object({ data: z.intersection(Page, z.object(shape)) });
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ ...params, page_size: '50', ...extra });
    if (pageToken) query.set('page_token', pageToken);
    const { data } = await feishuRequest(`${path}?${query}`, schema, { token });
    yield data;
    pageToken = data.page_token;
    if (!data.has_more) return;
    if (!pageToken || seen.has(pageToken)) throw new Error('Incomplete Feishu directory page');
    seen.add(pageToken);
  } while (pageToken);
}

export async function readFeishuEmployee(openId: string, token: string) {
  const { data } = await feishuRequest(
    `/contact/v3/users/${encodeURIComponent(openId)}?${new URLSearchParams(params)}`,
    z.object({ data: z.object({ user: Employee }) }),
    { token }
  );
  if (data.user.open_id !== openId) throw new Error('Feishu employee identity mismatch');
  return data.user;
}

// Only a complete snapshot can remove an account or department membership.
export async function readFeishuDirectory(assertValid: () => void) {
  const token = await getFeishuTenantToken();
  const roots = new Set<string>();
  const directUsers = new Set<string>();
  let hasUserGroupScope = false;
  for await (const page of pages(
    '/contact/v3/scopes',
    {
      department_ids: z.array(Id).default([]),
      user_ids: z.array(Id).default([]),
      group_ids: z.array(Id).default([])
    },
    token
  )) {
    assertValid();
    page.department_ids.forEach((id) => roots.add(id));
    page.user_ids.forEach((id) => directUsers.add(id));
    hasUserGroupScope ||= page.group_ids.length > 0;
  }

  // 全员通讯录也会返回用户组。飞书只在全员范围内允许查询根部门。
  const departmentRoots = hasUserGroupScope ? ['0'] : [...roots];
  const departments = new Map<string, z.infer<typeof Department>>();
  const employees = new Map<string, FeishuEmployee>();
  for (const id of departmentRoots) {
    assertValid();
    if (id !== '0' && !departments.has(id)) {
      const { data } = await feishuRequest(
        `/contact/v3/departments/${encodeURIComponent(id)}?${new URLSearchParams(params)}`,
        z.object({ data: z.object({ department: Department }) }),
        { token }
      );
      if (data.department.open_department_id !== id) {
        throw new Error('Feishu department identity mismatch');
      }
      departments.set(id, data.department);
    }
    for await (const page of pages(
      `/contact/v3/departments/${encodeURIComponent(id)}/children`,
      { items: z.array(Department).default([]) },
      token,
      { fetch_child: 'true' }
    )) {
      assertValid();
      for (const department of page.items)
        departments.set(department.open_department_id, department);
    }
  }

  // 控制全员同步的读取并发，仍按部门顺序合并同一员工的记录。
  const limit = pLimit(4);
  const departmentMembers = await limit
    .map(new Set([...departmentRoots, ...departments.keys()]), async (id) => {
      assertValid();
      const members: FeishuEmployee[] = [];
      for await (const page of pages(
        '/contact/v3/users/find_by_department',
        { items: z.array(Employee).default([]) },
        token,
        { department_id: id }
      )) {
        assertValid();
        members.push(...page.items);
      }
      return { id, members };
    })
    .catch((error) => {
      limit.clearQueue();
      throw error;
    });

  for (const { id, members } of departmentMembers) {
    for (const employee of members) {
      const previous = employees.get(employee.open_id);
      employees.set(employee.open_id, {
        ...employee,
        union_id: employee.union_id ?? previous?.union_id,
        department_ids: [
          ...new Set([...(previous?.department_ids ?? []), ...employee.department_ids, id])
        ],
        status: previous && !isActiveFeishuEmployee(previous) ? previous.status : employee.status
      });
    }
  }
  for (const id of directUsers) {
    assertValid();
    if (!employees.has(id)) employees.set(id, await readFeishuEmployee(id, token));
  }

  return { departments, employees };
}
