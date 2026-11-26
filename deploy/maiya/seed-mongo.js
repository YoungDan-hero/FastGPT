const fs = require('node:fs');
const admin = db.getSiblingDB('admin');

try {
  admin.runCommand({ replSetGetStatus: 1 });
} catch (error) {
  if (error.code !== 94) throw error;
  admin.runCommand({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] } });
}

const deadline = Date.now() + 60000;
while (!admin.hello().isWritablePrimary) {
  if (Date.now() >= deadline) throw new Error('MongoDB replica set did not elect a primary');
  sleep(1000);
}

const session = db.getMongo().startSession();
try {
  const data = session.getDatabase(db.getName());
  session.startTransaction();
  if (!data.maiya_release_bootstrap.findOne({ _id: 'initial-catalog-v1' })) {
    const { models, defaultModels, template, templateType } = JSON.parse(fs.readFileSync('/seed/seed.json', 'utf8'));
    const modelIds = new Map();
    for (const model of models) {
      const scope = { scope: 'system', model: model.model };
      data.ai_models.updateOne(scope, { $setOnInsert: model }, { upsert: true });
      const saved = data.ai_models.findOne(scope, { _id: 1 });
      modelIds.set(model.model, saved._id.toString());
    }

    const defaultModelIds = Object.fromEntries(
      Object.entries(defaultModels).map(([slot, model]) => {
        if (!modelIds.has(model)) throw new Error(`Missing model in the seed for ${slot}`);
        return [slot, modelIds.get(model)];
      })
    );
    data.ai_default_models.updateOne(
      { scope: 'system' },
      { $setOnInsert: { defaultModelIds, catalogRevision: 1 } },
      { upsert: true }
    );
    data.app_template_types.updateOne(
      { typeId: templateType.typeId },
      { $setOnInsert: templateType },
      { upsert: true }
    );
    data.app_templates.updateOne(
      { templateId: template.templateId },
      { $setOnInsert: template },
      { upsert: true }
    );
    data.maiya_release_bootstrap.insertOne({ _id: 'initial-catalog-v1', runAt: new Date() });
    session.commitTransaction();
    print(`Seeded ${models.length} model definitions and the Maiya Studio template`);
  } else {
    session.commitTransaction();
  }
} catch (error) {
  session.abortTransaction();
  throw error;
} finally {
  session.endSession();
}
