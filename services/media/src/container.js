// =========================================================
// Composition Root (media worker) — ráp (wire) các tầng tại MỘT chỗ duy nhất.
// DI thủ công: infrastructure (impl ports) → use-case → consumer.
//
//   domain              : rule của job render (ngôn ngữ, định dạng audio)
//   application          : use-case (dịch + TTS → .mp3)
//   infrastructure       : implement ports (Google Translate / TTS / S3 / Prisma)
//   interfaces/messaging : consumer map event RabbitMQ → use-case
//
// Worker không mở HTTP port; đầu vào là event (tts.render.requested).
// =========================================================

export function buildContainer(/* { prisma, env, publish } */) {
  // --- infrastructure ---
  // const translator = new GoogleTranslateClient(env);
  // const tts        = new GoogleTtsClient(env);
  // const storage    = new S3Storage(env);
  // const eventBus   = new RabbitmqPublisher(publish);

  // --- application (use-cases) ---
  // const renderTts = new RenderTts({ translator, tts, storage, eventBus });

  // --- interfaces (consumers) ---
  // const ttsRenderConsumer = new TtsRenderConsumer({ renderTts });

  // return { ttsRenderConsumer };
  return {};
}
