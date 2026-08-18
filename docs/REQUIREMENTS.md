# dsh-fleet 产品需求与后续实施说明

- **文档状态**：后续开发基线
- **更新时间**：2026-08-18
- **当前代码版本**：`779d66c`（只读更新监控；V0 acceptance coverage 基线为 `1dbba70`；最终以 `git log -1` 为准）
- **当前阶段**：V0 inventory/drift 与只读更新可用性监控均已实现并完成 M5/M3 验收；V1 Fleet Agent 尚未开始
- **目标读者**：下一开发 session、未来贡献者、DSH 上游维护者

---

## 1. 项目定义

### 1.1 一句话定位

**dsh-fleet 是 DSH 团队的声明式能力、设备和协作控制层。**

DSH 官方市场负责发现和获取插件；DSH profile 负责单机安装；dsh-fleet 负责回答：

- 哪个成员正在使用哪台设备；
- 设备应当具备哪些插件、技能、预设、工作流和配置；
- 本机实际状态是否符合团队期望；
- 如何安全地安装、验证、回滚和审计能力变更；
- 一人多设备及多人多设备如何在同一模型下协作。

### 1.2 首要真实场景

#### 场景 A：一个人、两台设备

- M5：随身控制设备，负责开发、审批、发布和审查；
- M3：长期在线执行设备，负责稳定运行、构建、测试和周期任务；
- M5 发布候选能力；
- M3 安装并验证；
- M5 离线后，M3 的已接收任务仍能继续。

#### 场景 B：Owner + 实习生

- Owner 维护团队能力和稳定版本；
- 实习生安装 DSH + dsh-fleet 后通过一次性邀请加入；
- Fleet 下发受控能力组、权限预设和低额度设备 token；
- 实习生不接触上游模型密钥，也不管理 DSH 内部配置；
- 工作成果通过 Git commit、PR、Issue、决策文档和交接报告进入团队资产；
- Owner 可以独立吊销成员或单台设备。

### 1.3 不是两套产品

个人多设备和多人团队必须共用同一数据模型。个人模式只是一个团队里暂时只有一个 human principal。

---

## 2. 顶层设计原则

### 2.1 人员身份与设备身份分离

不得用一个 `role` 字段同时表示人和设备。

- Principal：人或 agent 的身份；
- Device：设备身份；
- Device class：设备职责；
- Role：人在团队中的角色；
- Capability set：应下发的能力集合；
- Policy：权限、预算和审批边界。

### 2.2 有效权限取交集

```text
有效权限
= 人员角色上限
∩ 设备信任等级
∩ 当前项目权限
∩ DSH 会话预设
∩ 本次任务临时授权
```

Owner 有拍板权，不代表所有进程默认无限权限。

### 2.3 Git 是长期真相源

- 源码、能力清单、非敏感配置、决策和审计摘要进入私有 Git；
- 密钥、个人会话日志和个人偏好不上 Git；
- Fleet Hub 可以承担实时协调，但不能成为唯一真相源；
- 设备保留最后一次可用配置，Hub 临时离线时不应瘫痪。

### 2.4 管理版本，不同步工作目录

Fleet 只部署：

- 明确版本的市场包；
- 精确 commit SHA；
- 经过校验的 tarball；
- 明确版本的 npm 包。

Fleet 不同步：

- 未提交文件；
- `node_modules`；
- 本机缓存；
- 编辑器状态；
- 任意目录快照。

### 2.5 声明式收敛

```text
读取期望状态
→ 读取设备实际状态
→ 计算差异
→ 生成执行计划
→ 人工或策略批准
→ 应用
→ 健康检查
→ 成功确认或自动回滚
```

### 2.6 默认无远程 shell

Fleet 的远程操作必须是结构化动作，例如：

- 检查状态；
- 安装批准版本；
- 重启 DSH；
- 执行批准的测试；
- 请求审批；
- 回滚上一版本。

不得把任意 shell 作为默认团队控制接口。

---

