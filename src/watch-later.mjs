import { randomInt } from "node:crypto";

export function validateCount(value) {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(count) || count <= 0) {
    throw new TypeError("count must be a positive integer");
  }

  return count;
}

export function fisherYatesSample(candidates, value, draw = randomInt) {
  const count = validateCount(value);

  if (count > candidates.length) {
    const noun = candidates.length === 1 ? "video" : "videos";
    throw new RangeError(
      `requested ${count}, but there are only ${candidates.length} eligible ${noun}`,
    );
  }

  const shuffled = candidates.slice();

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = draw(index + 1);

    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new RangeError(`random draw must be an integer from 0 to ${index}`);
    }

    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled.slice(0, count);
}

export async function moveSelectedVideos(port, selected) {
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const target = selected[index];

    try {
      if (await port.currentFirstId() === target.id) {
        results.push({ target, status: "already_first" });
        continue;
      }

      await port.submitMoveToTop(target.id);
      results.push({ target, status: "submitted" });
    } catch (error) {
      return {
        results,
        failure: {
          target,
          reason: error instanceof Error ? error.message : String(error),
        },
        untouched: selected.slice(index + 1),
      };
    }
  }

  return { results, failure: null, untouched: [] };
}
