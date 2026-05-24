import type { ResearchProfile } from "../types.js";

export const normal100: ResearchProfile = {
  name: "normal100",
  targetUniqueSources: 100,
  initialSubquestions: 8,
  maxDepth: 2,
  maxKeyword: 3,
  limit: 5,
  maxConcurrentSearches: 3,
  model: "mimo-v2.5-pro",
  language: "en"
};
