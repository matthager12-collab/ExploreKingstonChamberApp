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
  users.push(user);
  await writeJson(USERS_FILE, users);
  return user;
}

// ---------- invites ----------

export async function listInvites(): Promise<InviteCode[]> {
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
  invites.push(invite);
  await writeJson(INVITES_FILE, invites);
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
  await writeJson(INVITES_FILE, invites);
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

function parseSessionToken(token: string): string | null {
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
