import { createInterface } from "node:readline/promises";

export async function confirm(
  question,
  { input = process.stdin, output = process.stderr } = {},
) {
  const rl = createInterface({ input, output });
  const controller = new AbortController();

  // Without these, Ctrl+C or Ctrl+D leaves the question pending forever.
  rl.on("SIGINT", () => controller.abort());
  rl.on("close", () => controller.abort());

  try {
    const answer = await rl.question(question, { signal: controller.signal });
    return /^y(es)?$/i.test(answer.trim());
  } catch (error) {
    if (error.name !== "AbortError") {
      throw error;
    }

    return false;
  } finally {
    rl.close();
  }
}
