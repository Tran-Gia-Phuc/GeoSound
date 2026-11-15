// =========================================================
// UC16 (#270) — wiring of the Notification service. The only place that builds concrete objects.
// `requireAuth` (shared verifyJwt) is passed in by src/index.js (CI rule: no ../shared import here).
// =========================================================
import { PrismaInAppNotificationRepository } from './infrastructure/prisma-in-app-notification-repository.js';
import { createStoreInAppNotification } from './application/store-in-app-notification.js';
import { ListNotifications, CountUnread, MarkRead, MarkAllRead } from './application/notification-use-cases.js';
import { NotificationController } from './interfaces/http/notification-controller.js';
import { buildNotificationRouter } from './interfaces/http/notification-routes.js';

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, requireAuth: import('express').RequestHandler,
 *           logger?: Console, repository?: object }} deps  `repository` overrides Prisma (tests)
 */
export function buildContainer({ prisma, requireAuth, logger = console, repository }) {
  const repo = repository ?? new PrismaInAppNotificationRepository(prisma);
  const controller = new NotificationController({
    listNotifications: new ListNotifications({ repository: repo }),
    countUnread: new CountUnread({ repository: repo }),
    markRead: new MarkRead({ repository: repo }),
    markAllRead: new MarkAllRead({ repository: repo }),
  });
  return {
    repository: repo,
    storeInApp: createStoreInAppNotification({ repository: repo, logger }),
    notificationRouter: buildNotificationRouter({ controller, requireAuth }),
  };
}