## 3. 与 DSH 官方能力的分工

### 3.1 直接复用

- 官方插件市场：能力发现和公开分发；
- `dsh plugin --profile ... add/update/remove`：单机插件包管理；
- profile `package.json` 和 `dsh.profile.bundles`：安装期望与 bundle 层；
- Cordis Loader / plugin inventory：插件运行状态；
- skills、presets、workflows、MCP：团队能力单元；
- permission preset、sandbox、user approval：本机执行边界；
- session persistence、telemetry、export：审计材料；
- Remote/API、SDK/ACP、jobs、goals、schedule：后续远程和异步基础。

### 3.2 dsh-fleet 新增

- 团队成员与设备模型；
- 期望能力清单；
- 设备实际状态采集；
- 跨设备差异与收敛；
- 发布通道；
- 安装计划、健康检查和回滚；
- 成员加入、设备入队和吊销；
- 远程审批桥；
- 协作任务与交接状态；
- 团队层审计事件。

### 3.3 不重做

- 插件市场；
- npm/Git 托管；
- 通用密码管理器；
- 通用 MDM；
- 项目管理平台；
- 远程桌面；
- 模型网关；
- DSH 会话云盘。

---

## 4. 总体架构

```text
                  team-hub / private Git
             fleet.lock.yaml + policies + history
                            │
                ┌───────────┴───────────┐
                │                       │
          Official Market          Private Git
                │                       │
                └───────────┬───────────┘
                            │
                    optional fleet-hub
              enrollment / queue / approvals / audit
                            │
              outbound-only authenticated connection
                            │
            ┌───────────────┴────────────────┐
            │                                │
      M5 fleet-agent                   M3 fleet-agent
            │                                │
      dsh-fleet plugin                 dsh-fleet plugin
            │                                │
       DSH Web profile                  DSH Web profile
```

### 4.1 dsh-fleet DSH 插件

负责：

- GUI 状态展示；
- 本机 DSH、profile 和 Loader 状态读取；
- 差异展示；
- 未来的计划审批、回滚和协作入口；
- 与本机 Fleet Agent 通信。

### 4.2 fleet-agent 本机代理

V1 开始引入，运行在 DSH 进程之外，负责：

- 安装和更新插件；
- 保存 profile 快照；
- 停止和重启 DSH；
- 健康检查；
- 失败回滚；
- 设备密钥；
- 与 Hub 建立主动出站连接。

用户体验可以是一次安装，但实现上必须分进程，避免运行中的插件替换和重启自己。

### 4.3 fleet-hub

V3/V4 可选引入，负责：

- 成员与设备注册；
- 一次性邀请；
- 异步任务队列；
- 远程审批；
- 设备在线状态；
- 团队审计摘要。

基础插件收敛不应强制依赖 Hub。

---

## 5. 领域模型

### 5.1 Principal

```yaml
principals:
  ruby:
    type: human
    role: owner
  intern-01:
    type: human
    role: intern
  cost-auditor:
    type: agent
    role: service-agent
    owner: ruby
```

### 5.2 Device

```yaml
devices:
  ruby-m5:
    assignedTo: ruby
    class: portable-control
    channel: dev
  m3-worker:
    assignedTo: ruby
    class: always-on-worker
    channel: stable
  intern-laptop-01:
    assignedTo: intern-01
    class: member-workstation
    channel: stable
```

建议的设备类型：

- `portable-control`；
- `always-on-worker`；
- `member-workstation`；
- `service-node`。

### 5.3 Capability

长期模型需支持：

- `plugin`；
- `skill`；
- `preset`；
- `workflow`；
- `mcp`；
- `settings`；
- `permission`；
- `provider`。

V0 只实现 `plugin`。

### 5.4 Capability set

```yaml
capabilitySets:
  team-standard:
    plugins: [password-shield, quota-status]
    skills: [team-onboarding, team-task-handoff]
  team-intern:
    extends: team-standard
    presets: [team-intern]
    policies: [intern-default]
```

