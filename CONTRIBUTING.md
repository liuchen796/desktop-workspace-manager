# 参与贡献

感谢你愿意帮助改进桌面工作台。

## 提交问题

提交 Issue 前请先搜索是否已有相同问题，并尽量提供：

- Windows 版本、屏幕数量和缩放比例
- 桌面工作台版本
- 可重复的操作步骤
- 预期结果与实际结果
- 脱敏后的截图或错误信息

不要上传真实桌面路径、账号信息、私人文件名或 `%APPDATA%\DesktopWorkspaceManager` 中的完整用户配置。

## 本地开发

```powershell
npm.cmd install
npm.cmd run dev
```

提交代码前请运行：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
```

## Pull Request

- 一个 PR 聚焦一个问题或功能。
- 遵循现有 Electron、React 和 TypeScript 代码风格。
- 文件系统访问必须留在主进程，通过安全 preload IPC 暴露最小接口。
- 涉及移动、恢复、路径校验或设置迁移的修改必须补充测试。
- UI 修改需要同时检查主窗口、快速面板、浅色/深色主题及 125%/150% 缩放。
- 不要提交 `node_modules`、`dist`、`release`、`artifacts` 或用户数据。

## 安全原则

任何真实整理功能都应遵循：先预览、再确认、不覆盖、可恢复。公共桌面和桌面外入口默认只做虚拟管理。
