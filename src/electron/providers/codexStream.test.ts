import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createCodexStreamAdapter } from "./codexStream";

async function adapt(chunks: string[]): Promise<string> {
  const output: Buffer[] = [];
  for await (const chunk of Readable.from(chunks).pipe(createCodexStreamAdapter())) {
    output.push(Buffer.from(chunk));
  }
  return Buffer.concat(output).toString("utf8");
}

describe("createCodexStreamAdapter", () => {
  it("adds streamed completed items to the final response output", async () => {
    const item = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "OK" }],
    };
    const input = [
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", item })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", output: [] } })}\n\n`,
    ].join("");

    const output = await adapt([input.slice(0, 37), input.slice(37)]);
    const completed = output
      .split("\n\n")
      .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
      .filter(Boolean)
      .map((line) => JSON.parse(line!.slice(6)) as Record<string, unknown>)
      .find((event) => event.type === "response.completed") as {
      response: { output: unknown[] };
    };

    expect(completed.response.output).toEqual([item]);
  });

  it("passes unrelated and malformed events through", async () => {
    const input = "event: ping\ndata: not-json\n\n: keepalive\n\n";
    expect(await adapt([input])).toBe(input);
  });
});
