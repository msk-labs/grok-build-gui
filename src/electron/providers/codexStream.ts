import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";

type StreamEvent = Record<string, unknown> & {
  type?: unknown;
  item?: unknown;
  response?: unknown;
};

function enrichFrame(frame: string, completedItems: unknown[]): string {
  const lines = frame.split(/\r?\n/);
  const dataIndexes = lines
    .map((line, index) => (line.startsWith("data:") ? index : -1))
    .filter((index) => index >= 0);
  if (dataIndexes.length === 0) return frame;

  const data = dataIndexes
    .map((index) => lines[index].slice(5).trimStart())
    .join("\n");
  let event: StreamEvent;
  try {
    event = JSON.parse(data) as StreamEvent;
  } catch {
    return frame;
  }

  if (event.type === "response.output_item.done" && event.item) {
    completedItems.push(event.item);
  }

  if (
    event.type === "response.completed" &&
    event.response &&
    typeof event.response === "object"
  ) {
    const response = event.response as Record<string, unknown>;
    if (
      (!Array.isArray(response.output) || response.output.length === 0) &&
      completedItems.length > 0
    ) {
      event = {
        ...event,
        response: { ...response, output: [...completedItems] },
      };
      lines[dataIndexes[0]] = `data: ${JSON.stringify(event)}`;
      for (const index of dataIndexes.slice(1).reverse()) lines.splice(index, 1);
    }
  }

  return lines.join("\n");
}

/**
 * ChatGPT's Codex endpoint streams completed output items separately, then
 * returns an empty `response.output` array in the final event. Grok's generic
 * Responses client validates visible content from that final array and retries
 * otherwise, so retain the streamed items and attach them to the completion.
 */
export function createCodexStreamAdapter(): Transform {
  const decoder = new StringDecoder("utf8");
  const completedItems: unknown[] = [];
  let buffered = "";

  function drain(stream: Transform, flush: boolean): void {
    while (true) {
      const match = /\r?\n\r?\n/.exec(buffered);
      if (!match || match.index === undefined) break;
      const frame = buffered.slice(0, match.index);
      buffered = buffered.slice(match.index + match[0].length);
      stream.push(`${enrichFrame(frame, completedItems)}${match[0]}`);
    }
    if (flush && buffered) {
      stream.push(enrichFrame(buffered, completedItems));
      buffered = "";
    }
  }

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      buffered += decoder.write(chunk);
      drain(this, false);
      callback();
    },
    flush(callback: TransformCallback) {
      buffered += decoder.end();
      drain(this, true);
      callback();
    },
  });
}
