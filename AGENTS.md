# TransitReach 开发指南

本文件适用于整个仓库。后续修改应以现有代码、测试和项目文档为准；若本文件与更具体目录中的 `AGENTS.md` 冲突，以更具体的文件为准。

## 工作原则

- 先阅读相关实现、测试和 README，再做最小且聚焦的修改；不要顺手重构无关代码。
- 修改前运行 `git status --short`，保留用户已有改动，不覆盖、不回滚、不批量格式化无关文件。
- 沿用当前架构、命名和依赖选择。前端使用 npm 与 `package-lock.json`；没有明确必要时不要新增生产依赖。
- 注释重点解释产品约束、数据来源、验收标准和不直观的实现原因，不要复述代码表面行为。
- 不制造成功状态或数据回退来掩盖失败。数据库、路由引擎、预测或外部数据不可用时，应返回明确、可诊断的状态。

## 仓库结构

- `src/app/`：应用壳层、导航和跨页面状态。
- `src/pages/`：页面级编排，不承载可复用的复杂业务逻辑。
- `src/features/<feature>/`：按功能组织组件、Hook、类型和 service/计算模块。
- `src/shared/`：跨功能复用的 UI、Hook、地图组件、服务客户端、数据适配器、纯函数和类型。
- `backend/app/`：FastAPI 运行时服务；`api/` 放薄路由，`schemas/` 放 Pydantic 契约，`services/` 放业务、缓存和模型调用。
- `backend/data_pipeline/`、`backend/features/`、`backend/models/`：数据清洗、特征工程、训练和模型注册。
- `routing/`：OpenTripPlanner 配置和部署资料，不参与前端构建。
- `scripts/`：数据生成、GTFS 处理及独立的 Node 回归检查。
- `supabase/`：PostgreSQL/Supabase schema。

## 前端架构与 TypeScript 风格

- 技术栈为 React 18、TypeScript、Vite 和 Tailwind CSS。保持严格类型，不使用 `any` 绕过设计问题。
- 当前页面切换由 `src/app/App.tsx` 的 `PageId` 状态驱动；`src/app/router.tsx` 只是未来迁移预留。除非任务明确要求，不要引入 React Router 或并行的路由状态。
- 页面间共享的 origin、time budget、departure、outing 等行程状态继续集中在应用层，避免每个页面各自维护同一概念而产生漂移。
- 页面负责组合，Hook 负责生命周期和异步状态，service/lib 负责请求、转换和纯计算。不要把网络请求或复杂计算直接堆进 JSX。
- 跨 feature/shared 的导入优先用 `@/`；同一功能内部使用相对路径。通过 `index.ts` 暴露模块的公共 API，避免跨层引用内部实现。
- 沿用 2 空格缩进、单引号、分号、函数组件和命名导出；类型导入使用 `import type`。默认导出只在现有模式确有需要时使用。
- 组件文件与组件用 `PascalCase`；Hook 以 `use` 开头；普通模块、service 和工具文件用 `camelCase`；常量用 `UPPER_SNAKE_CASE`。
- Props 和领域对象使用明确的 `interface`/`type`。异步流程优先用判别联合表达 `idle`、`loading/computing`、`ready`、`failed` 等互斥状态。
- 异步 Hook 必须处理卸载、取消和过期响应。沿用 `AbortController`、请求序号或等价机制，禁止旧请求覆盖新状态；参考 `src/features/reachability/hooks/useReachability.ts`。
- 对输入和外部响应在边界处做校验；领域计算尽量写成小而纯的函数，便于独立测试。
- 项目没有 Prettier 配置。遵循周围文件的排版，不要引入格式化工具或进行全仓格式化。

## UI 与样式

- 局部布局、间距、响应式和排版优先使用 Tailwind；重复视觉模式或复杂地图/天气效果复用或扩展 `src/index.css` 中的语义类。
- 保持当前深色城市地图与玻璃拟态视觉。优先复用颜色变量及 `glass`、`glass-strong`、`glass-input`、`btn-primary`、`btn-secondary`、`btn-icon`、`chip-*` 等现有样式。
- 标题沿用 Plus Jakarta Sans，正文沿用 Manrope，图标沿用 `lucide-react`。不要为同类控件另建一套设计语言。
- 新建通用组件前先检查 `src/shared/ui/`。注意 `src/shared/ui/Button.tsx` 当前仅为占位文件，并不是可用的通用 Button。
- 修改地图、面板或浮层前检查 `src/pages/MapPage.tsx`、`src/shared/map/` 和 `src/index.css` 中已有的定位、z-index、断点及 Leaflet/MapLibre 覆盖规则。
- 使用原生语义元素。状态选择提供合适的 `aria-pressed`、`aria-checked` 或 `aria-expanded`；异步与错误信息使用 `role="status"`/`role="alert"`；装饰元素使用 `aria-hidden`。
- 保持键盘焦点可见，不只依赖颜色表达状态。动画必须兼容 `prefers-reduced-motion`，复用 `usePrefersReducedMotion` 或 CSS 覆盖。
- UI 修改至少验证受影响的桌面界面；涉及导航、抽屉或窄屏规则时同时检查响应式行为。

## 后端与 Python 风格

