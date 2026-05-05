import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillLoader } from "./skills";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SkillLoader", () => {
  let dir: string;
  let loader: SkillLoader | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lifeagent-skills-"));
  });

  afterEach(async () => {
    if (loader) {
      loader.stop();
      loader = null;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a skill with frontmatter and body", async () => {
    await writeFile(
      join(dir, "persona.md"),
      `---\nname: persona\ndescription: agent persona\ntype: persona\ntriggers:\n  - greeting\n  - hello\n---\nYou are a friendly assistant.\n`,
    );
    loader = new SkillLoader({ skillsDir: dir });
    await loader.loadAll();
    const skills = loader.list();
    expect(skills.length).toBe(1);
    expect(skills[0]?.name).toBe("persona");
    expect(skills[0]?.description).toBe("agent persona");
    expect(skills[0]?.type).toBe("persona");
    expect(skills[0]?.triggers).toEqual(["greeting", "hello"]);
    expect(skills[0]?.body.trim()).toBe("You are a friendly assistant.");
  });

  it("findByTrigger returns skills containing the trigger", async () => {
    await writeFile(
      join(dir, "a.md"),
      `---\nname: a\ndescription: \ntype: persona\ntriggers: [hello]\n---\nA body\n`,
    );
    await writeFile(
      join(dir, "b.md"),
      `---\nname: b\ndescription: \ntype: persona\ntriggers: [hello, bye]\n---\nB body\n`,
    );
    await writeFile(
      join(dir, "c.md"),
      `---\nname: c\ndescription: \ntype: persona\ntriggers: [bye]\n---\nC body\n`,
    );
    loader = new SkillLoader({ skillsDir: dir });
    await loader.loadAll();
    const matches = loader.findByTrigger("hello").map((s) => s.name).sort();
    expect(matches).toEqual(["a", "b"]);
  });

  it("findByName returns the matching skill or undefined", async () => {
    await writeFile(
      join(dir, "x.md"),
      `---\nname: x\ndescription: \ntype: persona\ntriggers: []\n---\nX body\n`,
    );
    loader = new SkillLoader({ skillsDir: dir });
    await loader.loadAll();
    expect(loader.findByName("x")?.name).toBe("x");
    expect(loader.findByName("missing")).toBeUndefined();
  });

  it("ignores non-md files", async () => {
    await writeFile(
      join(dir, "real.md"),
      `---\nname: real\ndescription: \ntype: persona\ntriggers: []\n---\nbody\n`,
    );
    await writeFile(join(dir, "notes.txt"), "ignore me");
    await writeFile(join(dir, "data.json"), "{}");
    loader = new SkillLoader({ skillsDir: dir });
    await loader.loadAll();
    expect(loader.list().length).toBe(1);
    expect(loader.list()[0]?.name).toBe("real");
  });

  it("throws on malformed frontmatter (missing required field)", async () => {
    await writeFile(
      join(dir, "broken.md"),
      `---\ndescription: missing name\ntype: persona\ntriggers: []\n---\nbody\n`,
    );
    loader = new SkillLoader({ skillsDir: dir });
    await expect(loader.loadAll()).rejects.toThrow(/broken\.md/);
  });

  it("hot reload picks up file changes", async () => {
    const file = join(dir, "live.md");
    await writeFile(
      file,
      `---\nname: live\ndescription: v1\ntype: persona\ntriggers: [v1]\n---\nv1 body\n`,
    );
    loader = new SkillLoader({ skillsDir: dir, debounceMs: 50 });
    await loader.loadAll();
    loader.start();
    expect(loader.findByName("live")?.description).toBe("v1");

    await writeFile(
      file,
      `---\nname: live\ndescription: v2\ntype: persona\ntriggers: [v2]\n---\nv2 body\n`,
    );
    // wait for debounce + reload
    await wait(400);
    expect(loader.findByName("live")?.description).toBe("v2");
    expect(loader.findByTrigger("v2").map((s) => s.name)).toEqual(["live"]);
  });
});
