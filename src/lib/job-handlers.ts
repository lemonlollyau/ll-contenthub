import "server-only";
import { analyseStep } from "./assets/analyse-job";
import { indexStep } from "./assets/index-job";
import type { StepHandler } from "./jobs";
import { matchStep } from "./matching/match-job";
import { pushStep } from "./push/push-job";
import { renderStep } from "./render-job";

// Registry of batch job kinds. Add new kinds here.
export const JOB_HANDLERS: Record<string, StepHandler> = {
  drive_index: indexStep as StepHandler,
  ai_analyse: analyseStep as StepHandler,
  match: matchStep as StepHandler,
  render: renderStep as StepHandler,
  buffer_push: pushStep as StepHandler,
};
