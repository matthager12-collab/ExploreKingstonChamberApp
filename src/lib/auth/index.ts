// Auth v2 (E06) — the public surface of the auth subsystem.
//
// Everything in the app imports from "@/lib/auth"; the split behind this
// barrel is an implementation detail:
//
//   tokens.ts    pure crypto — no DB, no next/headers. Safe from scripts,
//                plain-Node test setup, and src/proxy.ts.
//   authz.ts     the five-role model, can(), and the gate response shapes.
//                Pure and synchronous.
//   identity.ts  users/orgs/invites as business operations (the rules).
//   session.ts   request-bound: cookie -> SessionUser, and the route gates.
//
// This replaced the single src/lib/auth.ts, which owned all of it and
// imported next/headers at module scope — which is why plain-Node callers
// (tests/server/global-setup.ts) had to hand-copy hashPassword.
//
// The authoritative authorization check is ALWAYS one of the gates here.
// src/proxy.ts is defense-in-depth: it can verify a signature at the request
// boundary but cannot see `disabled`, `session_version`, or role.

export {
  SESSION_COOKIE,
  SESSION_DAYS,
  generateId,
  generateInviteCode,
  generateTempPassword,
  hashPassword,
  makeSessionToken,
  sessionCookie,
  verifyPassword,
  verifySessionToken,
  type SessionClaims,
} from "./tokens";

export {
  FORBIDDEN,
  UNAUTHENTICATED,
  can,
  forbiddenResponse,
  gate,
  unauthorizedResponse,
  type Action,
  type AuthSubject,
  type Resource,
  type Role,
} from "./authz";

export {
  AuthError,
  INVITE_TTL_DAYS,
  MIN_PASSWORD_LENGTH,
  adminResetPassword,
  changeOwnPassword,
  createFirstAdmin,
  createInvite,
  createOrg,
  deleteUser,
  findUserByEmail,
  getInvite,
  getOrg,
  getUser,
  hasAnyUsers,
  inviteState,
  listInvites,
  listOrganizations,
  listUsers,
  recordLogin,
  recordLogout,
  redeemInvite,
  revokeInvite,
  setOrgTrustedAutoPublish,
  setUserDisabled,
  setUserRole,
  toPublicUser,
  updateOrgProfile,
  updateOwnProfile,
  verifyCredentials,
  type InviteRow,
  type InviteState,
  type OrgRow,
  type PublicUser,
  type UserRow,
} from "./identity";

export {
  clearSessionCookie,
  getSessionUser,
  requireAdmin,
  requireCan,
  requireRole,
  requireUser,
  setSessionCookie,
  tokenFor,
  type SessionUser,
} from "./session";

export { ORG_KINDS, ROLES, type OrgKind } from "@/lib/db/schema";
