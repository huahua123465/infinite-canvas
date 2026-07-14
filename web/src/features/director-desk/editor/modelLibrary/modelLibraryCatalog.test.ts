import { expect, it } from "vitest";
import { getModelLibraryItems, LOCAL_GUO_ASSETS_AVAILABLE } from "./modelLibraryCatalog";

it("ships a useful built-in everyday model collection without external files", () => {
  const items = getModelLibraryItems();
  const names = items.map((item) => item.name);

  expect(names).toEqual(expect.arrayContaining([
    "家用轿车",
    "城市SUV",
    "城市公交车",
    "自行车",
    "电动踏板车",
    "沙发",
    "餐桌",
    "冰箱",
    "洗衣机",
    "路灯",
    "绿化树",
    "分类垃圾桶",
  ]));
  expect(items.filter((item) => item.url.startsWith("builtin://life/"))).toHaveLength(18);
  expect(items.find((item) => item.name === "家用轿车")).toMatchObject({
    categoryId: "outdoor",
    fileName: "sedan_low.fbx",
  });
  expect(items.find((item) => item.name === "家用轿车")?.thumbUrl).toMatch(/^data:image\/svg\+xml/);
});

it("indexes the locally installed character and prop libraries", () => {
  const items = getModelLibraryItems();

  if (LOCAL_GUO_ASSETS_AVAILABLE) {
    expect(items.filter((item) => item.kind === "character")).toHaveLength(37);
    expect(items.filter((item) => item.id.startsWith("guo-prop:"))).toHaveLength(180);
    expect(items.find((item) => item.kind === "character")).toMatchObject({
      categoryId: "characters",
    });
    return;
  }

  expect(items.some((item) => item.kind === "character")).toBe(false);
  expect(items.some((item) => item.id.startsWith("guo-prop:"))).toBe(false);
});
