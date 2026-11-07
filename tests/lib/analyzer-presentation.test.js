import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupEquipmentSlots } from "../../src/lib/analyzer-presentation.js";
import { aggregate, extractBuild } from "../../src/lib/scraper-shared.js";

const slotNames = (groups, label) =>
  groups.find((group) => group.label === label)?.slots.map(([slot]) => slot) || [];

describe("equipment grouping", () => {
  it("places Brooch and Seal under Accessories and keeps Chalice with the arcanas", () => {
    const slots = Object.fromEntries(
      ["Mirror", "Scales", "Brooch", "Seal", "Chalice"].map((slot) => [
        slot,
        { "Example stat": { count: 1, values: ["29"] } },
      ])
    );
    const groups = groupEquipmentSlots(slots, "substats");

    expect(slotNames(groups, "Accessories")).toEqual(["Brooch", "Seal"]);
    expect(slotNames(groups, "Arcanas")).toEqual(["Mirror", "Scales", "Chalice"]);
    expect(slotNames(groups, "Other Equipment")).toEqual([]);
    expect(groups.flatMap((group) => group.slots)).toHaveLength(5);
    expect(groups[0].slots[0][1]).toBe(slots.Brooch);
  });

  it("recognizes numbered cached slots and qualified categories without matching unrelated names", () => {
    const slots = Object.fromEntries(
      [
        "Brooch1",
        "Seal2",
        "Pendant",
        "Ring(Left)",
        "Brooch (Right)",
        "Chalice (Rare)",
        "Arcana7",
        "Sealstone",
        "Keychain",
        "New Slot",
      ].map((slot) => [slot, { "Example item": { count: 1 } }])
    );
    const groups = groupEquipmentSlots(slots);

    expect(slotNames(groups, "Accessories")).toEqual(["Brooch", "Seal", "Pendant", "Ring"]);
    expect(slotNames(groups, "Arcanas")).toEqual(["Chalice (Rare)", "Arcana7"]);
    expect(slotNames(groups, "Other Equipment")).toEqual(["Sealstone", "Keychain", "New Slot"]);
    expect(
      groups
        .flatMap((group) => group.slots)
        .map(([slot]) => slot)
        .sort()
    ).toEqual([
      "Arcana7",
      "Brooch",
      "Chalice (Rare)",
      "Keychain",
      "New Slot",
      "Pendant",
      "Ring",
      "Seal",
      "Sealstone",
    ]);
  });

  it.each(["Brooch", "Seal", "Ring", "Earring", "Bracelet", "Rune"])(
    "combines cached %s pairs without changing the input or losing item totals",
    (slot) => {
      const slots = {
        [`${slot}1`]: {
          "Shared item": { count: 3, grade: "Rare", maxEnchant: 4, itemLevel: null },
          "Other item": { count: 1, grade: "Unique", maxEnchant: 1, itemLevel: 100 },
        },
        [`${slot}2`]: {
          "Shared item": { count: 2, grade: "Rare", maxEnchant: 2, itemLevel: 200 },
        },
      };
      const before = structuredClone(slots);
      const groups = groupEquipmentSlots(slots);
      const label = slot === "Earring" ? "Earrings" : slot;

      expect(slotNames(groups, "Accessories")).toEqual([label]);
      expect(groups[0].slots[0][1]).toEqual({
        "Shared item": { count: 5, grade: "Rare", maxEnchant: 4, itemLevel: 200 },
        "Other item": { count: 1, grade: "Unique", maxEnchant: 1, itemLevel: 100 },
      });
      expect(slots).toEqual(before);
    }
  );

  it.each(["Brooch", "Seal", "Ring", "Earrings", "Bracelet", "Rune"])(
    "combines canonical and numbered %s substats while preserving every observed value",
    (slot) => {
      const slots = {
        [slot]: { Might: { count: 2, values: ["29", "32"] } },
        [`${slot}1`]: { Might: { count: 1, values: ["30"] } },
        [`${slot}2`]: { Accuracy: { count: 1, values: ["45"] } },
      };
      const before = structuredClone(slots);
      const groups = groupEquipmentSlots(slots, "substats");

      expect(slotNames(groups, "Accessories")).toEqual([slot]);
      expect(groups[0].slots[0][1]).toEqual({
        Might: { count: 3, values: ["29", "32", "30"] },
        Accuracy: { count: 1, values: ["45"] },
      });
      expect(slots).toEqual(before);
    }
  );

  it("omits empty categories and sections", () => {
    expect(groupEquipmentSlots()).toEqual([]);
    expect(groupEquipmentSlots({ Brooch: {}, Seal: null, Chalice: {} })).toEqual([]);
  });

  it.each(["global", "kr", "tw"])("groups every equipped slot from the %s fixture", (region) => {
    const equipment = JSON.parse(
      readFileSync(
        new URL(`../fixtures/shugo-combat-power/${region}-equipment.json`, import.meta.url),
        "utf8"
      )
    );
    const build = extractBuild({ _equip: equipment }, {}, []);
    const stats = aggregate([build]);
    const groups = groupEquipmentSlots(stats.itemsBySlot);

    expect(slotNames(groups, "Other Equipment")).toEqual([]);
    expect(
      groups
        .flatMap((group) => group.slots)
        .map(([slot]) => slot)
        .sort()
    ).toEqual(Object.keys(stats.itemsBySlot).sort());
    expect(slotNames(groups, "Arcanas")).toEqual(
      region === "global"
        ? ["Grail", "Parchment", "Compass", "Bell", "Mirror"]
        : [
            "Grail",
            "Parchment",
            "Compass",
            "Bell",
            "Mirror",
            "Scales",
            "Key",
            "Hourglass",
            "Dice",
            "Lantern",
          ]
    );
    if (region !== "global") {
      expect(slotNames(groups, "Accessories")).toEqual(
        expect.arrayContaining(["Brooch", "Seal", "Pendant"])
      );
      for (const slot of ["Brooch", "Seal"]) {
        expect(build.equipItems.filter((item) => item.categoryName === slot)).toHaveLength(2);
      }
    }
  });
});
