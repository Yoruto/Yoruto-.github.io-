# 业务组系统 v0.1

> 本文档说明「业务组」（Business Group）玩法的完整机制，包括创建、团队管理、月度运营、IPO 上市与裁撤。

---

## 1. 概述

业务组是玩家在扩张期解锁后可创建的独立经营实体。玩家派遣母公司员工作为团队，注入启动资金，通过四条驱动线推动成长：**研发产品（按钮触发）**、**扩展市场（按钮触发）**、**研发专利（按钮占位）**、**人才培养（按钮占位）**，最终达到估值门槛后可申请 **IPO 上市**，生成新的可交易股票。

**核心特点**：
- 员工直接来自母公司员工池，无需独立招聘
- 团队成员上限：每个业务组**最多允许 5 人**（含负责人）
- 操作以**按钮即时触发**为主（非传统月度资金表单）。研发/拓展在点击时即时消耗或生成对应效果；专利与人才培养为占位按钮，点击当前无效果（后续实现）。
- 与主游戏共用资金体系（母公司现金 ↔ 业务组资金）
- 月度计算在主月结之前执行；同时每月对在研产品自动增加进度（详见创建与研发）

---

## 2. 创建条件与流程

### 2.1 解锁条件

- **游戏阶段**：扩张期（总资产≥1亿 或 年份≥2000且资产≥5000万 或 声望≥80）

### 2.2 创建入口

「新开业务」→「业务组」。

### 2.3 创建参数

| 参数 | 规则 | 限制 |
|------|------|------|
| 名称 | 玩家自定义 | 必填 |
| 行业 | 8 个行业下拉选择 | 与股票行业对齐 |
| 负责人 | 从母公司空闲员工中选择 | 该员工无在营业务、不在其他业务组 |
| 初始资金 | 最低 **100 万** | 从公司现金一次性扣除 |
| 月烧钱率 | 玩家设定，默认 20 万/月 | 作为基础运营成本 |

### 2.4 初始状态

创建后业务组对象的关键字段：

```javascript
{
  id: `BG-${Date.now()}`,
  name: '玩家输入',
  industry: 'tech',
  ownerPlayerId: 'PLAYER-001',
  fundingWan: 1000,           // 初始资金
  initialFundingWan: 1000,    // 记录初始注资（用于状态判定）
  stage: 'formation',
  teamIds: [leaderId],
  leaderId: leaderId,
  metrics: {
    productLevel: 0,
    productProgress: 0,
    products: [],             // 业务组持有的产品列表（在研/已研）
    marketShare: 0,
    patentCount: 0,
    patentValueWan: 0,
    monthlyRevenueWan: 0,
    ttmRevenueWan: 0,
    valuationWan: 600         // 初始估值 = fundingWan × 0.6
  },
  monthlyBurnWan: 20,
  // 注意：旧版的月度资金分配（rdWan/expandWan/patentWan）已被按钮化操作取代。
  monthlySpend: { rdWan: 0, expandWan: 0, patentWan: 0 },
  consecutiveProfitMonths: 0,
  createdAt: '1998-01'
}
```

---

## 3. 团队管理

业务组成员直接来自**母公司员工池**，通过 UI 进行调入和移除。

### 3.1 人员调配

| 操作 | 条件 | 效果 |
|------|------|------|
| **调入员工** | 该员工不在任何业务组，且无在营业务，且 `teamIds.length < 5` | 加入 `teamIds`，参与次月月度计算；超过 5 人时禁止调入 |
| **移除员工** | 在业务组详情页点击移除按钮 | 从 `teamIds` 移除；若移除负责人则清空 `leaderId` |
| **自动裁撤** | `teamIds.length === 0` | 次月 `tickMonth` 时自动裁撤，剩余资金返还母公司 |

### 3.2 能力映射

业务组使用母公司员工的三维通用能力，映射关系如下：

