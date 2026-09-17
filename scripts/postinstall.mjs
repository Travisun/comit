import { runInstanceGuard } from "./lib/instance-guard.mjs";

/**
 * pnpm postinstall — 依赖安装后校验 next 实例连续性。
 * 实现与策略见 scripts/lib/instance-guard.mjs（守卫唯一出处）；
 * next.config.ts 在每次启动时二次调用，覆盖「dev server 运行期间安装」窗口。
 */
runInstanceGuard({ log: (msg) => console.log(msg) });
