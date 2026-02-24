# Cursor/Trae 风格实施指南

## 📋 概述

本指南详细说明如何将 Reelfs 应用改造为类似 Cursor/Trae 的现代化界面风格。

## 🎯 设计原则

### Cursor/Trae 风格核心特征

1. **深色主题优先**
   - 主色调：深灰/黑色 (#0a0a0a, #111111)
   - 强调色：蓝色/紫色渐变
   - 高对比度文字

2. **毛玻璃效果 (Glassmorphism)**
   - 半透明背景
   - backdrop-blur 模糊效果
   - 细微边框

3. **精致细节**
   - 微妙的阴影
   - 平滑的圆角 (8px - 12px)
   - 细边框 (1px, 透明度 10-20%)

4. **流畅交互**
   - 快速过渡动画 (150-200ms)
   - 悬停反馈
   - 按压效果

5. **现代排版**
   - 清晰的字体层级
   - 适当的行高和字间距
   - 使用系统字体

## 🏗️ 技术架构

### 核心技术栈

```
┌─────────────────────────────────────┐
│         React 18 + TypeScript        │
├─────────────────────────────────────┤
│      Tailwind CSS (样式系统)         │
├─────────────────────────────────────┤
│   Radix UI (无障碍组件基础)          │
├─────────────────────────────────────┤
│  Framer Motion (动画效果)            │
└─────────────────────────────────────┘
```

### 为什么选择这个方案？

| 技术 | 优势 | 在 Cursor/Trae 风格中的作用 |
|------|------|---------------------------|
| Tailwind CSS | 原子化、高度可定制 | 实现精确的视觉细节 |
| Radix UI | 无障碍、可组合 | 提供可靠的交互组件 |
| Framer Motion | 声明式动画 | 流畅的过渡效果 |
| CSS Variables | 动态主题 | 轻松切换主题颜色 |

## 📦 安装依赖

### 1. 安装核心依赖

```bash
npm install \
  @radix-ui/react-dialog \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-tooltip \
  @radix-ui/react-tabs \
  @radix-ui/react-separator \
  @radix-ui/react-scroll-area \
  framer-motion \
  class-variance-authority \
  clsx \
  tailwind-merge
```

### 2. 安装开发依赖

```bash
npm install -D @tailwindcss/typography
```

## 🔧 配置文件

### 1. Tailwind 配置 (tailwind.config.js)

已完成配置，包含：
- CSS 变量颜色系统
- 自定义圆角
- 动画关键帧
- 响应式断点

### 2. 全局样式 (src/styles/global.css)

已完成配置，包含：
- CSS 变量定义（深色主题）
- 基础样式重置
- 自定义滚动条样式

### 3. 工具函数 (src/lib/utils.ts)

已创建 `cn()` 函数，用于合并 Tailwind 类名。

## 🎨 设计系统

### 颜色规范

```css
/* 主色调 */
--background: 222.2 84% 4.9%;      /* 深黑背景 */
--foreground: 210 40% 98%;          /* 白色文字 */

/* 主按钮色 */
--primary: 217.2 91.2% 59.8%;       /* 蓝色 */
--primary-foreground: 222.2 47.4% 11.2%;

/* 次要色 */
--secondary: 217.2 32.6% 17.5%;     /* 深灰 */
--secondary-foreground: 210 40% 98%;

/* 边框和输入 */
--border: 217.2 32.6% 17.5%;       /* 半透明边框 */
--input: 217.2 32.6% 17.5%;
```

### 间距规范

```javascript
// Tailwind 默认间距
// 4px = 1 (0.25rem)
// 8px = 2 (0.5rem)
// 12px = 3 (0.75rem)
// 16px = 4 (1rem)
// 24px = 6 (1.5rem)
// 32px = 8 (2rem)
```

### 圆角规范

```javascript
--radius: 0.5rem;  // 8px
```

### 阴影规范

```css
/* 微妙阴影 */
shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);

/* 标准阴影 */
shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);

/* 大阴影 */
shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

/* 彩色阴影（用于强调） */
shadow-blue-500/25: 0 10px 15px -3px rgba(59, 130, 246, 0.25);
```

## 🧩 组件库

### 基础组件

已创建：
- ✅ Card (卡片)
- ✅ Button (按钮)

待创建：
- ⬜ Input (输入框)
- ⬜ Dialog (对话框)
- ⬜ Dropdown Menu (下拉菜单)
- ⬜ Tooltip (提示框)
- ⬜ Tabs (标签页)
- ⬜ Separator (分隔线)
- ⬜ Scroll Area (滚动区域)

### 组件使用示例

#### Button 组件

```tsx
import { Button } from "@/components/ui/button"

// 主要按钮
<Button>Click me</Button>

// 毛玻璃按钮
<Button variant="glass">Glass Button</Button>

// 幽灵按钮
<Button variant="ghost">Ghost Button</Button>

// 尺寸变体
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
```

#### Card 组件

```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
  </CardHeader>
  <CardContent>
    Card content goes here
  </CardContent>
</Card>
```

## 🎬 动画效果

### Framer Motion 集成

```tsx
import { motion } from "framer-motion"

// 淡入动画
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.2 }}
>

// 滑入动画
<motion.div
  initial={{ y: 20, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  transition={{ duration: 0.3 }}
>

// 缩放动画
<motion.div
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
>
```

### 常用动画配置

```javascript
// 快速淡入
const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.15 }
}

// 向上滑入
const slideUp = {
  initial: { y: 10, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  transition: { duration: 0.2 }
}

// 弹性效果
const spring = {
  type: "spring",
  stiffness: 300,
  damping: 20
}
```

## 📐 布局模式

### 1. 侧边栏布局

```tsx
<div className="flex h-screen bg-background">
  {/* 侧边栏 */}
  <aside className="w-64 border-r border-border/50 bg-card/50">
    {/* 侧边栏内容 */}
  </aside>

  {/* 主内容区 */}
  <main className="flex-1 overflow-auto">
    {/* 主内容 */}
  </main>
</div>
```

### 2. 顶部导航布局

```tsx
<div className="flex flex-col h-screen bg-background">
  {/* 顶部导航 */}
  <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-sm">
    {/* 导航内容 */}
  </header>

  {/* 主内容区 */}
  <main className="flex-1 overflow-auto">
    {/* 主内容 */}
  </main>
</div>
```

### 3. 网格布局

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* 网格项 */}
</div>
```

## 🔄 实施步骤

### 阶段 1：基础设施 (已完成 ✅)

- [x] 配置 Tailwind CSS
- [x] 设置 CSS 变量主题系统
- [x] 创建工具函数
- [x] 创建基础 UI 组件

### 阶段 2：组件库建设

- [ ] 创建 Input 组件
- [ ] 创建 Dialog 组件
- [ ] 创建 Dropdown Menu 组件
- [ ] 创建 Tooltip 组件
- [ ] 创建 Tabs 组件
- [ ] 创建 Separator 组件
- [ ] 创建 Scroll Area 组件

### 阶段 3：页面重构

- [ ] 重构 Home 页面
- [ ] 重构 MovieDetail 页面
- [ ] 重构 Settings 页面
- [ ] 重构 Search 页面

### 阶段 4：动画和交互

- [ ] 添加页面过渡动画
- [ ] 添加悬停效果
- [ ] 添加加载状态动画
- [ ] 优化滚动体验

### 阶段 5：细节优化

- [ ] 响应式适配
- [ ] 无障碍优化
- [ ] 性能优化
- [ ] 测试和修复

## 🎯 关键设计模式

### 1. 毛玻璃卡片

```tsx
<div className="bg-card/50 backdrop-blur-md border border-border/50 rounded-xl shadow-lg">
  {/* 内容 */}