| 业务组计算项 | 对应员工属性 | 作用 |
|-------------|-------------|------|
| 研发总和 (`sumResearch`) | `leadership` | 驱动研发进度与产品等级提升 |
| 市场总和 (`sumMarketing`) | `innovation` | 驱动市场扩展速率 |
| 执行总和 (`sumExecution`) | `execution` | 已内嵌于收入公式中 |

> **设计说明**：当前版本采用简化映射，复用母公司员工的领导力/创新力/执行力。后续版本可能为业务组引入独立的 `research` / `marketing` / `execution` 维度。

---

## 4. 月度运营机制（按钮化操作）

每月点击「下一个月」时，`main.js` 会在主月结之前调用 `bgManager.tickMonth(state)`，对业务组执行月度结算（工资、收入计算、产品进度等）。

本版本的运作要点：
- 操作以**按钮即时触发**为主：业务组详情页提供四个操作按钮 —— **研发**、**拓展**、**专利**、**人才培养**（其中“专利”“人才培养”为占位按钮，目前点击无实际效果）。
- 创建业务组时会**自动生成一个在研的研发产品**（基于所属行业的模板），每月 `tickMonth` 自动为在研产品增加 **20% 进度**。
- 点击 **研发**：若业务组当前没有在研产品，点击将生成一个在研产品并开始进度；若已有在研产品，则按钮为禁用（不可重复点击）。
- 点击 **拓展**：即时消耗业务组资金（按钮上显示消耗金额），并根据团队能力与行业属性即时增加市场份额（市占率）。
- **专利** 与 **人才培养**：当前为占位按钮，点击暂无效果（后续实现具体加成）。
- 成本项简化：业务组的固定月支出仅包含**员工工资（月烧钱）**与由按钮触发的操作性支出（例如研发一次性成本、拓展消耗）。不再依赖事先设置的 `rdWan/expandWan/patentWan` 月度表单。

### 4.1 创建时的在研产品

创建业务组时，系统会立即为业务组生成一个基础在研产品对象并加入 `metrics.products`：

```javascript
{ id: `P-${Date.now()}`, name: '行业模板产品', industry: 'tech', progressPct: 0, level: 0 }
```

每月 `tickMonth` 自动将 `progressPct` 增加 **20%**（例如：0 → 20 → 40 → 60 → 80 → 100，达到 100% 后产品转为已研并提升 `level` 或转为 `productLevel` 规则适配）。

### 4.2 按钮行为（简述实现契约）

- 研发按钮：
  - 条件：`metrics.products` 中不存在任何 `progressPct < 100` 的在研产品。
  - 效果：生成在研产品（基于行业模板）并置 `progressPct = 0`，随后每月自动 +20%。
  - 备注：若已有在研产品，按钮禁用直到现有产品完成。

- 拓展按钮：
  - 条件：`fundingWan >= cost`（按钮会展示并扣减的默认消耗，例如 `20` 万/次，具体数值可在代码中调整）。
  - 效果：即时 `fundingWan -= cost`；根据团队能力与行业基数即时增加 `marketShare`（小幅提升，受 `sumInnovation`、行业 `baseExpand` 与专利加成影响）。

- 专利按钮、人才培养按钮：
  - 当前为占位（点击无实际效果），UI 可显示“待实现”提示。

### 4.3 月度结算（tickMonth）

- 支出计算：

```
totalOut = monthlyBurnWan + actionCostsThisMonth
fundingWan -= totalOut
```

其中 `actionCostsThisMonth` 来自本月发生的按钮操作（如拓展消耗、研发一次性消耗等）。

- 收入与估值计算维持原有逻辑：

```
productMultiplier = 1 + productLevel × 0.05 + patentValueWan / marketSizeWan
monthlyRevenueWan = marketSizeWan × marketShare × productMultiplier

ttmRevenueWan = ttmRevenueWan × 11/12 + monthlyRevenueWan / 12
valuationWan = round(revenueMultiplier × ttmRevenueWan + patentValueWan)
```

- 盈亏与连续盈利计算保持不变（`consecutiveProfitMonths` 仍作记录）。

