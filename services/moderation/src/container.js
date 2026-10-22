// =========================================================
// Composition Root (moderation) — ráp (wire) các tầng tại MỘT chỗ duy nhất.
// DI thủ công: infrastructure (impl ports) → use-case → controller/consumer.
//
//   domain         : state machine trạng thái tour + rule kiểm duyệt (thuần JS)
//   application     : use-case (chạy AI tầng 1, duyệt/từ chối, xử lý report)
//   infrastructure  : implement ports (Prisma / Gemini client / publish event)
//   interfaces/http : controller (hàng chờ Admin, duyệt/từ chối)
//
// Moderation vừa nhận REST (Admin) vừa consume event (tour.submitted).
// Consumer event để ở interfaces (bổ sung khi code UC15).
// =========================================================

export function buildContainer(/* { prisma, env, publish } */) {
  // --- infrastructure ---
  // const tourStateRepo = new PrismaModerationRepository(prisma);
  // const aiReviewer    = new GeminiTextReviewer(env);
  // const eventBus      = new RabbitmqPublisher(publish);

  // --- application (use-cases) ---
  // const runAiReview = new RunAiReview({ tourStateRepo, aiReviewer, eventBus });
  // const approveTour = new ApproveTour({ tourStateRepo, eventBus });
  // const rejectTour  = new RejectTour({ tourStateRepo, eventBus });

  // --- interfaces ---
  // const moderationController = new ModerationController({ approveTour, rejectTour });

  // return { moderationController, runAiReview };
  return {};
}
