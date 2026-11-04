// =========================================================
// Public author page, follow and profile edit (UC18) over the gateway /api/auth,
// plus the author's public tours from the Tour search (GET /api/tours?authorId=).
// Author: { id, fullName, avatarUrl, bio, followerCount, joinedAt } (never the email).
// =========================================================
import { api } from './api.js';
import { searchTours } from './tours.js';
import { readAuth, writeAuth } from './token-store.js';

export const NAME_MAX = 120;
export const BIO_MAX = 500;

const authorPath = (id) => `/api/auth/authors/${encodeURIComponent(id)}`;

/** Public: GET /api/auth/authors/:id -> author (404 author_not_found). */
export async function getAuthor(id, opts) {
  const body = await api.get(authorPath(id), opts);
  return body?.author ?? body;
}

/** Public tours of one author, newest first: { tours, total, page, limit }. */
export function listAuthorTours(id, { page = 1, limit = 12 } = {}, opts) {
  return searchTours({ authorId: id, sort: 'recent', page, limit }, opts);
}

/** Signed in: { following, followerCount } */
export function getFollowState(id, opts) {
  return api.get(`${authorPath(id)}/follow`, { ...opts, auth: true });
}

/** Signed in: follow (PUT) or unfollow (DELETE) -> { following, followerCount }. Idempotent. */
export function setFollowing(id, follow) {
  const path = `${authorPath(id)}/follow`;
  return follow ? api.put(path, undefined, { auth: true }) : api.del(path, { auth: true });
}

/** Signed in: GET /api/auth/me/following -> { items: [author + followedAt], total, page, limit } */
export function listFollowing({ page = 1, limit = 20 } = {}, opts) {
  return api.get(`/api/auth/me/following?page=${page}&limit=${limit}`, { ...opts, auth: true });
}

/** Same rules as the server (R7). Returns { fullName?, bio? } messages; {} when valid. */
export function validateProfile({ fullName, bio }) {
  const errors = {};
  const name = String(fullName ?? '').trim();
  if (!name) errors.fullName = 'Vui lòng nhập họ tên';
  else if (name.length > NAME_MAX) errors.fullName = `Họ tên tối đa ${NAME_MAX} ký tự`;
  if (String(bio ?? '').trim().length > BIO_MAX) errors.bio = `Giới thiệu tối đa ${BIO_MAX} ký tự`;
  return errors;
}

/**
 * Signed in: PATCH /api/auth/me/profile { fullName?, bio?, avatarUrl? } -> author + email, role.
 * Blank bio / avatar is sent as null (clears it). The stored user follows the new name and avatar.
 */
export async function updateProfile(patch) {
  const body = await api.patch('/api/auth/me/profile', patch, { auth: true });
  const profile = body?.user ?? body?.profile ?? body?.author ?? body;
  const current = readAuth();
  if (current?.user && profile) {
    writeAuth({
      ...current,
      user: {
        ...current.user,
        ...(profile.fullName !== undefined ? { fullName: profile.fullName } : {}),
        ...(profile.avatarUrl !== undefined ? { avatarUrl: profile.avatarUrl } : {}),
        ...(profile.bio !== undefined ? { bio: profile.bio } : {}),
      },
    });
  }
  return profile;
}

/** "N" initials fallback for a missing avatar. */
export const initialsOf = (name) => (String(name || '?').trim().slice(0, 1) || '?').toUpperCase();
