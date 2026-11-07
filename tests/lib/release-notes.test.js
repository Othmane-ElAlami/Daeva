import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASE_DATE } from "../../src/lib/release.js";
import { CURRENT_RELEASE } from "../../src/lib/release-notes.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const markdown = read("../../CHANGELOG.md");
const [heading, ...lines] = markdown.split(/^## /m)[1].split(/\r?\n/);

describe("current release metadata and changelog", () => {
  it("keeps package, lockfile, displayed version and release dates consistent", () => {
    const pkg = JSON.parse(read("../../package.json"));
    const lock = JSON.parse(read("../../package-lock.json"));

    expect(pkg.version).toBe(APP_VERSION);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(CURRENT_RELEASE.version).toBe(APP_VERSION);
    expect(CURRENT_RELEASE.label).toBe(`Beta ${pkg.version.split("-")[0]}`);
    expect(CURRENT_RELEASE.latest).toBe(true);
    expect(heading).toBe(`${APP_VERSION} - ${RELEASE_DATE}`);
    expect(new Date(`${CURRENT_RELEASE.date} UTC`).toISOString().slice(0, 10)).toBe(RELEASE_DATE);
  });

  it("includes every current Markdown release note in the in-app changelog", () => {
    const sections = [];
    for (const line of lines) {
      if (line.startsWith("### ")) {
        sections.push({ heading: line.slice(4), notes: [] });
      } else if (line.startsWith("- ")) {
        sections.at(-1).notes.push(line.slice(2).replace(/`([^`]+)`/g, "$1"));
      }
    }

    expect(sections.length).toBeGreaterThan(0);
    expect(
      CURRENT_RELEASE.groups.map((group) => ({
        heading: group.typeLabel,
        notes: group.items.map((item) => item.desc),
      }))
    ).toEqual(sections);
  });
});
