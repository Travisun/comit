// 被测模块：src/core/http-client.ts —— ssrfGuard「解析 → 校验 → IP pin 直连」管线。
// 手法：mock @/core/ssrf 的两个窄接口（lookupAddresses 可控解析结果模拟 DNS
// rebinding 两跳返回不同 IP；isBlockedAddress 仅对本机测试服务器放行 127.0.0.1，
// 其余仍走真实网段规则），配合真实本地 http server 验证 socket 实际连接行为。
// 网段判定纯函数本身的覆盖在 http-client.test.ts（经 re-export）。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { httpRequest } from "@/core/http-client";

const seam = vi.hoisted(() => ({
  lookupAddresses: vi.fn<(host: string) => Promise<{ address: string }[]>>(),
  allowLoopback: false,
}));

vi.mock("@/core/ssrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/ssrf")>();
  return {
    ...actual,
    lookupAddresses: seam.lookupAddresses,
    // 测试环境受控放行：仅 127.0.0.1（本地回环服务器）视为合法目标，
    // 用于把「解析两次会得到不同 IP」的 rebinding 场景接到同一台本地服务器上观察
    isBlockedAddress: (ip: string) =>
      seam.allowLoopback && ip === "127.0.0.1" ? false : actual.isBlockedAddress(ip),
  };
});

type Recorded = { url: string; host: string | null; method: string | null; body: string };

let server: http.Server;
let port = 0;
let flakyHits = 0;
const requests: Recorded[] = [];

