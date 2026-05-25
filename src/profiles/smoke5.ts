import type { ResearchProfile } from "../types.js";

export const smoke5: ResearchProfile = {
  name: "smoke5",
  targetUniqueSources: 5,
  initialSubquestions: 1,
  maxDepth: 1,
  maxKeyword: 1,
  limit: 5,
  maxConcurrentSearches: 1,
  model: "mimo-v2.5-pro",
  language: "en"
};
