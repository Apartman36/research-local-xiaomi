import { appendFile } from "node:fs/promises";

export class EventLogger {
  constructor(private readonly filePath: string, private readonly verbose = false) {}

  async log(type: string, metadata: Record<string, unknown> = {}): Promise<void> {
    const event = {
      timestamp: new Date().toISOString(),
      type,
      ...metadata
    };
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    if (this.verbose) {
      console.error(`[${type}] ${JSON.stringify(metadata)}`);
    }
  }
}
