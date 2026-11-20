import { teamDeleteProcessor } from './processor';
import { teamDeleteMQService, type TeamDeleteJobData } from '@fastgpt/dal/redis/bullmq';
import { assertFeishuAdminTeamCanBeDeleted } from '../../feishu/member';

export type { TeamDeleteJobData } from '@fastgpt/dal/redis/bullmq';

// 创建工作进程
export const initTeamDeleteWorker = () => {
  return teamDeleteMQService.getWorker(teamDeleteProcessor);
};

// 添加删除任务
export const addTeamDeleteJob = async (data: TeamDeleteJobData) => {
  await assertFeishuAdminTeamCanBeDeleted(data.teamId);
  return teamDeleteMQService.addJob(data);
};