### 5.5 Policy

至少覆盖：

- DSH permission preset；
- Git 权限；
- 模型允许列表；
- 模型额度；
- 网关 token 档；
- 审批规则；
- 工作区访问范围；
- 设备信任等级。

---

## 6. V0 清单格式

当前实现：`schemaVersion: 1`，只支持 devices 和 plugins。

```yaml
schemaVersion: 1
team:
  id: ruby-team
  name: Ruby DSH Fleet

devices:
  ruby-m5:
    assignedTo: ruby
    class: portable-control
    channel: dev
  m3-worker:
    assignedTo: ruby
    class: always-on-worker
    channel: stable

plugins:
  - id: dsh-password-shield
    spec: github:ruby1304/dsh-password-shield
    profiles: [web]
    target:
      channels: [dev, stable]

  - id: dsh-quota-status
    spec: github:ruby1304/dsh-quota-status
    profiles: [web]
    target:
      devices: [ruby-m5]

  - id: dsh-turn-fork
    spec: ^0.1.0
    runtimeModules: [dsh-turn-fork]
```

### 6.1 V0 比较规则

- `spec` 与 profile `package.json.dependencies[id]` 做精确字符串比较；
- 不解析 semver 等价关系；
- profile dependencies 与 bundle 列表交集用于识别已安装外部 bundle；
- `runtimeModules` 用于包名与 Cordis row 名不一致的情况；
- 未声明 `runtimeModules` 时默认使用插件 id；
- 目标选择支持 device id、device class、channel 和 DSH profile。

### 6.2 V0 状态

- `aligned`；
- `missing`；
- `spec-drift`；
- `runtime-failed`；
- `runtime-inactive`；
- unmanaged bundle 单独列出。

---

## 7. 当前代码状态

### 7.1 已完成

仓库：`/Users/qudian/Local/dsh/dsh-fleet`

本地提交：

```text
779d66c feat: add read-only fleet update monitoring
1dbba70 feat: complete fleet v0 acceptance coverage
93d7db5 docs: refresh v0 handoff state
3b41bb0 fix: wait for fleet overlay slot before registration
```

主要文件：

- `src/shared.ts`：清单和状态类型；
- `src/host/core.ts`：YAML 解析、校验、设备选择和差异计算；
- `src/index.ts`：本机 profile/Loader 采集及 loopback RPC；
- `src/client/index.tsx`：Fleet 悬浮状态面板；
- `examples/fleet.lock.yaml`：M5/M3 示例清单；
- `tests/core.test.ts`：清单和收敛单测；
- `tests/host.test.ts`：profile/Loader 采集集成测试；
- `tests/client.test.tsx`：等待 `shell.overlay` 声明后再注册 UI 的生命周期测试。

已验证：

- TypeScript 类型检查通过；
- 22 个测试通过；
- Host、testing、client bundle 构建通过；
- `pnpm pack --dry-run` 通过；
- M5 实际 profile 投影成功；
- DSH `--dump-config` 正确装配 Fleet row。

### 7.2 M5 当前安装状态

已执行：

```text
dsh plugin --profile web add link:/Users/qudian/Local/dsh/dsh-fleet
```

M5 profile 已包含：

```json
"dsh-fleet": "link:/Users/qudian/Local/dsh/dsh-fleet"
```

本机覆盖配置：

```yaml
- id: fleet
  config:
    deviceId: ruby-m5
    manifestPath: /Users/qudian/Local/dsh/dsh-fleet/examples/fleet.lock.yaml
    profile: web
```

### 7.3 V0 验收状态与剩余边界

已完成：

