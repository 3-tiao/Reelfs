# 搜索功能与日志系统优化方案

## 📋 概述

本文档详细说明 Reelfs 项目中搜索功能和日志系统的优化方案，包括技术设计、实施计划和评审流程。

---

## 1. 日志系统优化

### 1.1 现状分析

**当前问题：**
- 使用原生 `console.log` / `console.error` 输出日志
- 缺少统一的日志格式和级别管理
- 无法在生产环境控制日志输出
- 缺少模块标识和时间戳
- 日志难以追踪和过滤

**当前使用位置：**
- `src/pages/Search.tsx` - 搜索页面日志
- `src/pages/Home.tsx` - 首页日志
- `src/stores/movieStore.ts` - 状态管理日志
- `src-tauri/src/*.rs` - Rust 后端日志

### 1.2 目标

1. **统一日志格式**：时间戳 + 级别 + 模块 + 消息
2. **日志分级**：DEBUG, INFO, WARN, ERROR
3. **可配置化**：支持环境变量控制日志级别
4. **模块标识**：清晰标识日志来源
5. **结构化输出**：便于日志分析和过滤

### 1.3 技术方案

#### 方案选择：自定义 Logger 工具类

**优势：**
- 轻量级，无需额外依赖
- 完全可控，易于定制
- 支持 TypeScript 类型安全
- 与 Tauri 后端日志风格一致

**实现结构：**

```typescript
// src/lib/logger.ts
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogConfig {
  level: LogLevel;
  enableTimestamp: boolean;
  enableModule: boolean;
  enableColor: boolean;
}

class Logger {
  private config: LogConfig;
  private module: string;

  constructor(module: string, config?: Partial<LogConfig>) {
    this.module = module;
    this.config = {
      level: this.getLogLevelFromEnv(),
      enableTimestamp: true,
      enableModule: true,
      enableColor: true,
      ...config,
    };
  }

  private getLogLevelFromEnv(): LogLevel {
    const env = import.meta.env.VITE_LOG_LEVEL || 'INFO';
    return LogLevel[env as keyof typeof LogLevel] || LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = this.config.enableTimestamp
      ? `[${new Date().toISOString()}] `
      : '';
    const module = this.config.enableModule ? `[${this.module}] ` : '';
    return `${timestamp}${module}${message}`;
  }

  debug(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.format(LogLevel.DEBUG, message), ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.format(LogLevel.INFO, message), ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.format(LogLevel.WARN, message), ...args);
    }
  }

  error(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.format(LogLevel.ERROR, message), ...args);
    }
  }
}

export const createLogger = (module: string) => new Logger(module);
```

**使用示例：**

```typescript
// src/pages/Search.tsx
import { createLogger } from '../lib/logger';

const logger = createLogger('SearchPage');

logger.info('开始搜索:', query);
logger.debug('搜索参数:', { query, offset });
logger.warn('搜索结果为空');
logger.error('搜索失败:', error);
```

**环境变量配置：**

```bash
# .env.development
VITE_LOG_LEVEL=DEBUG

# .env.production
VITE_LOG_LEVEL=INFO
```

### 1.4 实施步骤

1. ✅ 创建 `src/lib/logger.ts` 模块
2. ⬜ 替换所有 `console.log` 为 logger 调用
3. ⬜ 添加环境变量配置文件
4. ⬜ 更新 Rust 后端日志格式（保持一致）
5. ⬜ 测试不同日志级别的输出

### 1.5 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/lib/logger.ts` | 新建 | Logger 工具类 |
| `.env.development` | 新建 | 开发环境配置 |
| `.env.production` | 新建 | 生产环境配置 |
| `src/pages/Search.tsx` | 修改 | 替换 console.log |
| `src/pages/Home.tsx` | 修改 | 替换 console.log |
| `src/stores/movieStore.ts` | 修改 | 替换 console.log |
| `src-tauri/src/*.rs` | 修改 | 统一日志格式 |

---

## 2. 搜索功能刷新逻辑优化

### 2.1 现状分析

**当前实现：**
- SearchBar 组件使用 300ms 防抖
- Search 页面直接调用 searchMovies
- 缺少搜索关键字变更检测
- 清空搜索时重新加载完整列表

**存在的问题：**
1. ❌ 重复搜索：相同关键字可能触发多次搜索
2. ❌ 无效搜索：快速输入删除可能触发不必要的请求
3. ❌ 状态管理不完善：缺少完整的搜索状态追踪
4. ❌ 错误处理不足：搜索失败后用户反馈不明确

### 2.2 目标

1. **智能防抖**：300-500ms 延迟，避免频繁请求
2. **重复检测**：相同关键字不重复搜索
3. **完整状态管理**：加载中、有结果、无结果、错误
4. **优化用户体验**：清晰的加载和错误提示

