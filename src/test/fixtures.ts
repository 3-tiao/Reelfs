// 前端测试固定数据：与 Rust 侧共享的测试数据集（testdata/manifest.json）
// 保持同名对照（标题/文件路径一一对应，元数据形态对齐扫描管线的落库结果：
// 无 NFO 的条目 year/rating/plot/genres/director/actors 均为 undefined）。
// 修改 manifest 命名时请同步这里；fixtures.test.ts 会 pin 分桶覆盖率。
import type { Movie } from "../services/tauri";

const DAY_MS = 24 * 60 * 60 * 1000;

// 相对"现在"生成时间戳，保证 added_at/last_accessed 的分桶（本周/本月/…）
// 不随时间漂移——写死 ISO 日期会让测试在几个月后悄悄变红。
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * DAY_MS).toISOString();

let nextId = 1;
const base = (overrides: Partial<Movie> & Pick<Movie, "title" | "file_path">): Movie => ({
  id: nextId++,
  added_at: daysAgo(3),
  updated_at: daysAgo(3),
  play_count: 0,
  ...overrides,
});

export const fixtureMovies: Movie[] = [
  // —— Kodi 式单片（有 NFO 元数据）——
  base({
    title: "Inception",
    file_path: "/nas/Kodi 式单片/Inception (2010)/Inception (2010).mp4",
    year: 2010,
    rating: 8.8,
    plot: "A thief who steals corporate secrets through dream-sharing technology.",
    genres: "Sci-Fi, Action",
    director: "Christopher Nolan",
    actors: "Leonardo DiCaprio, Elliot Page",
    duration_seconds: 6,
    width: 640,
    height: 360,
    file_size: 4_100_000,
    is_watched: 0,
    added_at: daysAgo(2), // 本周入库
  }),
  base({
    title: "盗梦空间",
    file_path: "/nas/Kodi 式单片/盗梦空间 (2010)/盗梦空间 (2010).mp4",
    year: 2010,
    rating: 8.9,
    plot: "一个通过潜入梦境窃取机密的贼。",
    genres: "科幻, 悬疑",
    director: "克里斯托弗·诺兰",
    actors: "莱昂纳多·迪卡普里奥, 渡边谦",
    duration_seconds: 6,
    width: 640,
    height: 360,
    file_size: 4_200_000,
    play_count: 12, // 10+ 次桶
    added_at: daysAgo(40), // 半年内
  }),
  base({
    title: "Interstellar",
    file_path: "/nas/Kodi 式单片/Interstellar (2014)/Interstellar (2014).mkv",
    year: 2014,
    // 最小 NFO：无评分——覆盖未评分渲染
    duration_seconds: 4,
    width: 320,
    height: 180,
    file_size: 2_300_000,
    play_count: 1, // 1 次桶
    added_at: daysAgo(200), // 更早
  }),
  base({
    title: "海报全家福 (1998)",
    file_path: "/nas/Kodi 式单片/海报全家福 (1998)/海报全家福 (1998).avi",
    year: 1998,
    rating: 3,
    thumbnail_path: "/cache/海报全家福.webp",
    duration_seconds: 4,
    width: 320,
    height: 180,
    file_size: 2_100_000,
    added_at: daysAgo(90), // 半年内
  }),
  base({
    title: "无元数据单片 (2005)",
    file_path: "/nas/Kodi 式单片/无元数据单片 (2005)/无元数据单片 (2005).mp4",
    play_count: 7, // 6-10 次桶
  }),

  // —— 平铺电影 ——
  base({
    title: "The Matrix",
    file_path: "/nas/平铺电影/The.Matrix.1999.mkv",
    year: 1999,
    rating: 8.7,
    plot: "A computer hacker learns about the true nature of his reality.",
    genres: "Action, Sci-Fi",
    actors: "Keanu Reeves, Laurence Fishburne",
    duration_seconds: 6,
    width: 640,
    height: 360,
    file_size: 4_300_000,
    play_count: 3, // 2-5 次桶
    is_watched: 1,
    last_accessed: daysAgo(5), // 最近一周
    added_at: daysAgo(10), // 本月入库
  }),
  base({
    title: "The Dark Knight 2008",
    file_path: "/nas/平铺电影/The Dark Knight 2008.mp4",
    play_count: 0,
  }),
  base({
    // 无 NFO、无探针信息的裸条目：所有可选字段 undefined，UI 不得崩
    title: "some movie name",
    file_path: "/nas/平铺电影/some_movie_name.mp4",
    is_watched: 0,
  }),
  base({
    title: "损坏文件",
    file_path: "/nas/平铺电影/损坏文件.mp4",
    // 探针失败的条目：无时长/尺寸，只有标题
    scan_state: "checked",
  }),
  base({
    title: "webm 样本",
    file_path: "/nas/平铺电影/webm 样本.webm",
    duration_seconds: 4,
    width: 320,
    height: 180,
    file_size: 1_800_000,
  }),
  base({
    title: "deep movie",
    file_path: "/nas/深嵌套/a/b/c/deep movie.mp4",
    added_at: daysAgo(400), // 更早
  }),

  // —— 系列（group_id 指向 video_groups 表）——
  base({
    title: "流浪地球（上）",
    file_path: "/nas/系列/流浪地球三部曲/流浪地球 上集.mp4",
    year: 2019,
    genres: "科幻",
    actors: "屈楚萧, 吴京",
    duration_seconds: 4,
    width: 320,
    height: 180,
    group_id: 1,
  }),
  base({
    title: "流浪地球 中集",
    file_path: "/nas/系列/流浪地球三部曲/流浪地球 中集.mp4",
    group_id: 1,
  }),
  base({
    title: "流浪地球 下集",
    file_path: "/nas/系列/流浪地球三部曲/流浪地球 下集.mp4",
    group_id: 1,
  }),
  base({
    title: "Running Man 第1集",
    file_path: "/nas/系列/综艺/Running Man 第1集.mp4",
    group_id: 2,
    play_count: 6,
  }),
  base({
    title: "Running Man 第2集",
    file_path: "/nas/系列/综艺/Running Man 第2集.mp4",
    group_id: 2,
    play_count: 6,
  }),
  base({
    title: "Live Concert CD1",
    file_path: "/nas/系列/演唱会/Live Concert CD1.mp4",
    rating: 7.0,
    group_id: 3,
  }),
  base({
    title: "Live Concert CD2",
    file_path: "/nas/系列/演唱会/Live Concert CD2.mkv",
    rating: 7.0,
    group_id: 3,
  }),
  base({
    // 匹配了系列模式但只有一部：不成组（group_id 保持 undefined）
    title: "孤独的单部 CD1",
    file_path: "/nas/系列/孤独的单部 CD1.mp4",
  }),
  base({
    title: "Anime Series EP01",
    file_path: "/nas/系列/动画/Anime Series EP01.mp4",
    rating: 7.2,
    play_count: 2,
    added_at: daysAgo(15), // 本月入库
  }),
];

export const fixtureMovieByTitle = (title: string): Movie => {
  const found = fixtureMovies.find((m) => m.title === title);
  if (!found) {
    throw new Error(`fixtures 里没有标题为 "${title}" 的条目`);
  }
  return found;
};