- M5 现有 DSH Web 已重启并完成 Fleet badge、展开面板、刷新和浏览器错误可视验证；
- Fleet client 和两次正确 RPC POST 均为 HTTP 200；
- M5 为 `ruby-m5 / portable-control / dev`，5 项期望全部 aligned，0 missing、0 drifted、0 failed，4 项明确未管理；
- `source`/`revision` 已与派生的 dependency spec 分离，stable 变体强制精确 npm 版本或 40 位 commit SHA；
- `external/noExternal` 已迁移为 `deps.neverBundle/alwaysBundle`，tsdown 构建无弃用警告；
- Public 仓库 `https://github.com/ruby1304/dsh-fleet` 已创建，`main` 已首次 push；
- M3 已从远端 clone 到 `/Users/qudian/dev/dsh-fleet`，安装、check、link、profile 配置和原 Web 重启均已完成；
- M3 为 `m3-worker / always-on-worker / stable`，同一逻辑清单选出 4 项 stable 目标并准确报告 4 项 missing；
- 示例清单只用于开发验收，不是正式 team-hub 真相源。

仍不属于 V0：

- 当前 DSH Web 进程没有 `pnpm run dev:web` watcher；
- 尚无 GitHub CI；
- 不自动安装 M3 缺失能力，不执行收敛、回滚、Hub、远程 shell 或 secrets 分发；
- V1 Fleet Agent 尚未开始。

### 7.4 环境事实

- M5 DSH：`0.1.0-rc.5`；
- M3 DSH：`0.1.0-rc.5`；
- M3 DSH 二进制：`/Users/qudian/.local/bin/dsh`；
- M3 非交互 SSH PATH 不含 `~/.local/bin`，验收命令使用绝对路径；
- M3 Fleet checkout：`/Users/qudian/dev/dsh-fleet`，跟踪 `origin/main`；
- M3 现有 Web 继续使用 loopback `127.0.0.1:3211` 和 screen session `dsh-web-m3`；
- npm 全局缓存存在 root-owned 文件问题，当前项目使用 pnpm；
- 不要用 sudo 修改系统 npm 缓存作为本项目依赖。

---

## 8. V0 完成要求

### 8.1 M5 可视验证

执行前先确认当前 DSH Web 如何启动。不要启动第二个无效 Web 服务。

步骤：

1. 在用户方便时停止并重启现有 `dsh web`；
2. 刷新 `http://127.0.0.1:3080`；
3. 左下角应出现 Fleet badge；
4. 展开后应显示 `ruby-m5`、`portable-control`、`dev`；
5. 应显示期望、漂移、失败和未管理统计；
6. 刷新按钮可重新读取；
7. 浏览器控制台无 module-loader、slot 或 RPC 错误；
8. Host 日志无插件加载失败。

### 8.2 修正实际清单

- 把所有当前要纳管的 M5 插件写入清单；
- 开发中的本地 link 与稳定 spec 分开表示；
- 决定是否引入 `source` 与 `revision` 字段，而不是长期复用一个 `spec` 字符串；
- 稳定通道必须使用不可漂移版本。

### 8.3 远端仓决策

必须由 Ruby 明确批准后才能：

- 创建 GitHub 仓；
- 选择 public/private；
- 设置 remote；
- push。

建议开源代码仓，团队清单和私有能力另放私有 team-hub。

### 8.4 M3 验证

前提：代码已通过批准的 Git 远端分发。

建议路径：

```text
/Users/qudian/dev/dsh-fleet
```

步骤：

1. M3 clone；
2. `pnpm install`；
3. `pnpm run check`；
4. 使用绝对命令：`~/.local/bin/dsh plugin --profile web add link:$PWD`；
5. 配置 `deviceId: m3-worker`；
6. 清单路径使用 M3 checkout 的绝对路径或未来 team-hub 固定路径；
7. 重启 M3 现有 DSH Web；
8. 验证设备类型 `always-on-worker` 和通道 `stable`；
9. 导出 M5/M3 两份状态，确认同一清单产生不同目标集合；
10. 不使用 rsync 覆盖正式仓。

### 8.5 V0 验收标准

- 两台设备使用同一份逻辑清单；
- 两台设备身份和职责分离；
- 能准确识别缺失、spec 漂移、runtime 失败和未管理插件；
- 全过程只读；
- 无凭据或会话内容进入 Fleet 返回值；
- 测试、打包和 DSH 加载均通过；
- README 足以让第三方用户复现。

