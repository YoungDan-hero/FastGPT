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
    lastMessageKey: String,
    botAppId: String,
    leaseKey: String,
    groupCreatedAt: Date,
    nextCloseCheckAt: Date,
    promptedAt: Date,
    closedAt: Date,
    disbandRequested: Boolean,
    agentUnionIds: { type: [String], default: undefined },
    requesterUnionId: String,
    questionItemId: Schema.Types.ObjectId
  },
  { timestamps: true }
);

defineIndex(handoffSchema, { key: { botAppId: 1, nextCloseCheckAt: 1 } });

export type FeishuHandoffRecord = InferSchemaType<typeof handoffSchema>;
export const MongoFeishuHandoff = getMongoModel<FeishuHandoffRecord>(
  'feishu_handoffs',
  handoffSchema
);

const transcriptMessageSchema = new Schema(
  {
    role: { type: String, enum: ['customer', 'agent', 'other'], required: true },
    text: { type: String, required: true }
  },
  { _id: false }
);

const transcriptSchema = new Schema(
  {
    _id: { type: String, required: true },
    appId: { type: Schema.Types.ObjectId, required: true },
    teamId: { type: Schema.Types.ObjectId, required: true },
    tmbId: { type: Schema.Types.ObjectId, required: true },
    datasetId: { type: Schema.Types.ObjectId, required: true },
    targetCollectionId: Schema.Types.ObjectId,
    question: String,
    messages: { type: [transcriptMessageSchema], required: true },
    truncated: Boolean,
    nextExtractionAt: Date,
    attempts: { type: Number, default: 0 },
    extractedAt: Date,
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);
defineIndex(transcriptSchema, { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } });
defineIndex(transcriptSchema, { key: { nextExtractionAt: 1 } });

export const MongoFeishuHandoffTranscript = getMongoModel<InferSchemaType<typeof transcriptSchema>>(
  'feishu_handoff_transcripts',
  transcriptSchema
);

const candidateSchema = new Schema(
  {
    appId: { type: Schema.Types.ObjectId, required: true },
    teamId: { type: Schema.Types.ObjectId, required: true },
    datasetId: { type: Schema.Types.ObjectId, required: true },
    targetCollectionId: Schema.Types.ObjectId,
    transcriptId: { type: String, required: true },
    fingerprint: { type: String, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    evidence: { type: [Number], required: true },
    status: { type: String, enum: ['pending', 'published', 'rejected'], required: true },
    rejectionReason: String,
    reviewedBy: Schema.Types.ObjectId,
    reviewedAt: Date,
    collectionId: Schema.Types.ObjectId
  },
  { timestamps: true }
);
defineIndex(candidateSchema, {
  key: { appId: 1, datasetId: 1, fingerprint: 1 },
  options: { unique: true }
});
defineIndex(candidateSchema, { key: { appId: 1, status: 1, createdAt: -1 } });
defineIndex(candidateSchema, { key: { teamId: 1, status: 1, appId: 1 } });

export const MongoFeishuHandoffCandidate = getMongoModel<InferSchemaType<typeof candidateSchema>>(
  'feishu_handoff_candidates',
  candidateSchema
);
