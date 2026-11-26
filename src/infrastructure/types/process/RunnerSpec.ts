import { z } from "zod";
import { RunnerSchema } from "../../constants/process/RunnerSchema.js";

export type RunnerSpec = z.infer<typeof RunnerSchema>;