验收差异报告（2026-08-18）：

| 项目 | M5 | M3 |
| --- | --- | --- |
| 设备 | `ruby-m5` | `m3-worker` |
| 类型 / 通道 | `portable-control / dev` | `always-on-worker / stable` |
| manifest | M5 checkout 的 `examples/fleet.lock.yaml` | M3 checkout 的同一逻辑文件 |
| 目标集合 | password-shield、quota-status、turn-fork、vision-subagent、web-search-tavily | password-shield、quota-status、turn-fork、vision-subagent |
| 汇总 | desired 5、aligned 5、missing 0、drifted 0、failed 0、unmanaged 4 | desired 4、aligned 0、missing 4、drifted 0、failed 0、unmanaged 2 |
| 未管理 | `dsh-818-relay`、`dsh-bash-escalation-gate`、`dsh-cliproxyapi`、`dsh-fleet` | `dsh-aibaji-skills`、`dsh-fleet` |
| 结论 | dev 本地来源全部运行对齐 | stable 精确版本目标被正确选出；V0 只读，未自动安装，因此准确报告 missing |

两台设备的 Fleet client 均为 HTTP 200，正确 RPC POST 各重复两次均为 HTTP 200 且结果稳定。M5 可视验证无 console error、page error 或 request failure；M3 profile 通过 `--dump-config` 并由原 screen-managed Web 提供服务。

### 8.6 只读更新监控增量

2026-08-18 起，V0 增加与 inventory/drift 正交的更新可用性视图。它只回答“公开上游是否出现变化”，不执行收敛：

- `status` RPC 保持纯本地读取，30 秒状态轮询不触发网络；
- 独立 `updates` RPC 支持 `cache`、`if-stale` 和 `force` 三种模式；
- DSH core 与 npm `@deepseek-ai/dsh` 的公开 `latest` 发布比较；
- npm bundle 使用不携带认证信息的 npm 公共 registry HTTPS `latest` 端点查询公开发布版本；
- `private: true`、未声明 `publishConfig.access: public` 的 scoped 包、声明非 npmjs publish registry 的包和 npm alias 不发送到公共 registry，首版明确标记为不支持；
- GitHub bundle 只允许严格的 `github:owner/repo` 或公开 HTTPS 形式，以 `pnpm-lock.yaml` 的 resolved SHA 对比远端 HEAD；SHA 不同只称“上游有变化”，不称安全升级；
- `link:`、`file:`、`workspace:` 标记为本地源码，不访问远端；
- 普通 dependencies 不进入插件更新列表，只检查 `dsh.profile.bundles`；
- 默认进程内缓存 6 小时，强制刷新 60 秒防抖，同一时刻的请求合并；
- profile、lock 或 manifest 变化会使缓存立即 stale；
- 公共 GitHub 查询使用显式省略 credentials 的 Node HTTPS，不启动 Git，因此不读取 Git 配置、AskPass 或 `.netrc`；RPC 不返回 token、认证 URL、原始上游响应或本地 link 绝对路径；
- 任一来源失败必须显示为检查失败，不能误判“已是最新”。

实现禁止经过 `dsh plugin ... outdated`：DSH CLI 的 plugin wrapper 会在成功的 pnpm 命令之后 reconciliation profile bundles，必要时重写 profile，因此不属于严格只读边界。

本增量仍不属于 V1 收敛。版本兼容、release channel、批准、快照、安装、健康检查、重启与回滚全部留在 V1 Fleet Agent。

---

## 9. V1：本机受控收敛

### 9.1 目标

在单台设备上，把差异从“只读报告”升级为“人工批准的安装计划”，仍不引入中央 Hub。

### 9.2 必须新增 fleet-agent

建议进程结构：

```text
DSH Fleet UI
→ loopback authenticated IPC
→ fleet-agent
→ dsh plugin / profile snapshot / restart / health / rollback
```

