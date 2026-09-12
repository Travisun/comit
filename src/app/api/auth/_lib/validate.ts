import { z } from "zod";
import { AppError } from "@/core/errors";
import { jsonBody } from "@/lib/http";

/**
 * Parse + validate a JSON request body with zod, converting validation
 * failures into a 400 AppError (zod errors would otherwise map to 500).
 */
export async function parseJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
  const raw = await jsonBody<unknown>(req);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new AppError(
      issue ? `参数错误 / Invalid input — ${path}${issue.message}` : "参数错误 / Invalid input",
      400,
      "validation",
    );
  }
  return result.data;
}
