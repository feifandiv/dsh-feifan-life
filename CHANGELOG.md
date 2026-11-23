# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [0.3.0] - 2026-11-23

### Added

- **今日聚焦悬浮球（全局）**：钉选的任务以悬浮球常驻 DSH 全局悬浮层，离开非凡人生面板（聊天页、插件页等）也可见。球可拖动，松手自动吸附窗口最近边（左右上下四边），位置记忆；点球展开聚焦卡片。
- **聚焦卡片**：今日聚焦同款行样式，任务分组展示（父任务 + 子项竖线缩进），已完成/已归档项自动隐藏；点名称返回任务看板并定位（保留项目分组筛选）；悬浮层只做预览与导航，完成操作统一在任务看板进行。
- **「选择」筛选**：从全部今日聚焦里挑选要悬浮的子集（按天记忆），卡片与悬浮球计数只反映精选集。
- **macOS 系统置顶窗**：点击「悬浮到其他软件上方」，由 Host 端按需编译的原生 Swift NSPanel（LSUIElement）悬浮到任何应用（微信、抖音等）之上，与插件数据实时同步；点击系统窗中的任务会把 DSH 桌面端带到前台并定位任务。浏览器环境自动回退 Document Picture-in-Picture。
- **外部变更自动刷新**：主数据文件被 AI 侧直接改写后，面板 4 秒内自动检测 mtime 并重载（含未落盘保护与页面隐藏跳过）；页签栏新增「从磁盘刷新」手动按钮。
- Host 端原生能力路由 `/dsh-feifan-life/api/focus-window`，经 `connection.requestRejection` 宿主鉴权。

### Changed

- 进入非凡人生默认落在「任务」页（`settings.defaultTab` 统一为 `tasks`）。
- 从今日聚焦/搜索跳转任务时，项目筛选定到该任务所在分组，不再重置为「全部项目」。
- 任务量化输入框加宽：`8ch` 按位数自适应并隐藏 number 原生箭头，长数字不再被裁切。
- 卡片小按钮全部改为 pointerup 主触发 + click 兜底去重，免疫全局划词/手势监听造成的 click 丢失。

### Fixed

- 轻量启动（stores-only）与全量启动（含全库索引）拆分，修复悬浮条先于面板启动导致的面板挂载失败。
- 包名规范化后 client bundle 内嵌模块 id 未同步导致客户端不加载的问题（重建后一致）。

## [0.2.3] - 2026-11-13

- 首个公开版本：非凡人生 Obsidian 插件完整移植进 DSH（任务/规划/财务/清单/习惯/灵感/复盘），数据独立存储于 `08-系统/09非凡人生数据`，Host 文件 API 全局限定双根目录。