### 2.3 技术方案

#### 方案设计：增强的搜索状态管理

**状态结构：**

```typescript
interface SearchState {
  query: string;              // 当前搜索词
  lastQuery: string;          // 上一次有效搜索词
  isSearching: boolean;       // 是否正在搜索
  hasSearched: boolean;      // 是否执行过搜索
  results: Movie[];           // 搜索结果
  resultCount: number;        // 结果数量
  error: string | null;       // 错误信息
  lastSearchTime: number;     // 上次搜索时间戳
}
```

**防抖与重复检测逻辑：**

```typescript
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_CACHE_TTL_MS = 5000; // 缓存有效期 5 秒

class SearchManager {
  private debounceTimer: NodeJS.Timeout | null = null;
  private searchCache: Map<string, { results: Movie[]; timestamp: number }> = new Map();

  search(query: string, onSearch: (q: string) => void) {
    // 清除之前的防抖定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 检查是否为空查询
    if (!query.trim()) {
      this.debounceTimer = setTimeout(() => {
        onSearch('');
      }, SEARCH_DEBOUNCE_MS);
      return;
    }

    // 检查缓存
    const cached = this.searchCache.get(query);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < SEARCH_CACHE_TTL_MS) {
      console.log('[SearchManager] 使用缓存结果:', query);
      return;
    }

    // 设置防抖定时器
    this.debounceTimer = setTimeout(() => {
      console.log('[SearchManager] 执行搜索:', query);
      onSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  updateCache(query: string, results: Movie[]) {
    this.searchCache.set(query, {
      results,
      timestamp: Date.now(),
    });
  }

  clearCache() {
    this.searchCache.clear();
  }
}
```

**组件集成：**

```typescript
// src/pages/Search.tsx
import { createLogger } from '../lib/logger';

const logger = createLogger('SearchPage');
const searchManager = new SearchManager();

function Search() {
  const [state, setState] = useState<SearchState>({
    query: '',
    lastQuery: '',
    isSearching: false,
    hasSearched: false,
    results: [],
    resultCount: 0,
    error: null,
    lastSearchTime: 0,
  });

  const handleSearch = (query: string) => {
    setState(prev => ({ ...prev, query }));

    searchManager.search(query, async (searchQuery) => {
      if (!searchQuery.trim()) {
        logger.info('清空搜索，重新加载完整列表');
        reset();
        fetchMovies(0);
        setState(prev => ({
          ...prev,
          isSearching: false,
          hasSearched: false,
          results: [],
          resultCount: 0,
          error: null,
        }));
        return;
      }

      // 重复检测
      if (searchQuery === state.lastQuery) {
        logger.debug('搜索词未变化，跳过搜索');
        return;
      }

      logger.info('开始搜索:', searchQuery);
      setState(prev => ({
        ...prev,
        isSearching: true,
        lastQuery: searchQuery,
        lastSearchTime: Date.now(),
      }));

      try {
        const movies = await searchMovies(searchQuery);
        logger.info('搜索完成，找到', movies.length, '个结果');

        searchManager.updateCache(searchQuery, movies);

        setState(prev => ({
          ...prev,
          isSearching: false,
          hasSearched: true,
          results: movies,
          resultCount: movies.length,
          error: null,
        }));
      } catch (error) {
        logger.error('搜索失败:', error);
        setState(prev => ({
          ...prev,
          isSearching: false,
          hasSearched: true,
          error: String(error),
        }));
      }
    });
  };

  // 渲染逻辑...
}
```

### 2.4 优化效果

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 快速输入 "abc" | 触发 3 次搜索 | 触发 1 次搜索（防抖） |
| 重复搜索 "abc" | 每次都搜索 | 使用缓存结果 |
| 删除所有输入 | 重新加载列表 | 立即清空并加载 |
| 搜索失败 | 无明确提示 | 显示错误信息 |
| 网络慢 | 多次请求堆积 | 单次请求，状态清晰 |

### 2.5 实施步骤

1. ✅ 创建 `src/lib/searchManager.ts` 搜索管理器
2. ✅ 创建 `src/lib/logger.ts` 日志工具
3. ⬜ 更新 `src/pages/Search.tsx` 集成新逻辑
4. ⬜ 更新 `src/components/SearchBar.tsx` 优化防抖
5. ⬜ 添加搜索状态 UI 组件（加载、错误、空结果）
6. ⬜ 测试各种搜索场景

### 2.6 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/lib/searchManager.ts` | 新建 | 搜索管理器 |
| `src/lib/logger.ts` | 新建 | 日志工具 |
| `src/pages/Search.tsx` | 重构 | 集成搜索管理器 |
| `src/components/SearchBar.tsx` | 优化 | 防抖逻辑 |
| `src/stores/movieStore.ts` | 优化 | 添加搜索状态 |

