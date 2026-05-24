import type { ResearchProfile } from "../types.js";

export const deep500: ResearchProfile = {
  name: "deep500",
  targetUniqueSources: 500,
  initialSubquestions: 25,
  maxDepth: 3,
  maxKeyword: 4,
  limit: 5,
  maxConcurrentSearches: 3,
  model: "mimo-v2.5-pro",
  language: "en"
};
