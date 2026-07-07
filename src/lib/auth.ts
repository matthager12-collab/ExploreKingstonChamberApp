// Self-hosted auth for the business / nonprofit / admin portals.
//
// Design: invite-based accounts (the Chamber controls who gets in), scrypt
// password hashes, and stateless HMAC-signed session cookies — no database,
// no third-party auth service. Users live in .data/auth/users.json.
//
// Bootstrap: when no users exist, /portal/setup creates the first admin.
// After that, admins mint invite codes tied to a role + the listing/org ids
// the account may edit.
//
// Server-only module (uses node:crypto and fs).

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { dataPath } from "./data-dir";
import { hasDb } from "./db";
import { readMerged, writeOverlayRecord } from "./stores/json-store";
import { cookies } from "next/headers";

export type Role = "business" | "nonprofit" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** restaurant ids (business) or charity ids (nonprofit) this account manages */
  linkedIds: string[];
  passwordHash: string;
  createdAt: string;
}

export interface InviteCode {
  code: string;
  role: Role;
  linkedIds: string[];
  note?: string;
  createdAt: string;
  usedBy?: string;
}

const AUTH_DIR = dataPath("auth");
const USERS_FILE = path.join(AUTH_DIR, "users.json");
const INVITES_FILE = path.join(AUTH_DIR, "invites.json");
const SESSION_COOKIE = "vk-session";
const SESSION_DAYS = 30;

// Overlay-table store keys for the DB backend (prod). Invites are keyed by
// their code (mapped onto the overlay table's `id` column).
const USERS_STORE = "auth-users";
const INVITES_STORE = "auth-invites";
type InviteRow = InviteCode & { id: string };

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET missing from .env.local");
  return s;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 1), "utf8");
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- users ----------

export async function listUsers(): Promise<User[]> {
  if (hasDb()) return readMerged<User>(USERS_STORE, []);
  return readJson<User[]>(USERS_FILE, []);
}

export async function hasAnyUsers(): Promise<boolean> {
  return (await listUsers()).length > 0;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const users = await listUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  linkedIds: string[];
  password: string;
}): Promise<User> {
  const users = await listUsers();
  if (users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error("An account with that email already exists");
  }
  const user: User = {
    id: randomBytes(8).toString("hex"),
    email: input.email,
    name: input.name,
    role: input.role,
    linkedIds: input.linkedIds,
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };
  if (hasDb()) {
    await writeOverlayRecord(USERS_STORE, user);
  } else {
    users.push(user);
    await writeJson(USERS_FILE, users);
  }
  return user;
}

/** Persist changes to an existing user (dual-backend, keyed by id). */
export async function saveUser(user: User): Promise<void> {
  if (hasDb()) {
    await writeOverlayRecord(USERS_STORE, user);
    return;
  }
  const users = await listUsers();
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx < 0) throw new Error("User not found");
  users[idx] = user;
  await writeJson(USERS_FILE, users);
}

/**
 * Self-service password change: verifies the current password first.
 * Passwords are stored as one-way scrypt hashes — they can never be viewed,
 * only replaced. (Admins reset via adminResetPassword instead.)
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) throw new Error("New password must be 8+ characters");
  const users = await listUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new Error("Current password is incorrect");
  }
  await saveUser({ ...user, passwordHash: hashPassword(newPassword) });
}

/**
 * Admin reset: sets a random temporary password and returns it ONCE so the
 * admin can hand it to the account holder (who should change it right away).
 */
export async function adminResetPassword(userId: string): Promise<string> {
  const users = await listUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  const temp = randomBytes(9).toString("base64url"); // ~12 chars, URL-safe
  await saveUser({ ...user, passwordHash: hashPassword(temp) });
  return temp;
}

/** Self-service profile update (name/email). Email must stay unique. */
export async function updateOwnProfile(
  userId: string,
  input: { name?: string; email?: string },
): Promise<User> {
  const users = await listUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  const email = input.email?.trim();
  if (
    email &&
    users.some((u) => u.id !== userId && u.email.toLowerCase() === email.toLowerCase())
  ) {
    throw new Error("Another account already uses that email");
  }
  const updated: User = {
    ...user,
    name: input.name?.trim() || user.name,
    email: email || user.email,
  };
  await saveUser(updated);
  return updated;
}

// ---------- invites ----------

export async function listInvites(): Promise<InviteCode[]> {
  if (hasDb()) return readMerged<InviteRow>(INVITES_STORE, []);
  return readJson<InviteCode[]>(INVITES_FILE, []);
}

export async function createInvite(input: {
  role: Role;
  linkedIds: string[];
  note?: string;
}): Promise<InviteCode> {
  const invites = await listInvites();
  const invite: InviteCode = {
    code: randomBytes(6).toString("hex"),
    role: input.role,
    linkedIds: input.linkedIds,
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  if (hasDb()) {
    await writeOverlayRecord<InviteRow>(INVITES_STORE, { ...invite, id: invite.code });
  } else {
    invites.push(invite);
    await writeJson(INVITES_FILE, invites);
  }
  return invite;
}

export async function redeemInvite(
  code: string,
  account: { email: string; name: string; password: string },
): Promise<User> {
  const invites = await listInvites();
  const invite = invites.find((i) => i.code === code && !i.usedBy);
  if (!invite) throw new Error("Invalid or already-used invite code");
  const user = await createUser({
    email: account.email,
    name: account.name,
    role: invite.role,
    linkedIds: invite.linkedIds,
    password: account.password,
  });
  invite.usedBy = user.id;
  if (hasDb()) {
    await writeOverlayRecord<InviteRow>(INVITES_STORE, { ...invite, id: invite.code });
  } else {
    await writeJson(INVITES_FILE, invites);
  }
  return user;
}

// ---------- sessions (stateless HMAC cookie) ----------

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 864e5 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      uid: string;
      exp: number;
    };
    if (data.exp < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: SESSION_COOKIE,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    // Only send over HTTPS in production; a `secure` cookie is never sent over
    // http://localhost, which would break dev login.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  },
};

/** The logged-in user for the current request, or null. */
export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const uid = parseSessionToken(token);
  if (!uid) return null;
  const users = await listUsers();
  return users.find((u) => u.id === uid) ?? null;
}

/** True when the user may edit the given listing/org id. */
export function canEdit(user: User, id: string): boolean {
  return user.role === "admin" || user.linkedIds.includes(id);
}

/**
 * Admin gate for route handlers: returns null when the caller is a signed-in
 * admin, otherwise the 401/403 Response to return. Route handlers bypass the
 * /admin layout, so any admin-only endpoint must call this itself.
 */
export async function requireAdmin(): Promise<Response | null> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (user.role !== "admin") {
    return Response.json({ error: "Chamber admins only" }, { status: 403 });
  }
  return null;
}
