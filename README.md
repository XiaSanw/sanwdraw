# SanwDraw

SanwDraw 是面向机器人、嵌入式系统和机电设备的硬件架构画布。它把控制板、传感器、电源、执行器及其外部接口作为可编辑对象，用接近流程图的方式组织电源网络和通信网络。

项目目前处于早期开发阶段，工程文件使用自有的 `.sanwdraw` 格式。

## 当前能力

- 在自由画布中添加、移动和编辑硬件组件。
- 为组件编辑名称、描述和颜色，增加电源或信号接口，并设置协议、电压、所在边和边缘位置。
- 接口框环绕组件主框；左、上、右、下接口分别从对应外侧出线，换边后会自动等距分布。
- 多个接口可组成共享母线，同时保留每条支路的独立语义。
- 支持拖动母线汇合点、自定义支路拐点，以及单独删除一条支路；手动走线可吸附为平行或 90°。
- 组件、母线和单条支路均可自定义颜色；支路可恢复继承母线颜色。
- 支持添加文字和图片。
- 器件栏可调整宽度、收起和展开。
- 工程可保存为 `.sanwdraw`，图片资源会一并封装进工程。

## 技术栈

- [Tauri 2](https://v2.tauri.app/)
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/)
- Rust
- pnpm

## 快速开始

需要安装 Node.js LTS 和 pnpm。运行 Tauri 桌面应用还需要 Rust 及当前系统对应的 Tauri 前置依赖。

```bash
git clone git@github.com:XiaSanw/sanwdraw.git
cd sanwdraw
pnpm install
```

只启动网页前端：

```bash
pnpm dev
```

启动桌面开发应用：

```bash
pnpm desktop:dev
```

生成当前平台的 Release 安装包：

```bash
pnpm desktop:build
```

Windows 的完整安装、环境检查和故障排除说明见 [WINDOWS.md](./WINDOWS.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动 Vite 前端开发服务器 |
| `pnpm build` | TypeScript 检查并构建前端 |
| `pnpm preview` | 预览前端生产构建 |
| `pnpm desktop:dev` | 启动 Tauri 桌面开发应用 |
| `pnpm desktop:build` | 构建并打包当前平台的桌面应用 |

## 基本操作

- 从左侧器件栏单击组件，或将其拖入画布。
- 选中组件后，在右侧属性栏修改组件颜色、添加接口或编辑接口属性。
- 点击一个接口会展开对应属性并开始连线，再点击另一个接口完成连接。
- 长按接口框约 0.4 秒进入位置调整模式，可沿中心框拖到其他边；松手不会开始连线，换边后该边接口自动等距分布。
- 接口换边、调整边缘位置或等距重排时，仅受影响支路会清除旧拐点并重新自动走线，其他支路与母线汇合点保持不变。
- 自动走线会先沿接口朝外引出一小段，再进行第一次 90° 转弯，避免线路贴着接口框边缘经过。
- 将新接口连接到已有线路，可把它吸附到共享母线。
- 点击线段选择单条支路；点击汇合点选择整条母线。
- 双击线段增加拐点，拖动圆点调整路径，双击拐点删除；靠近水平或垂直方向时会自动吸附，按住 `Alt` 可临时自由拖动。
- 删除单条支路只断开当前接口，不会删除母线的其他连接。
- 左侧设置中可以调整接口框与组件主框的间距。
- 触控板双指滑动用于平移画布，双指捏合用于以指针位置为中心缩放；鼠标可使用 `Ctrl/Command + 滚轮` 缩放。

## `.sanwdraw` 工程格式

`.sanwdraw` 是 ZIP 容器，主要包含：

```text
document.json     画布元素、接口、网络、路径和界面设置
assets/           导入工程的图片资源
```

工程不保存本机绝对路径，因此可以在 macOS 和 Windows 之间传递。当前格式版本为 `schemaVersion: 1`。

## 项目结构

```text
src/
  canvas/         连线与画布几何
  model/          工程数据模型、模板、存档和示例数据
  ui/             通用界面组件
  App.tsx         主应用及交互
src-tauri/
  capabilities/   Tauri 权限配置
  src/            Rust 应用入口
  tauri.conf.json 通用桌面配置
  tauri.macos.conf.json
  tauri.windows.conf.json
WINDOWS.md         Windows 开发与打包指南
```

Tauri 会把 `tauri.windows.conf.json` 或 `tauri.macos.conf.json` 自动合并到通用配置中。本项目的 Windows 配置只生成 NSIS 安装程序。

## 构建产物

macOS：

```text
src-tauri/target/release/bundle/macos/SanwDraw.app
src-tauri/target/release/bundle/dmg/SanwDraw_<version>_<arch>.dmg
```

Windows：

```text
src-tauri\target\release\bundle\nsis\SanwDraw_<version>_<arch>-setup.exe
```

Windows 安装包应在 Windows 机器或 Windows CI Runner 上构建。开发阶段生成的安装包未进行代码签名，正式分发前需要配置 Windows 代码签名。

## 推荐开发工具

- [Visual Studio Code](https://code.visualstudio.com/)
- [Tauri VS Code Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 参考文档

- [Tauri 2 前置要求](https://v2.tauri.app/start/prerequisites/)
- [Tauri 平台专用配置](https://v2.tauri.app/develop/configuration-files/#platform-specific-configuration)
- [Tauri Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)
