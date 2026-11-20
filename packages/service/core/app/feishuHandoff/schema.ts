import type { InferSchemaType } from 'mongoose';
import { Schema, defineIndex, getMongoModel } from '../../../common/mongo';

const groupSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    memberIds: { type: [Schema.Types.ObjectId], required: true }
  },
  { timestamps: true }
);

defineIndex(groupSchema, { key: { teamId: 1, name: 1 }, options: { unique: true } });

export const MongoFeishuHandoffGroup = getMongoModel<InferSchemaType<typeof groupSchema>>(
  'feishu_handoff_groups',
  groupSchema
);

const handoffSchema = new Schema(
  {
    _id: { type: String, required: true },
    appId: { type: Schema.Types.ObjectId, required: true },
    chatId: { type: String, required: true },
    createUuid: { type: String, required: true },
    feishuChatId: String,
    lastMessageKey: String
  },
  { timestamps: true }
);

export const MongoFeishuHandoff = getMongoModel<InferSchemaType<typeof handoffSchema>>(
  'feishu_handoffs',
  handoffSchema
);
