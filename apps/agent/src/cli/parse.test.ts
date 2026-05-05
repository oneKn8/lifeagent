import { describe, expect, it } from "bun:test";
import { parseArgv } from "./parse";

describe("parseArgv", () => {
  it("parses a command with no args", () => {
    expect(parseArgv(["status"])).toEqual({
      command: "status",
      positional: [],
      flags: {},
    });
  });

  it("parses --key=value flags", () => {
    expect(parseArgv(["plan", "--title=lift", "--start=2026-05-04T15:00Z"])).toEqual({
      command: "plan",
      positional: [],
      flags: { title: "lift", start: "2026-05-04T15:00Z" },
    });
  });

  it("parses --key value pairs", () => {
    expect(parseArgv(["plan", "--title", "lift"])).toEqual({
      command: "plan",
      positional: [],
      flags: { title: "lift" },
    });
  });

  it("collects positional args after the command", () => {
    expect(parseArgv(["replay", "abc-123"])).toEqual({
      command: "replay",
      positional: ["abc-123"],
      flags: {},
    });
  });

  it("treats lone flags as boolean true", () => {
    expect(parseArgv(["status", "--json"])).toEqual({
      command: "status",
      positional: [],
      flags: { json: true },
    });
  });
});
