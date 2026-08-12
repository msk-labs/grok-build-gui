import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { GrokSandboxProfile } from "./agentProcess.js";

export type PermissionMode = "ask" | "auto" | "always-approve";

export type PermissionProfile = {
  sandbox: GrokSandboxProfile;
  approval: PermissionMode;
};

export const DEFAULT_PERMISSION_PROFILE: PermissionProfile = {
  sandbox: "workspace",
  approval: "auto",
};

export function profileForMode(mode: PermissionMode): PermissionProfile {
  return mode === "always-approve"
    ? { sandbox: "off", approval: mode }
    : { sandbox: "workspace", approval: mode };
}

type PersistedProfiles = {
  version: 1;
  defaultProfile: PermissionProfile;
  sessions: Record<string, PermissionProfile>;
};

function profilesPath(): string {
  return join(homedir(), ".grok", "gui", "permission-profiles.json");
}

function isMode(value: unknown): value is PermissionMode {
  return value === "ask" || value === "auto" || value === "always-approve";
}

function isSandbox(value: unknown): value is GrokSandboxProfile {
  return (
    value === "off" ||
    value === "workspace" ||
    value === "read-only" ||
    value === "strict"
  );
}

function parseProfile(value: unknown): PermissionProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as Partial<PermissionProfile>;
  return isSandbox(profile.sandbox) && isMode(profile.approval)
    ? { sandbox: profile.sandbox, approval: profile.approval }
    : null;
}

export class PermissionProfileStore {
  private readonly file: string;
  private data: PersistedProfiles;

  constructor(file = profilesPath()) {
    this.file = file;
    this.data = this.read();
  }

  getDefault(): PermissionProfile {
    return { ...this.data.defaultProfile };
  }

  setDefault(profile: PermissionProfile): void {
    this.data.defaultProfile = { ...profile };
    this.write();
  }

  getSession(sessionId: string): PermissionProfile | null {
    const profile = this.data.sessions[sessionId];
    return profile ? { ...profile } : null;
  }

  setSession(sessionId: string, profile: PermissionProfile): void {
    if (!sessionId) return;
    this.data.sessions[sessionId] = { ...profile };
    this.write();
  }

  deleteSession(sessionId: string): void {
    if (!(sessionId in this.data.sessions)) return;
    delete this.data.sessions[sessionId];
    this.write();
  }

  private read(): PersistedProfiles {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid permission profile store");
      }
      const record = parsed as {
        defaultProfile?: unknown;
        sessions?: unknown;
      };
      const defaultProfile =
        parseProfile(record.defaultProfile) ?? DEFAULT_PERMISSION_PROFILE;
      const sessions: Record<string, PermissionProfile> = {};
      if (
        record.sessions &&
        typeof record.sessions === "object" &&
        !Array.isArray(record.sessions)
      ) {
        for (const [sessionId, value] of Object.entries(record.sessions)) {
          const profile = parseProfile(value);
          if (sessionId && profile) sessions[sessionId] = profile;
        }
      }
      return { version: 1, defaultProfile, sessions };
    } catch {
      return {
        version: 1,
        defaultProfile: { ...DEFAULT_PERMISSION_PROFILE },
        sessions: {},
      };
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.data), "utf8");
      renameSync(temporary, this.file);
    } catch {
      // Best effort: live state remains authoritative for this app process.
    }
  }
}