### 4.4 说明与迁移建议

- 旧版使用的 `rdWan/expandWan/patentWan` 月度输入字段在 UI 层已被替换为按钮触发的即时操作；数据结构中仍可保留字段以兼容旧存档，但运行时优先使用按钮触发的消费与效果。
- 前端实现要点：按钮需展示消耗与当前是否可点击（如研发在研时禁用；资金不足时禁用拓展）。

---

## 5. 状态机

```
formation → incubation → growth → mature → exit(IPO) / failed
```

| 状态迁移 | 触发条件 | 备注 |
|---------|---------|------|
| `formation` → `incubation` | `initialFundingWan ≥ 1000` 且 `teamIds.length ≥ 1` | 创建时通常直接满足 |
| `incubation` → `growth` | `productLevel ≥ 2` 且 `marketShare ≥ 0.005` | 需要一定研发与市场投入 |
| `growth` → `mature` | `marketShare ≥ 0.05` 或 `valuationWan ≥ 50000` | 规模或估值达标 |
| `mature` → `exit` | 玩家**主动申请 IPO** 且 `valuationWan ≥ 200000` | 不自动触发 |
| 任意 → `failed` | `fundingWan ≤ 0` | 资金耗尽即失败 |

---

## 6. 母公司注资与裁撤

### 6.1 母公司注资

- **操作**：在业务组详情页输入金额，点击「注资」。
- **资金来源**：母公司现金。
- **限制**：受母公司当前现金约束。
- **效果**：`companyCashWan -= amount`，`fundingWan += amount`。

### 6.2 手动裁撤

- **操作**：在业务组详情页点击「裁撤业务组」，需二次确认。
- **效果**：
  - 剩余资金全部返还母公司。
  - 人员释放回母公司员工池。
  - 业务组从 `bgManager.groups` 移除。

### 6.3 自动裁撤

- **触发**：`teamIds.length === 0` 时（移除最后一名成员，或创建后未指派人员）。
- **时机**：次月 `tickMonth` 执行时检测。
- **效果**：同手动裁撤，资金返还母公司，并弹出提示。

---

## 7. IPO 机制

### 7.1 申请条件

- `valuationWan ≥ 200,000`（20 万）

> **当前简化**：不检查 `consecutiveProfitMonths`、不检查阶段是否为 `mature`、不要求高级员工作为负责人。未来可能收紧条件。

### 7.2 IPO 流程

1. 玩家在业务组详情页点击「申请 IPO」。
2. 前端调用 `bgManager.generateIPOObject(group)` 生成股票对象。
3. 股票对象直接 `push` 到内存 `config.stocks` 数组。
4. 该股票当月即可在股票业务中被选为投资标的。
5. 业务组数据与 IPO 快照保存到 localStorage。

### 7.3 生成股票结构

```json
{
  "stockId": "STKBG-BG001",
  "companyId": "BG-001",
  "name": "杭州互联网科技股份有限公司",
  "symbol": "BG001",
  "totalSharesWan": 10000,
  "freeFloatSharesWan": 5000,
  "initialPrice": 20.0,
  "listingYear": 1998,
  "industry": "tech",
  "playerHoldingsWan": { "PLAYER-001": 5000 }
}
```

| 字段 | 说明 |
|------|------|
| `totalSharesWan` | 总股本 10,000 万股 |
| `freeFloatSharesWan` | 流通股 50%（5,000 万股） |
| `initialPrice` | `valuationWan / 10000`，保留两位小数 |
| `playerHoldingsWan` | 玩家默认持有 50%（5,000 万股） |

> **持久化说明**：前端无法直接写回仓库 `stocks-futures.json`。IPO 股票当前存在于会话内存与 localStorage，跨会话持久化需手动导出 JSON 合并到 `stocks-futures.json`。

---

## 8. UI 总览

### 8.1 业务组列表页（`business-groups`）

