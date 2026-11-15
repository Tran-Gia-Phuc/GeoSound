// =========================================================
// #341 — bring the chatbot index (AI service) back in line with the Tour database, after a reseed
// or any data change made without events:
//   - re-sends tour.published for EVERY public tour (same payload as a normal publish:
//     notifyTourPublished, approved places, languages, translations);
//   - with --prune, reads tour ids from stdin (the AI `python -m app.chatbot.rag.list_index`) and
//     sends tour.unpublished ('deleted') for each id that is not a public tour any more, so the
//     indexer removes it the normal way.
// Run: node prisma/sync-chatbot-index.js [--prune]  (or: npm run sync:chatbot). Needs RABBITMQ_URL
// and CHATBOT_EVENTS_ENABLED=true; guide: docs/04-guides/seed-data.md.
// =========================================================
import { PrismaClient } from '@prisma/client';
import { isChatbotEventsEnabled } from '../src/config.js';
import { notifyTourPublished, notifyTourUnpublished } from '../src/application/use-cases/notify-tour-catalog.js';
import { EventTourCatalogPublisher } from '../src/infrastructure/messaging/event-tour-catalog-publisher.js';
import { PrismaTourRepository } from '../src/infrastructure/persistence/prisma-tour-repository.js';
import { PrismaPlaceRepository } from '../src/infrastructure/persistence/prisma-place-repository.js';
import { PrismaTourLanguageRepository } from '../src/infrastructure/persistence/prisma-tour-language-repository.js';
import { PrismaPlaceTranslationRepository } from '../src/infrastructure/persistence/prisma-place-translation-repository.js';

if (!isChatbotEventsEnabled(process.env)) {
  console.error('[sync] CHATBOT_EVENTS_ENABLED is not true: the chatbot index is not fed by Tour');
  process.exit(1);
}

async function readStdinIds() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return [...new Set(text.split(/\s+/).filter(Boolean))];
}

const prune = process.argv.includes('--prune');
const indexedIds = prune ? await readStdinIds() : [];
const prisma = new PrismaClient();
const rabbit = await import('../shared/rabbitmq/index.js');

try {
  await rabbit.connect();
  const catalog = new EventTourCatalogPublisher({ publish: rabbit.publish });
  const deps = {
    catalog,
    placeRepo: new PrismaPlaceRepository(prisma),
    tourLanguageRepo: new PrismaTourLanguageRepository(prisma),
    placeTranslationRepo: new PrismaPlaceTranslationRepository(prisma),
  };
  const tours = await new PrismaTourRepository(prisma).listByStatuses(['public']);
  for (const tour of tours) {
    await notifyTourPublished(deps, tour); // logs and goes on when one tour fails
    console.log(`[sync] tour.published: ${tour.id} ${tour.title}`);
  }
  const publicIds = new Set(tours.map((t) => t.id));
  const stale = indexedIds.filter((id) => !publicIds.has(id));
  for (const id of stale) {
    await notifyTourUnpublished(deps, { id }, 'deleted');
    console.log(`[sync] tour.unpublished: ${id}`);
  }
  console.log(`[sync] ${tours.length} public tours sent, ${stale.length} stale tours removed`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await rabbit.close().catch(() => {});
  await prisma.$disconnect();
}
