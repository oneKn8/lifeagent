import { type FSWatcher, watch } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

export interface Skill {
  name: string;
  description: string;
  type: string;
  triggers: string[];
  body: string;
  filename: string;
}

export interface SkillLoaderOptions {
  skillsDir: string;
  /** debounce window for fs.watch events, ms. default 200ms */
  debounceMs?: number;
}

export class SkillLoader {
  private readonly skillsDir: string;
  private readonly debounceMs: number;
  private skills = new Map<string, Skill>();
  private skillByFile = new Map<string, string>();
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: SkillLoaderOptions) {
    this.skillsDir = opts.skillsDir;
    this.debounceMs = opts.debounceMs ?? 200;
  }

  async loadAll(): Promise<void> {
    this.skills.clear();
    this.skillByFile.clear();
    const entries = await readdir(this.skillsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      await this.loadFile(entry);
    }
  }

  start(): void {
    if (this.watcher) return;
    this.watcher = watch(this.skillsDir, (_event, filename) => {
      if (!filename) return;
      if (!filename.endsWith(".md")) return;
      const existing = this.debounceTimers.get(filename);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.debounceTimers.delete(filename);
        void this.handleChange(filename);
      }, this.debounceMs);
      this.debounceTimers.set(filename, timer);
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  findByName(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  findByTrigger(trigger: string): Skill[] {
    return this.list().filter((s) => s.triggers.includes(trigger));
  }

  private async loadFile(filename: string): Promise<void> {
    const fullPath = join(this.skillsDir, filename);
    const raw = await readFile(fullPath, "utf8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const name = typeof data.name === "string" ? data.name : undefined;
    const descriptionRaw = data.description;
    const description =
      typeof descriptionRaw === "string"
        ? descriptionRaw
        : descriptionRaw === null || descriptionRaw === undefined
          ? ""
          : null;
    const type = typeof data.type === "string" ? data.type : undefined;
    const triggers = Array.isArray(data.triggers)
      ? (data.triggers.filter((t) => typeof t === "string") as string[])
      : undefined;
    if (!name || description === null || !type || !triggers) {
      throw new Error(
        `skill ${filename}: malformed frontmatter (require name, description, type, triggers)`,
      );
    }
    const previousName = this.skillByFile.get(filename);
    if (previousName && previousName !== name) {
      this.skills.delete(previousName);
    }
    const skill: Skill = {
      name,
      description,
      type,
      triggers,
      body: parsed.content,
      filename,
    };
    this.skills.set(name, skill);
    this.skillByFile.set(filename, name);
  }

  private async handleChange(filename: string): Promise<void> {
    const fullPath = join(this.skillsDir, filename);
    try {
      await readFile(fullPath, "utf8");
    } catch {
      // file removed
      const name = this.skillByFile.get(filename);
      if (name) {
        this.skills.delete(name);
        this.skillByFile.delete(filename);
      }
      return;
    }
    try {
      await this.loadFile(filename);
    } catch (err) {
      // surface via stderr but do not crash watcher
      process.stderr.write(`SkillLoader reload failed for ${filename}: ${(err as Error).message}\n`);
    }
  }
}