- `backend/app/main.py` 负责装配、中间件、生命周期与全局异常；API 路由只做参数和响应编排，数据库、缓存、推理和业务规则放进 service。
- API 契约使用完整类型标注和 Pydantic `response_model`。证据不足或功能不支持时返回稳定、明确的 reason，绝不伪造预测。
- 应用代码使用 `backend...` 绝对导入；数据管线包内部沿用现有相对导入。需要前向注解的模块使用 `from __future__ import annotations`。
- 沿用 4 空格缩进、类型注解、`pathlib.Path`、小而纯的函数和显式异常。不可变领域配置优先使用 `@dataclass(frozen=True)`。
- CLI 脚本沿用 `argparse`、`main()` 和 `if __name__ == "__main__":` 结构。
- 数据库访问复用 `backend/app/database.py` 的有界连接池与 `connection()`；SQL 必须使用参数绑定，不拼接用户输入。
- 缓存只用于适合缓存的公开参考数据或推理结果，保持短 TTL 和有界容量；失败结果通常不进入缓存。
- 仓库当前没有 Ruff、Black、mypy 或 `pyproject.toml` 配置。不要擅自引入或对现有 Python 文件做大范围重排。
- 测试沿用标准库 `unittest`；API 使用 FastAPI `TestClient`，外部服务和数据库边界使用 `unittest.mock`，临时文件使用 `TemporaryDirectory`。

## 数据、路由与 ML 约束

- PostgreSQL/Supabase 是运行时唯一事实来源，schema 位于 `supabase/transit-data.sql`。浏览器公共数据由 `/api/data/bootstrap` 提供。
- 仓库内 JSON、CSV、Parquet 是构建、迁移或离线分析输入。不要新增浏览器或 FastAPI 运行时 JSON 回退，也不要手改生成数据。
- `src/shared/data/**/*.json` 的变更应通过对应的 `scripts/build-*.mjs` 生成，并与生成脚本、来源和元数据保持一致。
- 原始 GTFS、大型中间数据、OTP 图和模型训练产物按 `.gitignore` 管理，不要提交它们，也不要把全量事实数据载入浏览器包。
- 大数据处理优先使用 DuckDB 投影/过滤/窗口计算和 PyArrow 分批扫描，按路线与日期分块；不要为了方便把全量事实表读入内存。
- OpenTripPlanner 固定使用 2.5.0，因为后续版本移除了项目依赖的 isochrone 接口。修改 OTP、GTFS 或路径逻辑前完整阅读 `routing/README.md`，不要擅自升级。
- GTFS Static 是计划时刻，不是真实运营标签。只允许符合项目质量门槛且包含真实 `delay_seconds` 的到站事件进入训练。
- 不得生成、补造或猜测观测标签；离线时只能使用已有且非空的真实数据。人工验证样本遵循 `backend/data_pipeline/VALIDATION_PROTOCOL.md`，不能由代码自动填写。
- ML 评估必须按时间顺序拆分，并保留基线、MAE/RMSE、数据来源、训练时段和模型版本。任何 fallback 都必须在 API 和 UI 中明确披露。

## 安全与隐私

- 不提交 `.env`、连接串、token、证书或私钥。可提交的变量说明只放在 `.env.example`，真实值放 `.env.local` 或进程环境。
- `DATABASE_URL` 和服务端密钥绝不能使用 `VITE_*` 前缀；所有 `VITE_*` 值都会发送到浏览器。Supabase 前端只允许 anon/publishable key。
- 日志不得记录查询串、精确坐标、token、密码或数据库连接信息。
- 数据库迁移、真实数据采集、模型训练和外部部署都会写入持久状态；只有任务明确要求时才执行。

## 常用命令

前端安装与运行：

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run build
```

前端没有统一的 `npm test`。按改动范围运行独立回归：

```bash
node scripts/test-ui-state.mjs
node scripts/test-map-ui.mjs
node scripts/test-epic7.mjs
node scripts/test-performance.mjs
```

后端安装、运行与测试：

```bash
python -m pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.app.main:app --reload --port 8000
python -m unittest backend.tests.test_reliability_api -v
python -m unittest discover -s backend/tests -v
```

只运行与改动直接相关的窄测试，再扩大到完整检查。通常的提交前检查为：

```bash
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s backend/tests -v
git diff --check
```

- 纯文档修改只需检查内容和 `git diff --check`。
- 只改前端时无需强制跑依赖数据库的后端集成测试；只改 Python 数据管线时无需运行所有 UI 脚本。
- 跨前后端契约、共享数据或部署配置的改动，应同时验证两侧。
- 需要真实数据库的测试必须显式配置 `DATABASE_URL`；不要把网络、Supabase 或训练任务当作普通本地验证自动执行。
- UI 人工验收说明见 `tests/ui/README.md` 和 `tests/ui/DESKTOP_UI_ACCEPTANCE.md`。

## 完成标准

- 修改符合相邻代码的结构与命名，没有引入重复状态、隐藏回退或新的数据来源歧义。
- 新行为有与风险相称的测试；修复缺陷时优先加入可复现该缺陷的回归覆盖。
- 相关 typecheck、lint、build 和测试通过；若某项因环境或外部依赖无法运行，在交付说明中明确写出。
- 最终说明应简洁列出实际修改、设计原因、运行过的验证和仍存在的限制。
