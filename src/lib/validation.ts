import { useState } from "react";
import type { z } from "zod";

/**
 * 标准化表单验证器 — zod schema 驱动的轻量表单状态（扩展页面/设置表单通用）。
 *
 * ```tsx
 * const form = useZodForm(z.object({ content: z.string().max(200) }), { content: "" });
 * <Input value={form.values.content} onChange={(e) => form.setField("content", e.target.value)} />
 * {form.errors.content && <p>{form.errors.content}</p>}
 * <Button onClick={() => form.submit(async (data) => save(data))}>保存</Button>
 * ```
 *
 * 服务端仍以同一 zod schema（或 manifest 收敛）为准 — 一份契约两端执行。
 */

export interface ZodForm<S extends z.ZodObject> {
  values: z.output<S>;
  errors: Partial<Record<keyof z.output<S> & string, string>>;
  setField: <K extends keyof z.output<S> & string>(key: K, value: z.output<S>[K]) => void;
  /** 校验并提交：失败返回 false（errors 已置位），成功把 data 交给回调 */
  submit: (onValid: (data: z.output<S>) => Promise<void> | void) => Promise<boolean>;
  reset: (values?: z.output<S>) => void;
}

export function useZodForm<S extends z.ZodObject>(
  schema: S,
  initialValues: z.input<S>,
): ZodForm<S> {
  type Values = z.output<S>;
  const [values, setValues] = useState<Values>(() => schema.parse(initialValues));
  const [errors, setErrors] = useState<Partial<Record<keyof Values & string, string>>>({});

  function setField<K extends keyof Values & string>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function submit(onValid: (data: Values) => Promise<void> | void): Promise<boolean> {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof Values & string, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "") as keyof Values & string;
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    await onValid(parsed.data as Values);
    return true;
  }

  function reset(next?: Values) {
    setValues(next ?? (schema.parse(initialValues) as Values));
    setErrors({});
  }

  return { values, errors, setField, submit, reset };
}
