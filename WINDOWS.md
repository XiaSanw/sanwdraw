# SanwDraw Windows 开发与打包指南

本文面向第一次在 Windows 上参与 SanwDraw 开发的同事。建议使用 64 位 Windows 10 或 Windows 11，并在 PowerShell 中执行命令。

SanwDraw 使用同一套 React、TypeScript 和 Rust 源码支持 macOS 与 Windows。Windows 桌面端通过 Tauri 2 调用系统 WebView2，并打包为 NSIS `-setup.exe` 安装程序。

## 1. 一次性安装开发环境

### 1.1 Git

安装 [Git for Windows](https://git-scm.com/download/win)，安装后重新打开 PowerShell：

```powershell
git --version
```

### 1.2 Microsoft C++ Build Tools

Tauri 在 Windows 上需要 MSVC 编译器和 Windows SDK。

1. 下载并运行 [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)。
2. 勾选 **Desktop development with C++（使用 C++ 的桌面开发）** 工作负载。
3. 保留该工作负载默认选择的 MSVC 工具链和 Windows 10/11 SDK。
4. 安装完成后重新启动 PowerShell；如果系统要求重启，则重启 Windows。

已经安装 Visual Studio 2022 的同事，可以在 Visual Studio Installer 中点击“修改”，补选相同工作负载。

### 1.3 Microsoft Edge WebView2

Windows 10 1803 及更高版本通常已经包含 WebView2。若启动 Tauri 应用时提示 WebView2 缺失，请安装 [WebView2 Evergreen Bootstrapper](https://developer.microsoft.com/microsoft-edge/webview2/)。

### 1.4 Node.js LTS 与 pnpm

从 [Node.js 官网](https://nodejs.org/)安装 LTS 版本，然后重新打开 PowerShell：

```powershell
node --version
npm --version
```

项目固定使用 `pnpm@11.19.0`：

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm --version
```

如果安装的 Node.js 没有提供 Corepack，也可以使用：

```powershell
npm install --global pnpm@11.19.0
```

### 1.5 Rust MSVC 工具链

使用 `winget` 安装 rustup：

```powershell
winget install --id Rustlang.Rustup
```

关闭并重新打开 PowerShell，然后确保使用 MSVC 工具链：

```powershell
rustup default stable-msvc
rustc --version
cargo --version
rustup show active-toolchain
```

普通 64 位 Intel/AMD Windows 机器应看到类似：

```text
stable-x86_64-pc-windows-msvc
```

Windows on ARM 机器对应 `aarch64-pc-windows-msvc`。

## 2. 获取项目

已经配置 GitHub SSH Key：

```powershell
git clone git@github.com:XiaSanw/sanwdraw.git
cd sanwdraw
```

尚未配置 SSH Key，可使用 HTTPS：

```powershell
git clone https://github.com/XiaSanw/sanwdraw.git
cd sanwdraw
```

安装依赖：

```powershell
pnpm install --frozen-lockfile
```

## 3. 开发运行

只开发 React 前端：

```powershell
pnpm dev
```

启动完整 Tauri 桌面应用：

```powershell
pnpm desktop:dev
```

第一次运行会下载并编译 Rust 依赖，耗时会明显长于后续启动。

提交代码前至少执行：

```powershell
pnpm build
```

## 4. 生成 Windows 安装包

```powershell
pnpm desktop:build
```

Windows 会自动把 `src-tauri\tauri.windows.conf.json` 合并到通用的 `tauri.conf.json`。本项目在 Windows 上只启用 NSIS，因此安装包位于：

```text
src-tauri\target\release\bundle\nsis\SanwDraw_<version>_<arch>-setup.exe
```

可以用 PowerShell 查看实际文件名：

```powershell
Get-ChildItem .\src-tauri\target\release\bundle\nsis\
```

默认 NSIS 安装程序安装到当前用户，不需要管理员权限。开发阶段构建的 EXE 没有代码签名，Windows SmartScreen 可能显示警告；对外发布前应配置 [Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)。

## 5. 更新代码

```powershell
git pull --rebase
pnpm install --frozen-lockfile
pnpm desktop:dev
```

如果 `pnpm-lock.yaml` 没有变化，通常不需要重复下载全部依赖。

## 6. 常见问题

### `link.exe not found` 或无法找到 MSVC

打开 Visual Studio Installer，确认 Build Tools 已勾选 **Desktop development with C++**，然后重新打开 PowerShell。仍有问题时可从开始菜单启动 **Developer PowerShell for VS 2022** 再运行构建命令。

### Rust 使用了 GNU 工具链

```powershell
rustup default stable-msvc
rustup show active-toolchain
```

工具链名称应以 `-pc-windows-msvc` 结尾。

### 找不到 `pnpm`

重新打开 PowerShell，然后运行：

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
```

若 Corepack 不可用，使用 `npm install --global pnpm@11.19.0`。

### PowerShell 阻止运行 `pnpm.ps1`

可以直接调用：

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd desktop:dev
```

也可以在符合公司安全策略的前提下，将当前用户执行策略调整为 `RemoteSigned`。

### WebView2 缺失或窗口无法显示

安装最新 [WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)，完成后重新启动应用。

### Rust 依赖下载慢或首次编译时间长

第一次 Tauri 构建需要下载 crates 并完整编译，这是正常现象。不要提交 `node_modules`、`dist` 或 `src-tauri\target`。

### 构建成功但找不到安装包

确认运行的是 `pnpm desktop:build`，然后检查：

```powershell
Get-ChildItem .\src-tauri\target\release\bundle\ -Recurse
```

## 7. 跨平台开发约束

- 不在业务代码中手工拼接 `/` 或 `\` 文件路径；文件选择和保存使用 Tauri API。
- 工程文件名需要过滤 Windows 不允许的字符。
- `.sanwdraw` 不保存本机绝对路径，图片资源封装在工程文件内。
- 不提交 `node_modules`、`dist`、`src-tauri\target` 或本机环境文件。
- Windows 安装包优先在 Windows 本机或 GitHub Actions Windows Runner 上构建。
- 修改平台专用配置时注意：Tauri 使用 JSON Merge Patch，配置中的数组会整体替换，而不是追加。

## 8. 官方参考

- [Tauri 2 Windows 前置要求](https://v2.tauri.app/start/prerequisites/#windows)
- [Tauri 平台专用配置](https://v2.tauri.app/develop/configuration-files/#platform-specific-configuration)
- [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)
- [Rust 安装](https://www.rust-lang.org/tools/install)
