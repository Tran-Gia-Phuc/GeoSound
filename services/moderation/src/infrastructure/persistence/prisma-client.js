// Prisma client singleton. Needs `prisma generate` in the Dockerfile (see MANIFEST).
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