</div>
```

### 2. 渐变按钮

```tsx
<button className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-lg shadow-lg shadow-blue-500/25">
  {/* 内容 */}
</button>
```

### 3. 悬停效果

```tsx
<div className="transition-all duration-200 hover:scale-105 hover:shadow-xl">
  {/* 内容 */}
</div>
```

### 4. 细边框

```tsx
<div className="border border-white/10">
  {/* 内容 */}
</div>
```

## 📚 参考资源

### 设计系统
- [Radix UI](https://www.radix-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)

### 动画
- [Framer Motion](https://www.framer.com/motion/)

### 灵感来源
- [Cursor](https://cursor.sh/)
- [Trae](https://www.trae.ai/)

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tooltip @radix-ui/react-tabs @radix-ui/react-separator @radix-ui/react-scroll-area framer-motion class-variance-authority clsx tailwind-merge
npm install -D @tailwindcss/typography
```

### 2. 使用组件

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

function MyComponent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hello World</CardTitle>
      </CardHeader>
      <CardContent>
        <Button>Click me</Button>
      </CardContent>
    </Card>
  )
}
```

## 🎨 最佳实践

1. **保持一致性** - 使用设计系统中的颜色、间距、圆角
2. **渐进增强** - 先实现功能，再添加动画
3. **性能优先** - 使用 CSS 动画而非 JavaScript 动画
4. **无障碍** - 确保键盘导航和屏幕阅读器支持
5. **响应式** - 移动优先，逐步增强

## 📝 注意事项

1. **CSS 变量** - 使用 HSL 格式，便于调整
2. **类名合并** - 使用 `cn()` 函数避免冲突
3. **动画时长** - 保持 150-300ms，避免过长
4. **透明度** - 使用 rgba 或 hsla 实现半透明效果
5. **边框** - 使用细边框 (1px) 和低透明度 (10-20%)

## 🎉 总结

通过本指南，你可以将 Reelfs 应用改造为具有 Cursor/Trae 风格的现代化界面。核心是：

1. ✅ 使用 Tailwind CSS 实现精确的视觉细节
2. ✅ 使用 Radix UI 提供可靠的交互组件
3. ✅ 使用 Framer Motion 添加流畅的动画
4. ✅ 使用 CSS 变量实现动态主题

开始实施吧！🚀