---

## 3. 方案设计与评审流程

### 3.1 技术评审准备

**评审材料：**
1. 本技术方案文档
2. 代码原型和示例
3. 测试用例清单
4. 风险评估和缓解措施

**评审议程：**
1. 日志系统方案评审（15分钟）
   - Logger 设计合理性
   - 环境变量配置
   - 与 Rust 后端一致性

2. 搜索优化方案评审（20分钟）
   - 防抖和缓存策略
   - 状态管理设计
   - 用户体验优化

3. 实施计划评审（10分钟）
   - 开发时间估算
   - 测试计划
   - 上线策略

4. 风险和问题讨论（15分钟）
   - 潜在风险识别
   - 依赖和兼容性
   - 回滚方案

### 3.2 时间估算

| 任务 | 预估时间 | 负责人 |
|------|-----------|---------|
| Logger 工具开发 | 2 小时 | 前端开发 |
| 替换所有 console.log | 3 小时 | 前端开发 |
| SearchManager 开发 | 2 小时 | 前端开发 |
| Search 页面重构 | 3 小时 | 前端开发 |
| SearchBar 优化 | 1 小时 | 前端开发 |
| 单元测试 | 2 小时 | 前端开发 |
| 集成测试 | 2 小时 | QA |
| **总计** | **15 小时** | - |

### 3.3 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| Logger 性能问题 | 中 | 低 | 使用轻量级实现，性能测试 |
| 搜索缓存失效 | 中 | 中 | 添加缓存失效机制 |
| 状态管理复杂度增加 | 低 | 高 | 清晰的状态定义和文档 |
| 向后兼容性问题 | 高 | 低 | 保留 console.log 作为降级方案 |
| 测试覆盖不足 | 中 | 中 | 完善测试用例 |

### 3.4 评审检查清单

**日志系统：**
- [ ] Logger 设计合理，易于使用
- [ ] 支持所有需要的日志级别
- [ ] 环境变量配置正确
- [ ] 与 Rust 后端日志格式一致
- [ ] 性能影响可接受

**搜索优化：**
- [ ] 防抖时间合理（300-500ms）
- [ ] 重复检测有效
- [ ] 缓存策略合理
- [ ] 状态管理清晰
- [ ] 用户体验提升明显

**实施计划：**
- [ ] 时间估算合理
- [ ] 测试计划完整
- [ ] 风险识别充分
- [ ] 回滚方案可行

### 3.5 批准标准

**必须满足：**
1. ✅ Logger 功能完整，支持所有日志级别
2. ✅ 搜索优化效果明显，减少无效请求
3. ✅ 代码质量良好，有适当测试
4. ✅ 文档完整，易于维护

**期望满足：**
1. ⬜ 性能提升 > 30%（搜索响应时间）
2. ⬜ 日志可读性提升明显
3. ⬜ 代码复用性高，易于扩展

### 3.6 评审后行动

**批准后：**
1. 立即开始实施
2. 每日同步进度
3. 完成后进行代码审查
4. 通过审查后合并到主分支

**需要修改：**
1. 根据反馈修改方案
2. 更新技术方案文档
3. 重新安排评审会议
4. 重复评审流程

---

## 4. 实施计划

### 4.1 阶段划分

**阶段 1：基础设施（Day 1）**
- 创建 Logger 工具
- 创建 SearchManager 工具
- 添加环境变量配置

**阶段 2：集成实施（Day 2-3）**
- 替换所有 console.log
- 重构 Search 页面
- 优化 SearchBar 组件

**阶段 3：测试验证（Day 4）**
- 单元测试
- 集成测试
- 性能测试

**阶段 4：上线部署（Day 5）**
- 代码审查
- 合并到主分支
- 监控和观察

### 4.2 成功指标

**日志系统：**
- 所有 console.log 已替换
- 日志格式统一
- 生产环境日志级别正确

**搜索优化：**
- 搜索请求减少 > 50%
- 搜索响应时间 < 300ms
- 用户体验评分 > 4.5/5

---

## 5. 附录

### 5.1 参考文档

- [Zustand 文档](https://zustand-demo.pmnd.rs/)
- [React 防抖模式](https://reactpatterns.com/)
- [Console API](https://developer.mozilla.org/en-US/docs/Web/API/console)

### 5.2 相关 Issue

- Issue #1: 搜索功能优化需求
- Issue #2: 日志系统改进

### 5.3 变更历史

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-02-24 | 1.0 | 初始版本 | AI Assistant |

---

**文档版本：** 1.0
**最后更新：** 2026-02-24
**维护者：** Reelfs 开发团队