- 顶栏导航入口：「业务组」按钮。
- 展示所有业务组卡片，每卡显示：名称、行业、估值、月营收、市占率、产品等级。
- 点击卡片进入详情页。

### 8.2 业务组详情页（`business-group-detail`）

| 面板 | 内容 |
|------|------|
| **概览** | 估值、月营收、市占率、产品等级（4 个核心 KPI） |
| **团队** | 当前成员列表（含负责人标记）、调入空闲员工下拉框 |
| **资金** | 业务组资金、月烧钱率、母公司注资输入框 |
| **操作** | 四个即时操作按钮：研发 / 拓展 / 专利（占位）/ 人才培养（占位），按钮即时触发并显示消耗与效果 |
| **操作** | 申请 IPO（估值达标时启用）、裁撤业务组 |

### 8.3 创建页（`new-business` → 业务组）

- 名称输入、行业下拉、负责人选择（仅空闲员工）、初始资金、月烧钱率。
- 若无可用的空闲员工，创建按钮置灰。

---

## 9. 与主游戏的集成

### 9.1 月度执行顺序

```
玩家点击「下一个月」
  ↓
bgManager.tickMonth(spendByGroup, state)   // 业务组月度计算
  ↓
endTurn(state, config)                     // 主月结（股票/期货/咨询/拉投资/房地产/初创）
  ↓
保存 bgManager 到 localStorage
保存 state 到 localStorage
```

### 9.2 存档机制

- **主游戏存档**：localStorage key `investment-sim:save`
- **业务组存档**：localStorage key `investment-sim:bg`
- 两者在关键操作后同步保存（创建、注资、调人、月结、IPO、裁撤等）。

### 9.3 数据文件

| 文件 | 作用 | 当前状态 |
|------|------|---------|
| `data/investment-sim/business-groups.json` | 业务组数据模板 | `groups: []`（空，运行时由 localStorage 或玩家创建填充） |
| `data/investment-sim/employees.json` | 员工池模板 | `employees: []`（空，实际使用母公司员工） |

---

## 10. 数值与常量速查

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `marketSizeWan` | 1,000,000 | 市场规模基数（万） |
| `revenueMultiplier` | 6 | TTM 收入估值倍数 |
| `levelThreshold` | 100 | 研发进度阈值（每升 1 级所需） |
| `baseExpand` | 0.001 | 基础月市场扩展率 |
| `ipoValuationThresholdWan` | 200,000 | IPO 估值门槛（万） |
| `patentBonusPerCount` | 0.03 | 每项专利市占加成 |
| `productLevelMultiplier` | 0.05 | 每级产品收入加成 |
| `patentValuePerCount` | 100 | 每 100 万专利投入 = 1 项专利 |
| `initialValuationRate` | 0.6 | 初始估值 = 注资 × 0.6 |
| `minInitialFundingWan` | 100 | 最低初始资金（万） |
| `defaultBurnWan` | 20 | 默认月烧钱率（万） |

---

## 11. 已知简化与后续规划

| 项 | 当前状态 | 规划 |
|----|---------|------|
| 专利子系统 | 简化版（投入→计数→加成） | 完整 A/B/C 方案 |
| IPO 条件 | 仅检查估值≥20万 | 增加连续盈利、阶段检查 |
| IPO 持久化 | 内存+localStorage | 后端写入或构建合并 |
| 股票市场 | 未实现独立撮合 | 业务组股票独立交易 |
| 业务组间交互 | 未实现 | 竞争/合作/并购 |
| 随机事件 | 未实现 | 小概率收入波动/研发延迟 |
| 员工独立维度 | 复用领导力/创新力/执行力 | 独立的 research/marketing/execution |

---

## 相关文件

- 核心逻辑：`investment-sim/js/core/businessGroups.js`
- UI 渲染与事件：`investment-sim/js/main.js`
- 月结集成：`investment-sim/js/core/monthEngine.js`
- 数据模板：`data/investment-sim/business-groups.json`、`data/investment-sim/employees.json`