### 9.3 执行计划

每次修改必须先生成不可变计划：

- plan id；
- device id；
- manifest revision；
- 当前 profile hash；
- 将安装、更新、删除的能力；
- 下载来源和完整版本；
- 是否需要重启；
- 风险提示；
- 过期时间。

计划内容发生变化后，旧批准自动失效。

### 9.4 Profile 快照

应用前至少保存：

- `package.json`；
- `pnpm-lock.yaml`；
- `pnpm-workspace.yaml`；
- bundle 列表；
- 用户 `cordis.patch.yml`；
- 当前 Fleet 清单 revision。

### 9.5 安装来源

V1 支持：

- 官方市场/npm 精确版本；
- Git 精确 commit；
- 本地开发 link，仅限 dev 通道。

不支持从 manifest 传入任意安装 shell。

### 9.6 健康检查

应用后检查：

- DSH 能启动；
- 指定 Web URL 可访问；
- 目标插件为 active；
- 没有新增 failed 条目；
- Fleet RPC 可返回；
- 可选插件冒烟测试通过。

失败自动恢复 profile 快照并重新启动。

### 9.7 V1 验收

- M5 可以人工安装一个批准版本；
- M3 可以执行同一流程；
- 模拟坏插件后能自动回滚；
- DSH Fleet 自身升级失败不破坏旧版更新代理；
- 无任意远程 shell。

---

## 10. V2：发布通道和多来源

### 10.1 通道

- `dev`：开发设备，可本地 link；
- `candidate`：跨设备验证；
- `stable`：成员默认通道。

### 10.2 晋升流程

```text
市场或私有仓发现版本
→ M5 dev 验证
→ 写入 candidate PR
→ M3 安装并验证
→ Owner 合并/晋升 stable
→ 其他设备收到更新
```

### 10.3 来源适配器

- DSH 官方市场；
- npm；
- 私有 Git；
- monorepo + packagePath；
- 本地开发 checkout。

Fleet 不自己托管插件包。

### 10.4 版本安全

stable 禁止：

- `main`；
- 浮动分支；
- 未固定 Git 引用；
- 未确认来源的 tarball。

后续可加入 SHA-256、Sigstore/cosign；TUF 级供应链元数据等生态成熟后再引入。

---

## 11. V3：团队成员与设备入队

### 11.1 入队流程

1. 成员安装 DSH + Fleet；
2. 本机生成设备密钥；
3. 输入一次性邀请码；
4. Fleet Hub 收到加入请求；
5. Owner 批准 principal、role、device class 和 capability set；
6. Hub 发放设备证书或可吊销 token；
7. 设备主动出站连接；
8. 下发 stable 能力清单；
9. 本机应用前仍遵守审批策略。

### 11.2 实习生默认边界

- 只访问指定团队仓；
- Git pull + PR，不直接管理稳定分支；
- 仅使用 team-intern preset；
- workspace-write 或更窄策略；
- 一台设备一个网关 token；
- token 低额度、可吊销；
- 不接触上游 provider key；
- 不自动上传个人会话；
- 越权请求必须显式发起。

### 11.3 吊销

设备吊销与成员移除必须独立。

设备丢失：

- 吊销设备证书；
- 吊销设备 token；
- 保留成员身份和历史。

成员退出：

- 禁用 principal；
- 吊销其所有设备；
- 撤销 Git 权限；
- 吊销 token；
- 保留审计记录和提交归属。

---

## 12. V4：协作、任务和远程审批

### 12.1 任务系统边界

GitHub Issues/PR 仍是任务和代码真相源。Fleet 负责连接：

```text
任务分配
→ 正确设备和工作区
→ 正确 DSH preset/权限
→ 执行状态
→ commit/PR/报告
→ Owner 审查
```

### 12.2 长久在线 worker

