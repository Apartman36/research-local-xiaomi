export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Model returned empty content.");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Could not extract a JSON object from model content.");
  }
}

export function getAssistantContent(response: { choices?: Array<{ message?: { content?: string } }> }): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Model response is missing assistant content.");
  }
  return content;
}
