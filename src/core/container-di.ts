import { logger } from "@/core/logger";

/**
 * DI 容器（B2，Laravel Container 对应物）— 接口 → 实现 的绑定/解析。
 *
 *  - `container.singleton(token, factory)`：首次 resolve 时创建并缓存；
 *  - `container.bind(token, factory)`：每次 resolve 新建；
 *  - `container.instance(token, value)`：登记现成实例；
 *  - factory 的第一参数是容器自身，可在工厂内递归 resolve 依赖。
 *
 * 核心服务已随 app 门面常驻；本容器主要供扩展注册可被其他扩展消费的
 * 服务（扩展间通信），token 约定 `ext.<id>.<service>`。
 */

export type Token = string;

interface Registration {
  factory: (c: Container) => unknown;
  singleton: boolean;
}

const log = logger.child({ module: "container" });

export class Container {
  private registrations = new Map<Token, Registration>();
  private instances = new Map<Token, unknown>();

  bind(token: Token, factory: (c: Container) => unknown): void {
    this.registrations.set(token, { factory, singleton: false });
  }

  singleton(token: Token, factory: (c: Container) => unknown): void {
    this.registrations.set(token, { factory, singleton: true });
  }

  instance<T>(token: Token, value: T): void {
    this.instances.set(token, value);
    this.registrations.set(token, { factory: () => value, singleton: true });
  }

  has(token: Token): boolean {
    return this.instances.has(token) || this.registrations.has(token);
  }

  resolve<T>(token: Token): T {
    const existing = this.instances.get(token);
    if (existing !== undefined) return existing as T;
    const reg = this.registrations.get(token);
    if (!reg) throw new Error(`容器未注册的服务 / Unbound service: ${token}`);
    const value = reg.factory(this);
    if (reg.singleton) this.instances.set(token, value);
    return value as T;
  }

  /** 尝试解析，未注册返回 null（扩展间可选依赖）。 */
  tryResolve<T>(token: Token): T | null {
    return this.has(token) ? this.resolve<T>(token) : null;
  }
}

const g = globalThis as unknown as { __mbContainer?: Container };
export const container: Container = (g.__mbContainer ??= new Container());
void log;