- M5 下发结构化任务；
- M3 接收后在本机队列持久化；
- M5 离线不影响执行；
- 结果回传引用 Git artifact 和证据；
- 不依赖长期 SSH 会话。

### 12.3 远程审批

审批必须：

- 由工作设备主动请求；
- 绑定 principal、device、session、tool 和参数摘要；
- 有过期时间；
- 一次性使用；
- Owner 明确批准或拒绝；
- 全程审计；
- 不能变成 Owner 静默遥控成员电脑的入口。

### 12.4 Agent 成员

Agent 是 principal 的一种：

- 必须有 human owner；
- 有独立能力组、预算和 kill switch；
- 没有拍板权；
- 输出必须落团队可见的证据和交接物。

---

## 13. 安全要求

### 13.1 供应链

- stable 使用不可变版本；
- Manifest 变更走 PR/审批；
- 清单不能携带任意命令；
- 下载与安装分阶段；
- 安装前验证来源和完整性；
- Fleet 自身使用独立升级通道和回滚。

### 13.2 网络

- 设备主动出站连接；
- 不要求实习生电脑开放入站端口；
- Hub 和设备双向认证；
- 命令有 nonce、过期时间和幂等 id；
- 重放请求必须拒绝。

### 13.3 凭据

- 上游 provider key 不下发；
- 设备只获得低价值网关 token；
- Secret 只存 Bitwarden、本机安全存储或未来 secret broker；
- Fleet manifest 只引用 secret 名称；
- 错误、日志、RPC 和 UI 不返回 secret 值。

### 13.4 隐私

默认不收集：

- 个人会话正文；
- 私人目录；
- 浏览器历史；
- 与团队无关的 Git 仓；
- 任意屏幕内容。

上传审计应限于团队作用域和明确结构化事件。

---

## 14. 审计事件要求

建议统一事件信封：

```json
{
  "eventId": "...",
  "type": "capability/apply",
  "at": "2026-08-17T00:00:00Z",
  "principalId": "ruby",
  "deviceId": "ruby-m5",
  "workspaceId": "optional",
  "manifestRevision": "...",
  "planId": "...",
  "result": "success"
}
```

至少记录：

- device/enrolled、revoked；
- member/role-changed；
- manifest/observed；
- plan/created、approved、expired；
- capability/downloaded、applied、failed、rolled-back；
- dsh/restarted、health-failed；
- approval/requested、decided；
- task/assigned、started、handed-off、reviewed；
- token/issued、revoked。

---

## 15. 非功能要求

### 15.1 可恢复

- 所有修改动作可重试；
- 应用动作幂等；
- 状态机持久化；
- 中途断电后能判断处于 staged、applying、verifying 或 rollback；
- 不得留下无法解释的半安装状态。

### 15.2 离线容忍

- 设备保留 last-known-good；
- Hub 或 Git 暂时不可用时，已安装 DSH 继续工作；
- 更新和任务等待，不重复执行；
- 恢复连接后增量同步。

### 15.3 跨平台

目标顺序：

1. macOS arm64（M5/M3）；
2. Windows；
3. Linux。

平台差异集中在进程管理和本机凭据，不进入清单核心。

### 15.4 可观测

- UI 显示期望/实际/最后检查时间；
- Agent 有结构化日志；
- 健康失败有固定错误码；
- 默认不包含 secret 和会话正文；
- 可选 OpenTelemetry。

### 15.5 兼容性

- 清单有 schemaVersion；
- Fleet 记录 DSH 版本；
- 能力可声明兼容的 DSH 范围；
- 不兼容时拒绝应用，不试错安装；
- 同一 release line 的 DSH 包依赖保持一致。

---

## 16. 测试策略

### 16.1 单元测试

- 清单解析；
- 重复 id；
- target 选择；
- 权限交集；
- 差异状态；
- 计划 hash；
- 状态机；
- 回滚决策；
- 审计脱敏。

### 16.2 集成测试

