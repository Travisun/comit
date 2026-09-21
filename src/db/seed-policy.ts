import { randomBytes } from "crypto";

/**
 * db:seed 口令策略（纯函数，无 DB/env 副作用，便于单测）：
 *
 *  - 生产环境（NODE_ENV=production）硬性拒绝执行 —— 种子数据只属于开发/演示；
 *  - 管理员口令只认 ADMIN_PASSWORD / SEED_ADMIN_PASSWORD 环境变量；
 *  - 非交互环境（CI/无 TTY，如管道执行）未提供环境变量 ⇒ 拒绝执行并提示，
 *    绝不落一个可预测的弱口令 admin；
 *  - 交互式开发环境未提供 ⇒ 随机生成一次性强口令，由调用方打印到 stdout
 *    （不落盘、不进任何文件），跑完即用即弃；
 *  - 演示用户（alice/bob，带帖子/关注等社交数据）仅在显式 `--demo` 时创建，
 *    且复用同一个已解析口令（不再有硬编码弱密码）。
 */

export interface SeedPolicyInput {
  env: Record<string, string | undefined>;
  argv: string[];
  /** process.stdout.isTTY —— 交互式判定 */
  isTTY: boolean;
}

export type SeedPolicyResult =
  | {
      action: "proceed";
      adminPassword: string;
      /** true ⇒ 口令为本次随机生成，调用方必须打印一次供登录使用 */
      generated: boolean;
      demoUsers: boolean;
    }
  | { action: "refuse"; reason: string };

/** 与 src/lib/auth/password.ts 的 isValidPassword 同规（此处不 import：seed 侧保持零依赖） */
function isStrongEnough(pw: string): boolean {
  return pw.length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
}

/** 随机一次性口令：20 位混合大小写字母+数字（去易混淆字符），保证含数字过策略。 */
export function generateSeedPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去易混淆字符
  const bytes = randomBytes(22);
  const chars: string[] = [];
  for (let i = 0; i < 20; i++) chars.push(alphabet[bytes[i] % alphabet.length]);
  // 随机位置植入一个数字：长度/字母/数字三条件必满足
  chars[bytes[20] % 20] = "0123456789"[bytes[21] % 10];
  return chars.join("");
}

export function resolveSeedPolicy(input: SeedPolicyInput): SeedPolicyResult {
  const { env, argv, isTTY } = input;

  if (env.NODE_ENV === "production") {
    return {
      action: "refuse",
      reason:
        "[seed] 拒绝执行：NODE_ENV=production。种子数据只用于开发/演示环境，生产库请勿运行 db:seed。",
    };
  }

  const demoUsers = argv.includes("--demo");
  const provided = (env.ADMIN_PASSWORD?.trim() || env.SEED_ADMIN_PASSWORD?.trim() || "");

  if (!provided) {
    if (!isTTY) {
      return {
        action: "refuse",
        reason:
          "[seed] 拒绝执行：非交互环境未提供管理员口令。请设置 ADMIN_PASSWORD（或 SEED_ADMIN_PASSWORD）环境变量后重试；" +
          "本地开发可在交互式终端运行 pnpm db:seed 自动生成一次性口令。",
      };
    }
    return { action: "proceed", adminPassword: generateSeedPassword(), generated: true, demoUsers };
  }

  if (!isStrongEnough(provided)) {
    return {
      action: "refuse",
      reason:
        "[seed] 拒绝执行：ADMIN_PASSWORD/SEED_ADMIN_PASSWORD 强度不足（至少 8 位，须含字母与数字）。",
    };
  }

  return { action: "proceed", adminPassword: provided, generated: false, demoUsers };
}
