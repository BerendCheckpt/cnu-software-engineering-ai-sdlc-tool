import { z } from "zod";
import { ENV_VAR_NAME } from "./ENV_VAR_NAME.js";
import { RUNNER_NAME } from "./RUNNER_NAME.js";

/** One runner in `config/runners.yaml`: the image it runs in, its cache volumes and its environment. */
export const RunnerSchema = z.object({
  image: z.string().regex(/^[a-z0-9][a-z0-9./:@_-]*$/),
  caches: z.record(z.string().regex(RUNNER_NAME), z.string().startsWith("/")).default({}),
  environment: z.record(z.string().regex(ENV_VAR_NAME), z.string()).default({}),
});
