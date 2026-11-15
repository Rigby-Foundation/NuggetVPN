import { expect, test } from "bun:test";
import { parseAnsi, stripAnsi } from "../src/lib/ansi";

test("renders ANSI colors as text segments and respects style resets", () => {
  const line = "\x1b[1;31mError\x1b[0m \x1b[38;5;33mxterm\x1b[39m \x1b[38:2::0:255:0mRGB\x1b[0m plain";
  const [error, gap, xterm, nextGap, rgb, plain] = parseAnsi(line);
  expect(stripAnsi(line)).toBe("Error xterm RGB plain");
  expect(error).toMatchObject({ text: "Error", bold: true });
  expect(error.color).toBeTruthy();
  expect(xterm.color).toBeTruthy();
  expect(rgb.color).toBe("hsl(120 70% var(--log-l))");
  for (const segment of [gap, nextGap, plain]) {
    expect(segment.color).toBeUndefined();
    expect(segment.bold).toBeUndefined();
  }
});
