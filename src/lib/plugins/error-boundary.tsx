"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/client/error-report";

/**
 * 插件/扩展错误边界 — 扩展组件（槽位渲染器、右栏 widget、打断渲染器、
 * 扩展独立页）的统一隔离壳：
 *  - 单个扩展组件抛错只降级自身 fallback,绝不击穿宿主布局/页面;
 *  - componentDidCatch 上报 /api/client-errors（服务端日志可见）。
 * 错误边界必须是 class 组件（React 限制）,渲染逻辑零依赖、可嵌套。
 */

interface Props {
  /** 报告与日志中的定位标识,如 "slot:post:actions"、"rail:signature"、"page:signature" */
  scope: string;
  /** 降级 UI（默认渲染 null —— 扩展缺位不影响宿主） */
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(`plugin:${this.props.scope}`, error, {
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}
