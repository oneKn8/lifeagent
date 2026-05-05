import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillLoader } from "../runtime/skills";

const skillsDir = dirname(fileURLToPath(import.meta.url));

describe("production skills directory", () => {
  it("loads all skills with valid frontmatter", async () => {
    const loader = new SkillLoader({ skillsDir });
    await loader.loadAll();
    const skills = loader.list();
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual([
      "daily-brief",
      "daily-summary",
      "lifeagent",
      "memory-extractor",
      "reschedule",
    ]);
    for (const skill of skills) {
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.type.length).toBeGreaterThan(0);
      expect(skill.triggers.length).toBeGreaterThan(0);
      expect(skill.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("the persona skill triggers on chat and pings", async () => {
    const loader = new SkillLoader({ skillsDir });
    await loader.loadAll();
    const persona = loader.list().find((s) => s.name === "lifeagent");
    expect(persona?.type).toBe("persona");
    expect(persona?.triggers).toContain("chat");
    expect(persona?.triggers).toContain("pre_ping");
    expect(persona?.triggers).toContain("post_ping");
  });
});
