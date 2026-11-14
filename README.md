<p align="center">
  <img src="docs/logo-ghost-wave-effect.svg" alt="Reasonix" width="360"/>
</p>

> [!NOTE]
> 本仓库是[DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 的个人 fork。
>
> 上游在 于2026-11-11 停在 v2.61.0。本仓库从这里继续，对 Reasonix Studio 做小范围的改动。
> 部分功能引用以下仓库
> https://github.com/FuchaZ/DeepSeek-Reasonix
> https://github.com/Oliver-Rui/DeepSeek-Reasonix-torch
> 欢迎加入QQ交流群共同讨论：1821170167

<p align="center">
  <a href="./docs/GUIDE.zh-CN.md">指南</a>
  &nbsp;·&nbsp;
  <a href="./docs/ACP.md">ACP</a>
  &nbsp;·&nbsp;
  <a href="./docs/EXTENSIONS.md">扩展开发</a>
  &nbsp;·&nbsp;
  <a href="./docs/SPEC.md">规格</a>
</p>

<p align="center">
  <a href="https://github.com/qiyuess/reasonix-studio/releases"><img src="https://img.shields.io/github/v/release/qiyuess/reasonix-studio.svg?style=flat-square&color=8250df&labelColor=161b22&label=studio" alt="Release"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b949e.svg?style=flat-square&labelColor=161b22" alt="license"/></a>
  <a href="https://github.com/qiyuess/reasonix-studio/stargazers"><img src="https://img.shields.io/github/stars/qiyuess/reasonix-studio.svg?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="GitHub stars"/></a>
</p>

<br/>

<p align="center"><strong>开源 · MIT · 程序跑在你电脑上，模型自选</strong></p>
<h3 align="center">终端、桌面、浏览器、编辑器里都能用的 AI 编程助手。</h3>
<p align="center">它会读你的项目、改文件、跑命令和测试。每一步先问你，或在你划定的范围内自己做，由你选；它用编辑工具改过的文件可以退回去。第一次用，从桌面应用 Studio 开始。</p>

<br/>

## 本仓库改了什么

引擎保持上游原样。改动都在 Reasonix Studio（桌面应用）里，范围小、可review：

- **工作台**：重构启动工作台之后的显示样式。标签条随后移到窗口栏上，与下方对话区共用同一条分隔线。
- **够到任意标签**：标签条头部加了切换按钮，列出所有已打开的标签。被滚动藏起来或被别的标签挤到后面的，一次点击就到，不用滚动加猜。
- **标签名跟着网页走**：标签用页面自己的标题命名，页面改名就跟着改——加载完成后、脚本改写时、以及不加载文档的路由切换都会更新。以前没被模型操作过的页面会一直显示网址。
- **启动与布局细节**：冷启动时项目列表默认收起，启动页居中且不显示标题，开机画面是跟随主题的安静版本。
- **小修小补**：桌面外壳与会话存储里的窄范围缺陷，一次修一个，每个都有对应测试。
- **去除原版云端相关内容**：由于上游停止维护已关闭相关云服务，本仓库已去除相关内容。
改动保持小而可 review，没有重写。

## 它是什么

Reasonix 是一个开源的 AI 编程助手。程序跑在你的电脑上；AI 模型是你自己配置的服务，它读到的内容会发给这个服务。你用大白话描述任务，它在你选的项目文件夹里读代码、改文件、跑命令和测试，每一步都摆给你看。

模型你自己选：内置 DeepSeek 预设，其他兼容 OpenAI 接口的服务填一条配置就行，费用直接付给模型服务商。

## 你能得到什么

- **读、改、跑**：读你的项目、改文件、跑测试和命令，都在你选的项目文件夹里。
- **权限分档**：每次都问你，或让日常操作自动放行；你设的禁止规则始终有效。想先看方案，就开计划模式，批准后它才动手。
- **可回退**：改文件前先存快照，按对话轮次回退，不碰 git 历史。只覆盖编辑工具改的文件，命令行命令造成的改动不在内。

## 30 秒上手

下载、填模型密钥、打开项目。第一次用，从桌面应用 Studio 开始。

1. 从[发布页](https://github.com/qiyuess/reasonix-studio/releases)下载并安装桌面应用 Reasonix Studio。
2. 打开应用，按提示填入模型服务商和密钥。
3. 打开你的项目文件夹，写下想做的事，例如“给 http 客户端加上失败重试”。
4. 按你选的档位，该问你的操作它会先停下来问；同意就继续，不同意就拒绝。

更喜欢终端的话，下载 `reasonix` 命令行后运行 `reasonix setup` 配好模型，再运行 `reasonix` 即可。详见[安装](#安装)和[快速开始](#快速开始)。

## 四种用法

- **桌面应用（Studio）**：图形界面，适合第一次使用。
- **终端**：全屏文字界面，也能用 `reasonix run "任务"` 在脚本里运行。
- **浏览器**：`reasonix web` 在本机打开网页界面。
- **编辑器**：VS Code 安装扩展即可；其他支持 ACP（Agent Client Protocol，编辑器接入某个 AI 助手的通用约定）的编辑器，可连接 `reasonix acp`。

四种用法背后是同一套程序。下面的内容写给进阶用户和贡献者。

## 在 DeepSeek Harness 里使用

DeepSeek Harness（`dsh`）可以通过 ACP 把任务交给 Reasonix 作为子智能体去做。本仓库为此发布了一个插件索引：

1. 在运行 `dsh` 的机器上先运行 `reasonix setup`。在 DSH 网页界面打开“自定义插件市场”（插件，更多），再到 Discover 页添加这个索引：`https://raw.githubusercontent.com/qiyuess/reasonix-studio/studio/integrations/dsh-plugin/market-index.json`
2. 从中安装“Reasonix subagent”。
3. 打开这个插件的页面，把它的开关打开。关着的时候模型没有 `reasonix` 工具，可能改在自己的 shell 里直接运行 `reasonix -p`，看起来像委派，其实不是。

配置细节、权限策略和限制见 [在 DeepSeek Harness 中使用 Reasonix](./docs/DSH.md)。

## 版本

本仓库从上游的 **v2.61.0** 接着做 —— 那是上游声明停止维护的那个版本。版本号从 **2.70.0** 起，沿本仓库自己的 `studio` 线往上走；跳过 2.62–2.69 是刻意的：应用内更新器仍在提供官方 2.61.0，比它低的版本会排在它后面，一更新就把本仓库的改动覆盖掉。

发布在本仓库自己的[发布页](https://github.com/qiyuess/reasonix-studio/releases)。v2.61.0 仍是上游最后一个版本。

## 特性

以下是写给进阶用户的技术要点。

- **配置驱动**：provider、agent、启用的工具、插件全部在 `reasonix.toml` 中声明，
  内核无硬编码模型。
- **多模型 · 可组合**：DeepSeek 作为预设内置；任何 OpenAI 兼容
  端点都只是一条配置。可选让两个模型协同（执行器 + 规划器），各自独立、缓存稳定的 session。
- **插件驱动**：MCP server 提供工具、提示词和资源；Extension Protocol v1
  Sidecar 还可以拦截运行时事件、提供 Provider 与结构化 UI，并通过版本化插件包分发。
- **缓存友好的上下文维护**：启动时注入稳定的环境摘要；旧工具输出会先 snip/prune，
  再进入摘要 compaction；内置工具 schema 合约有文档和回归测试保护。
- **零摩擦分发**：`CGO_ENABLED=0` 单二进制；一条命令交叉编译到六个目标平台。
  产物是完全自包含的静态二进制——目标机器上除二进制本身外无需安装任何东西。

## 安装

桌面端是 Reasonix Studio；CLI、Studio 和编辑器集成都运行同一套本地 Reasonix 引擎。

### Reasonix Studio

从最新的[发布页](https://github.com/qiyuess/reasonix-studio/releases)
下载对应平台的安装包（标签为 `studio-v2.7x.*`）：

| 平台 | 安装包 | 架构 |
| --- | --- | --- |
| macOS | `.dmg` 或 `.zip` | Apple Silicon（`arm64`）/ Intel（`amd64`） |
| Windows | 安装器 `-installer.exe` 或便携 `.zip` | x64 |
| Linux | `.deb`、`.rpm` 或 `.AppImage`（只提供下载） | x64（`amd64`）/ ARM64（`arm64`，aarch64） |

同一个发布页也提供 `reasonix` CLI 归档（`darwin|linux|windows × amd64|arm64`）。

### VS Code 扩展

扩展不内置 CLI，而是启动本机的 `reasonix acp` 后端，并提供原生聊天、编辑器
上下文、工具调用审批、模型选择和工作区会话。请先安装 CLI。

- **VS Code：** [从 Visual Studio Marketplace 安装](https://marketplace.visualstudio.com/items?itemName=SivanLiu.reasonix-agent)
- **VSCodium / Eclipse Theia：** [从 Open VSX Registry 安装](https://open-vsx.org/extension/SivanLiu/reasonix-agent)
- **扩展 ID：** `SivanLiu.reasonix-agent` · [源码与使用说明](https://github.com/SivanCola/reasonix-vscode)

### 从源码构建

```sh
git clone https://github.com/qiyuess/reasonix-studio.git
cd reasonix-studio
```

#### CLI

CLI 构建需要 **Go 1.25+**。模块固定了 `toolchain`，保持 `GOTOOLCHAIN=auto`
即可让 Go 自动下载对应工具链，也可以手动安装。

```sh
make build      # -> bin/reasonix(.exe)
make cross      # -> dist/（darwin|linux|windows × amd64|arm64）
```

#### Studio

Studio 的前端还需要 **Node 24+ 与 pnpm 10**（`npm install -g pnpm@10`）。

```sh
make studio
```

各平台的 webview 依赖和 Linux 构建标签见 [Studio 构建指南](desktop/README.md#prerequisites)。

## 快速开始

### Reasonix Studio

安装并启动 Studio，然后在应用内连接 provider 和模型即可使用，无需配置 CLI。

### CLI / TUI

```sh
reasonix setup                      # 配置 provider 和模型
reasonix                            # 启动交互式会话
reasonix run "把 main.go 里的 TODO 实现掉"
```

需要项目指令时，可在交互式会话中运行 `/init`。

CLI 进阶用法和详细配置见 **[CLI 命令参考](./docs/CLI.zh-CN.md)**、
**[指南](./docs/GUIDE.zh-CN.md)** 和
**[配置路径](./docs/CONFIG_PATHS.md)**。

## 文档

- **开始使用：** [指南](./docs/GUIDE.zh-CN.md) ·
  [CLI 命令参考](./docs/CLI.zh-CN.md) · [配置路径](./docs/CONFIG_PATHS.md) ·
  [ACP 编辑器接入](./docs/ACP.md) · [在 DeepSeek Harness 中使用](./docs/DSH.md)
- **功能与排障：** [子智能体 Profile](./docs/SUBAGENT_PROFILES.md) ·
  [Context Engine v2](./docs/SESSION_MEMORY_RETRIEVAL.md) ·
  [能力诊断](./docs/CAPABILITY_DIAGNOSTICS.md) ·
  [恢复与安全模式](./docs/RECOVERY.md) ·
  [Checkpoints 与 rewind](./docs/CHECKPOINTS.md)
- **Agent 预设：** [会话级组合](./docs/AGENT_COMPOSITIONS.zh.md)
- **工程与迁移：** [规格](./docs/SPEC.md) ·
  [任务合约与暂停策略](./docs/TASK_CONTRACT.md) ·
  [工具合约](./docs/TOOL_CONTRACT.md) ·
  [从 1.x 迁移到 2.x](./docs/MIGRATING.md) ·
  [2.x 路线图](./docs/ROADMAP.md)
- **扩展开发：** [扩展概览](./docs/EXTENSIONS.md) ·
  [插件包与 Manifest v1](./docs/PLUGIN_PACKAGES.md) ·
  [Extension Protocol](./docs/EXTENSION_PROTOCOL.md) ·
  [Go SDK 与 starter](./sdk/go/README.md)

## 致谢

引擎、桌面应用和本仓库的大部分文档来自
[esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix)，采用 MIT 协议。
项目 logo 和开场视频由 [**Bernardxu123**](https://github.com/Bernardxu123) 设计。

<p align="center">
  <sub>MIT —— 见 <a href="./LICENSE">LICENSE</a></sub>
</p>
