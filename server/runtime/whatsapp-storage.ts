import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
export class WhatsAppStorage {
  private readonly root: string;
  constructor(dataDir: string) {
    this.root = join(dataDir, "whatsapp");
  }
  path(userId: string) {
    return join(this.root, createHash("sha256").update(userId).digest("hex"));
  }
  async prepare(userId: string) {
    const path = this.path(userId);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
    await writeFile(join(path, "owner.json"), JSON.stringify({ userId }), {
      mode: 0o600,
    });
    return path;
  }
  async owners() {
    let dirs: string[];
    try {
      dirs = await readdir(this.root);
    } catch {
      return [];
    }
    const owners: string[] = [];
    for (const dir of dirs) {
      if (!/^[a-f0-9]{64}$/.test(dir)) continue;
      try {
        const owner = JSON.parse(
          await readFile(join(this.root, dir, "owner.json"), "utf8"),
        );
        if (
          typeof owner.userId === "string" &&
          this.path(owner.userId) === join(this.root, dir)
        )
          owners.push(owner.userId);
      } catch {
        /* Ignore incomplete sessions. */
      }
    }
    return owners;
  }
  async isPaired(userId: string) {
    try {
      const creds = JSON.parse(
        await readFile(join(this.path(userId), "creds.json"), "utf8"),
      );
      // QR pairing populates me; registered is only set by phone-code pairing.
      return typeof creds.me?.id === "string" && creds.me.id.includes("@");
    } catch {
      return false;
    }
  }
  async erase(userId: string) {
    await rm(this.path(userId), { recursive: true, force: true });
  }
}
