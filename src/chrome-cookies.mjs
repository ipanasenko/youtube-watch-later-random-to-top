import { execFile } from "node:child_process";
import {
  createDecipheriv,
  createHash,
  pbkdf2Sync,
} from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CHROME_DIR = join(
  homedir(),
  "Library/Application Support/Google/Chrome",
);

const YOUTUBE_HOSTS = [".youtube.com", "www.youtube.com", "youtube.com"];
const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const HOST_DIGEST_META_VERSION = 24;
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

export function deriveCookieKey(password) {
  return pbkdf2Sync(password, "saltysalt", 1_003, 16, "sha1");
}

export function decryptCookieValue(encrypted, key, hostKey, metaVersion) {
  const prefix = encrypted.subarray(0, 3).toString("latin1");

  if (prefix !== "v10") {
    throw new Error(`unsupported Chrome cookie encryption "${prefix}"`);
  }

  const decipher = createDecipheriv(
    "aes-128-cbc",
    key,
    Buffer.alloc(16, " "),
  );
  let plain = Buffer.concat([
    decipher.update(encrypted.subarray(3)),
    decipher.final(),
  ]);

  if (metaVersion >= HOST_DIGEST_META_VERSION) {
    const digest = createHash("sha256").update(hostKey).digest();

    if (!plain.subarray(0, 32).equals(digest)) {
      throw new Error(`cookie host digest mismatch for ${hostKey}`);
    }

    plain = plain.subarray(32);
  }

  return plain.toString("utf8");
}

async function readSafeStoragePassword() {
  try {
    // Use the system tool, not a "security" found through PATH.
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-w",
      "-s",
      "Chrome Safe Storage",
      "-a",
      "Chrome",
    ]);
    return stdout.trim();
  } catch {
    throw new Error(
      "could not read the Chrome Safe Storage key from the macOS Keychain",
    );
  }
}

// Holds stop signals while work runs, then sends them again.
async function holdingStopSignals(work) {
  let received = null;
  const hold = (signal) => {
    received = signal;
  };

  for (const signal of STOP_SIGNALS) {
    process.on(signal, hold);
  }

  try {
    return await work();
  } finally {
    for (const signal of STOP_SIGNALS) {
      process.off(signal, hold);
    }

    if (received) {
      process.kill(process.pid, received);
    }
  }
}

export function querySnapshot(profileDir, query) {
  // A signal would skip the cleanup below and leave the copy on disk.
  return holdingStopSignals(async () => {
    // Chrome locks its cookie database, so read a private copy.
    const snapshotDir = await mkdtemp(join(tmpdir(), "wl-cookies-"));

    try {
      const snapshot = join(snapshotDir, "Cookies");
      await copyFile(join(profileDir, "Cookies"), snapshot);
      await copyFile(
        join(profileDir, "Cookies-journal"),
        `${snapshot}-journal`,
      ).catch(() => {});

      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(snapshot);

      try {
        return query(db);
      } finally {
        db.close();
      }
    } finally {
      await rm(snapshotDir, { recursive: true, force: true });
    }
  });
}

export async function readYouTubeCookies({ profile = "Default" } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("reading Chrome cookies is supported only on macOS");
  }

  const profileDir = join(CHROME_DIR, profile);

  if (!existsSync(join(profileDir, "Cookies"))) {
    const profiles = readdirSync(CHROME_DIR).filter((name) => (
      existsSync(join(CHROME_DIR, name, "Cookies"))
    ));
    throw new Error(
      `Chrome profile "${profile}" was not found; available profiles: `
        + profiles.map((name) => `"${name}"`).join(", "),
    );
  }

  const { metaVersion, rows } = await querySnapshot(profileDir, (db) => ({
    metaVersion: Number(
      db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value,
    ),
    rows: db.prepare(`
      SELECT host_key, name, value, encrypted_value
      FROM cookies
      WHERE host_key IN (?, ?, ?)
        AND top_frame_site_key = ''
        AND (
          expires_utc = 0
          OR expires_utc > (strftime('%s', 'now') + ?) * 1000000
        )
      ORDER BY creation_utc
    `).all(...YOUTUBE_HOSTS, CHROME_EPOCH_OFFSET_SECONDS),
  }));

  if (rows.length === 0) {
    throw new Error(`no YouTube cookies found in Chrome profile "${profile}"`);
  }

  const key = deriveCookieKey(await readSafeStoragePassword());
  const cookies = new Map();

  for (const row of rows) {
    const value = row.value || decryptCookieValue(
      Buffer.from(row.encrypted_value),
      key,
      row.host_key,
      metaVersion,
    );
    cookies.set(row.name, value);
  }

  return cookies;
}