function record(req: http.IncomingMessage, body: string) {
  requests.push({ url: req.url ?? "", host: req.headers.host ?? null, method: req.method ?? null, body });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      record(req, body);
      const url = req.url ?? "";
      if (url === "/redirect302") {
        res.writeHead(302, { location: `http://hop2.test:${port}/final` });
        res.end("moved");
      } else if (url === "/redirect301") {
        res.writeHead(301, { location: `http://hop2.test:${port}/final` });
        res.end("moved");
      } else if (url === "/redirect307") {
        res.writeHead(307, { location: `http://hop2.test:${port}/final` });
        res.end("moved");
      } else if (url === "/redirect-to-private") {
        res.writeHead(302, { location: `http://private-hop2.test:${port}/final` });
        res.end("moved");
      } else if (url === "/flaky") {
        const first = flakyHits++ === 0;
        res.writeHead(first ? 500 : 200);
        res.end(first ? "500" : "flaky-ok");
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(`ok:${url}`);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => {
  seam.lookupAddresses.mockReset();
  seam.allowLoopback = false;
  requests.length = 0;
  flakyHits = 0;
});

describe("ssrfGuard · IP pinning（rebinding 闭环）", () => {
  it("校验通过后直连已校验 IP：连接阶段零二次解析，TTL 到期返回的新 IP 不被使用", async () => {
    seam.allowLoopback = true;
    let lookups = 0;
    seam.lookupAddresses.mockImplementation(async () => {
      lookups += 1;
      // 第一跳校验通过（指向本地服务器）；攻击者若能在第二次解析时 rebinding
      // 到 link-local（真实 isBlockedAddress 会拦截），旧 fetch 实现会中招 ——
      // pinning 下第二次解析根本不会发生。
      return lookups === 1 ? [{ address: "127.0.0.1" }] : [{ address: "169.254.169.254" }];
    });
    const res = await httpRequest(`http://victim.test:${port}/final`, { ssrfGuard: true, method: "GET" });
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe("ok:/final");
    expect(seam.lookupAddresses).toHaveBeenCalledTimes(1); // 本跳恰好一次解析
    expect(requests).toHaveLength(1);
    expect(requests[0].host).toBe(`victim.test:${port}`); // Host header 保持原域名（vhost 语义）
  });

  it("解析出的任一地址命中私网/保留段 → 拒绝且不发起连接", async () => {
    seam.allowLoopback = true;
    seam.lookupAddresses.mockResolvedValue([{ address: "169.254.169.254" }]);
    await expect(httpRequest(`http://meta.test:${port}/final`, { ssrfGuard: true })).rejects.toThrow(
      /forbidden address/,
    );
    expect(requests).toHaveLength(0);
  });

  it("混合解析（一公网一私网）fail closed", async () => {
    seam.allowLoopback = true;
    seam.lookupAddresses.mockResolvedValue([{ address: "127.0.0.1" }, { address: "10.1.2.3" }]);
    await expect(httpRequest(`http://mixed.test:${port}/final`, { ssrfGuard: true })).rejects.toThrow(
      /forbidden address/,
    );
    expect(requests).toHaveLength(0);
  });

  it("IP 字面量 URL：不做 DNS 解析，校验后直连", async () => {
    seam.allowLoopback = true;
    const res = await httpRequest(`http://127.0.0.1:${port}/final`, { ssrfGuard: true, method: "GET" });
    expect(res.status).toBe(200);
    expect(seam.lookupAddresses).not.toHaveBeenCalled();
  });

  it("仅允许 http(s) 协议", async () => {
    await expect(httpRequest("ftp://example.com/x", { ssrfGuard: true })).rejects.toThrow(/only http\(s\)/);
    await expect(httpRequest("不是 url", { ssrfGuard: true })).rejects.toThrow(/invalid URL/);
  });
});

describe("ssrfGuard · 重定向每跳重新解析 + 重新 pin", () => {
  it("302 跳转：每一跳独立做一次新的 DNS 解析并按各自已校验 IP 连接", async () => {
    seam.allowLoopback = true;
    const hosts: string[] = [];
    seam.lookupAddresses.mockImplementation(async (host) => {
      hosts.push(host);
      return [{ address: "127.0.0.1" }];
    });
    const res = await httpRequest(`http://hop1.test:${port}/redirect302`, { ssrfGuard: true, method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok:/final");
    expect(hosts).toEqual(["hop1.test", "hop2.test"]); // 每跳恰好解析一次（不重复也不遗漏）
    expect(requests.map((r) => r.host)).toEqual([`hop1.test:${port}`, `hop2.test:${port}`]);
    expect(requests.map((r) => r.url)).toEqual(["/redirect302", "/final"]);
  });

  it("第一跳合法但跳转目标解析到私网 → 第二跳被拦（每跳独立校验）", async () => {
    seam.allowLoopback = true;
    seam.lookupAddresses.mockImplementation(async (host) =>
      host === "hop1.test" ? [{ address: "127.0.0.1" }] : [{ address: "10.0.0.8" }],
    );
    await expect(
      httpRequest(`http://hop1.test:${port}/redirect-to-private`, { ssrfGuard: true, method: "GET", retries: 0 }),
    ).rejects.toThrow(/forbidden address/);
    expect(requests.map((r) => r.url)).toEqual(["/redirect-to-private"]); // 第二跳未建连
  });

  it("301/302 → 降级 GET 并丢弃 body；307 → 保留 method+body（均重新 pin）", async () => {
    seam.allowLoopback = true;
    seam.lookupAddresses.mockResolvedValue([{ address: "127.0.0.1" }]);
    const via301 = await httpRequest(`http://hop1.test:${port}/redirect301`, {
      ssrfGuard: true,
      method: "POST",
      body: "secret-payload",
    });
    expect(via301.status).toBe(200);
    expect(requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ["POST", "/redirect301", "secret-payload"],
      ["GET", "/final", ""],
    ]);

    requests.length = 0;
    const via307 = await httpRequest(`http://hop1.test:${port}/redirect307`, {
      ssrfGuard: true,
      method: "POST",
      body: "kept",
    });
    expect(via307.status).toBe(200);
    expect(requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ["POST", "/redirect307", "kept"],
      ["POST", "/final", "kept"],
    ]);
    expect(seam.lookupAddresses).toHaveBeenCalledTimes(4); // 两组各两跳，每跳一次解析
  });
});

describe("ssrfGuard · webhook 投递形态与重试", () => {
  it("POST + JSON 自定义 header（webhook 签名头形态）完整送达", async () => {
    seam.allowLoopback = true;
    seam.lookupAddresses.mockResolvedValue([{ address: "127.0.0.1" }]);
    const res = await httpRequest(`http://hook.test:${port}/final`, {
      ssrfGuard: true,
      method: "POST",
      json: { hello: "world" },
      headers: { "X-Comit-Signature": "v1=deadbeef" },
      retries: 0,
    });
    expect(res.ok).toBe(true);
    expect(requests[0].body).toBe('{"hello":"world"}');
    expect(requests[0].method).toBe("POST");
  });

  it("GET 5xx 重试：每次尝试重新走完整「解析+校验+pin」", async () => {
    seam.allowLoopback = true;
    seam.lookupAddresses.mockResolvedValue([{ address: "127.0.0.1" }]);
    const res = await httpRequest(`http://hook.test:${port}/flaky`, {
      ssrfGuard: true,
      method: "GET",
      retries: 1,
      retryDelayMs: 1,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("flaky-ok");
    expect(seam.lookupAddresses).toHaveBeenCalledTimes(2); // 重试不沿用旧校验结果
  });

  it("非幂等 POST 不因 5xx 重试（webhook 重试由队列层负责）", async () => {
    seam.allowLoopback = true;
    seam.lookupAddresses.mockResolvedValue([{ address: "127.0.0.1" }]);
    const res = await httpRequest(`http://hook.test:${port}/final`, {
      ssrfGuard: true,
      method: "POST",
      body: "x",
      retries: 3,
    });
    expect(res.status).toBe(200);
    expect(requests).toHaveLength(1);
  });
});

describe("非 guarded 路径行为保持", () => {
  it("ssrfGuard 关闭：走原 fetch 路径，不触碰 DNS seam、不做网段校验", async () => {
    seam.lookupAddresses.mockRejectedValue(new Error("guarded seam must not be used"));
    const res = await httpRequest(`http://127.0.0.1:${port}/final`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok:/final");
    expect(seam.lookupAddresses).not.toHaveBeenCalled();
  });
});
