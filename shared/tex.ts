const TEXT_COMMANDS: Record<string, true> = {
  text: true,
  textrm: true,
  textsf: true,
  texttt: true,
  textnormal: true,
  textbf: true,
  textmd: true,
  textit: true,
  textsl: true,
  textup: true,
  textsc: true,
  mbox: true,
  hbox: true,
};

function commandEnd(source: string, start: number): number {
  let end = start + 1;
  while (end < source.length && /[A-Za-z]/.test(source[end])) end++;
  return end;
}

function verbEnd(source: string, end: number): number {
  if (source[end] === "*") end++;
  const delimiter = source[end];
  if (!delimiter || /\s/.test(delimiter)) return end;
  const close = source.indexOf(delimiter, end + 1);
  const newline = source.indexOf("\n", end + 1);
  return close < 0 || (newline >= 0 && newline < close)
    ? newline < 0
      ? source.length
      : newline
    : close + 1;
}

function balancedEnd(source: string, start: number): number {
  let depth = 1;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      const end = commandEnd(source, i);
      if (source.slice(i + 1, end) === "verb") i = verbEnd(source, end) - 1;
      else i = Math.max(i + 1, end - 1);
    } else if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

function repairText(source: string): string {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\") {
      const end = commandEnd(source, i);
      const next =
        source.slice(i + 1, end) === "verb"
          ? verbEnd(source, end)
          : Math.min(source.length, Math.max(i + 2, end));
      result += source.slice(i, next);
      i = next - 1;
    } else result += source[i] === "%" ? "\\%" : source[i];
  }
  return result;
}

/**
 * Render explicit equation tags inline with their display instead of asking
 * MathJax for a page-width labeled equation. MathJax emits those labels as
 * nested, CSS-sized SVGs, which cannot be safely rasterized as standalone
 * geometry. Keep the tag's TeX payload and AMS parenthesis semantics.
 */
export function compactEquationTags(expression: string): string {
  let result = "";
  let copied = 0;
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === "%") {
      const newline = expression.indexOf("\n", i + 1);
      i = newline < 0 ? expression.length : newline;
      continue;
    }
    if (expression[i] !== "\\") continue;
    const end = commandEnd(expression, i);
    const command = expression.slice(i + 1, end);
    if (command === "verb") {
      i = verbEnd(expression, end) - 1;
      continue;
    }
    if (command !== "tag") {
      i = Math.max(i + 1, end - 1);
      continue;
    }
    let start = end;
    while (/\s/.test(expression[start] ?? "") && start < expression.length)
      start++;
    const starred = expression[start] === "*";
    if (starred) {
      start++;
      while (/\s/.test(expression[start] ?? "") && start < expression.length)
        start++;
    }
    if (expression[start] !== "{") {
      i = end - 1;
      continue;
    }
    const close = balancedEnd(expression, start);
    if (close < 0) break;
    const tag = expression.slice(start + 1, close - 1);
    result +=
      expression.slice(copied, i) +
      (starred
        ? `\\qquad{${tag}}`
        : `\\qquad{\\text{(}${tag}\\text{)}}`);
    copied = close;
    i = close - 1;
  }
  return copied === 0 ? expression : result + expression.slice(copied);
}

/** Repair human text percentages without changing TeX comments or verbatim. */
export function normalizeTex(expression: string): string {
  let result = "";
  let copied = 0;
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === "%") {
      const newline = expression.indexOf("\n", i + 1);
      i = newline < 0 ? expression.length : newline;
      continue;
    }
    if (expression[i] !== "\\") continue;
    const end = commandEnd(expression, i);
    const command = expression.slice(i + 1, end);
    if (command === "verb") {
      i = verbEnd(expression, end) - 1;
      continue;
    }
    if (!Object.hasOwn(TEXT_COMMANDS, command)) {
      i = Math.max(i + 1, end - 1);
      continue;
    }
    let start = end;
    while (/\s/.test(expression[start] ?? "") && start < expression.length)
      start++;
    if (expression[start] !== "{") {
      i = end - 1;
      continue;
    }
    const close = balancedEnd(expression, start);
    if (close < 0) break; // Incomplete streaming text is never speculatively changed.
    result +=
      expression.slice(copied, start) +
      repairText(expression.slice(start, close));
    copied = close;
    i = close - 1;
  }
  return copied === 0 ? expression : result + expression.slice(copied);
}