- 临时 DSH profile；
- 本地 link/npm/Git 安装；
- Loader active/failed；
- profile snapshot/restore；
- DSH 重启；
- Hub 断线重连；
- 重复命令幂等；
- token 吊销。

### 16.3 真实设备验收

- M5/M3 同一清单；
- 不同 device class 选择不同能力；
- M5 发布 candidate；
- M3 验证；
- 坏版本回滚；
- M5 离线时 M3 继续已领取任务；
- 实习生设备入队和吊销演练。

---

## 17. 开源与上游策略

### 17.1 dsh-fleet 独立维护

适合保留：

- 团队和设备模型；
- 清单规范；
- Fleet Agent；
- 发布通道；
- Hub；
- 团队协作和远程审批。

### 17.2 向 DSH 上游贡献

优先考虑独立、小而通用的改进：

- plugin inventory 增加包版本和来源；
- 稳定的 profile 插件操作 API；
- restart-required 状态；
- 插件生命周期事件；
- 健康检查接口；
- 外部审批桥扩展点。

不得通过 fork DSH 来完成 Fleet。

### 17.3 仓库建议

- dsh-fleet 代码：开源；
- team-hub 清单、成员、设备和私有能力：私有；
- 通用能力通过官方市场发布；
- 业务专用插件通过私有 Git 分发。

---

## 18. V0 验收记录与后续顺序

以下 V0 顺序已于 2026-08-18 完成：

1. 阅读需求、Git 状态与最近提交；
2. 完整 check 和 pack dry-run；
3. 在不启动替代服务器的前提下验证 M5 现有 Web；
4. 补充客户端 UI/RPC 与 Host loopback RPC 冒烟测试；
5. 修复 tsdown 弃用配置；
6. 完善真实 M5 开发清单和 M3 stable 变体；
7. 经 Ruby 明确批准后创建 Public GitHub 仓、添加 remote 并首次 push；
8. M3 从远端 clone、安装、check、link、配置并重启原 Web；
9. 导出 M5/M3 状态并确认同一清单产生不同目标集合；
10. 完成 README、需求文档和最终 check/pack。

后续若开始 V1，必须先单独设计 Fleet Agent 的计划、审批、快照、健康检查与回滚协议；不得把 V0 Host 插件扩成自更新或任意远程 shell。

### 18.1 禁止事项

- 不擅自 push GitHub；
- 不擅自停止当前用户会话；
- 不启动另一个不能更新现有 GUI 的替代服务器；
- 不用 rsync 覆盖 M3 正式仓；
- 不开始团队 Hub 或远程 shell；
- 不把示例清单当作正式 team-hub；
- 不在 V0 引入 secrets 分发。

---

## 19. 新 session 启动指令

将下面内容作为新 session 的首条请求即可：

> 继续实现 `/Users/qudian/Local/dsh/dsh-fleet`。先完整阅读 `docs/REQUIREMENTS.md`、`git status` 和最近提交。V0 已完成 M5/M3 双设备验收：Public 仓库为 `ruby1304/dsh-fleet`，M3 checkout 为 `/Users/qudian/dev/dsh-fleet`，M5 dev 目标 5 项全部 aligned，M3 stable 目标 4 项准确报告 missing。开始新工作前先运行完整 check/pack，并保持 V0 只读边界；Fleet Agent、team-hub、自动安装、远程 shell 和 secrets 分发均属于尚未批准的后续阶段。

---

## 20. 当前阶段完成定义

当前阶段的交付是“Fleet V0 验收完成”，不是整个 Fleet 产品完成：

- V0 本地只读 inventory、drift、UI/RPC 和更新可用性监控已落地；
- M5 与 M3 使用同一逻辑清单并按设备职责选出不同目标集合；
- M5、M3 profile 与现有 Web 已装配并通过真实 RPC 验证；
- 代码已通过批准的 Public GitHub 远端分发；
- 示例清单、来源边界、稳定版本规则和双设备差异已固化；
- V1 Fleet Agent、自动收敛、回滚、Hub、成员系统和远程审批尚未开始。
