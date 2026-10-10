// fixtures.ts 自身的不变量与覆盖率 pin：这份数据是测试基础设施，
// 误删几条可能让某些 UI 分桶悄悄失去覆盖——这里直接挡住。
import { describe, expect, it } from "vitest";
import { fixtureMovieByTitle, fixtureMovies } from "./fixtures";

// 与 src/lib/sections.ts 的分桶逻辑保持一致（那边未导出，这里复述）
const DAY_MS = 24 * 60 * 60 * 1000;
const addedBucket = (iso: string) => {
  const days = (Date.now() - Date.parse(iso)) / DAY_MS;
  if (days <= 7) return "本周";
  if (days <= 30) return "本月";
  if (days <= 180) return "半年内";
  return "更早";
};
const playBucket = (count: number) => {
  if (count <= 0) return "未播放";
  if (count === 1) return "1 次";
  if (count <= 5) return "2-5 次";
  if (count <= 10) return "6-10 次";
  return "10+ 次";
};

describe("fixtureMovies 不变量", () => {
  it("id 与 file_path 均唯一", () => {
    expect(new Set(fixtureMovies.map((m) => m.id)).size).toBe(fixtureMovies.length);
    expect(new Set(fixtureMovies.map((m) => m.file_path)).size).toBe(fixtureMovies.length);
  });

  it("必填字段完整且时间戳可解析", () => {
    for (const m of fixtureMovies) {
      expect(m.title, m.file_path).toBeTruthy();
      expect(Number.isFinite(m.id)).toBe(true);
      expect(Number.isNaN(Date.parse(m.added_at)), m.title).toBe(false);
      expect(Number.isNaN(Date.parse(m.updated_at)), m.title).toBe(false);
    }
  });
});

describe("fixtureMovies 分桶覆盖（sections.ts 全部桶都要有样本）", () => {
  it("added_at 四个时间桶全覆盖", () => {
    const buckets = new Set(fixtureMovies.map((m) => addedBucket(m.added_at)));
    expect(buckets).toEqual(new Set(["本周", "本月", "半年内", "更早"]));
  });

  it("play_count 五个桶全覆盖", () => {
    const buckets = new Set(fixtureMovies.map((m) => playBucket(m.play_count ?? 0)));
    expect(buckets).toEqual(new Set(["未播放", "1 次", "2-5 次", "6-10 次", "10+ 次"]));
  });

  it("评分未定义与多档已定义都存在", () => {
    const unrated = fixtureMovies.filter((m) => m.rating === undefined);
    const rated = fixtureMovies.filter((m) => typeof m.rating === "number");
    expect(unrated.length).toBeGreaterThan(0);
    expect(rated.length).toBeGreaterThan(3);
  });

  it("系列成员与散片并存（group_id 有值/无值），且系列至少 2 集", () => {
    const grouped = fixtureMovies.filter((m) => m.group_id !== undefined);
    const byGroup = new Map<number, number>();
    for (const m of grouped) {
      byGroup.set(m.group_id!, (byGroup.get(m.group_id!) ?? 0) + 1);
    }
    expect(grouped.length).toBeGreaterThan(0);
    expect([...byGroup.values()].every((n) => n >= 2)).toBe(true);
    expect(fixtureMovies.length - grouped.length).toBeGreaterThan(0);
  });

  it("中文与英文标题并存", () => {
    expect(fixtureMovies.some((m) => /[\u4e00-\u9fff]/.test(m.title))).toBe(true);
    expect(fixtureMovies.some((m) => !/[\u4e00-\u9fff]/.test(m.title))).toBe(true);
  });

  it("按标题查找命中的是同一条数据", () => {
    const m = fixtureMovieByTitle("The Matrix");
    expect(m.year).toBe(1999);
    expect(() => fixtureMovieByTitle("不存在的标题")).toThrow();
  });
});
