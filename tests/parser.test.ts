import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import { hasMath, markdownMath } from "../shared/markdown-math.js";
import { compactEquationTags, normalizeTex } from "../shared/tex.js";

function parse(source: string): Token[] {
  const tokens: Token[] = [];
  const visit = (token: Token): void => {
    tokens.push(token);
    token.children?.forEach(visit);
  };
  new MarkdownIt().use(markdownMath).parse(source, {}).forEach(visit);
  return tokens;
}
function formulas(source: string): Token[] {
  return parse(source).filter(
    (token) => token.type === "math_inline" || token.type === "math_block",
  );
}
function expressions(source: string): string[] {
  return formulas(source).map((token) => token.content);
}
function text(source: string): string {
  return parse(source)
    .filter((token) => token.type === "text")
    .map((token) => token.content)
    .join("");
}

describe("raw-source math within Markdown", () => {
  it("realigns currency without losing later formulas or prose formatting", () => {
    const source =
      "Fees $.65, $-9 or $+13; $8+$12; $240 (tax included). **Use** $u$ and $v$.";
    expect(expressions(source)).toEqual(["u", "v"]);
    expect(text(source)).toContain(
      "Fees $.65, $-9 or $+13; $8+$12; $240 (tax included).",
    );
    expect(
      parse(source).filter((token) => token.type === "strong_open"),
    ).toHaveLength(1);
  });

  it("accepts genuinely numeric TeX instead of an operator allowlist", () => {
    expect(
      expressions(
        String.raw`$31^\circ$, $7!$, $3, 5, 7$, $5:8$, $6ab + 2$, $-2$.`,
      ),
    ).toEqual([String.raw`31^\circ`, "7!", "3, 5, 7", "5:8", "6ab + 2", "-2"]);
  });

  it("protects all code forms and links using Markdown's boundaries", () => {
    const source = [
      "`$a$ \\(b\\)` and $u `code` v$ and $u [reference](https://example.org/$x$) v$",
      "",
      "    $indented$",
      "",
      "~~~text",
      "$tilde$",
      "~~~",
      "",
      "```text",
      "$fenced$",
      "``` not-a-close",
      "$stillCode$",
      "```",
      "",
      "$visible$",
    ].join("\n");
    expect(expressions(source)).toEqual(["visible"]);
    expect(
      parse(source).filter((token) => token.type === "link_open"),
    ).toHaveLength(1);
    expect(
      parse(source)
        .filter((token) => token.type === "code_inline")
        .map((token) => token.content),
    ).toEqual(["$a$ \\(b\\)", "code"]);
    expect(
      parse(source)
        .filter((token) => token.type === "fence")
        .map((token) => token.content),
    ).toEqual(["$tilde$\n", "$fenced$\n``` not-a-close\n$stillCode$\n"]);
  });

  it("keeps raw delimiter intent separate from decoded TeX entities", () => {
    const source = String.raw`\$fake$ &#36;fake$ &dollar;fake$ $a*&lt;*b$ $c*&#x3c;*d$ $e*&dollar;8*f$ $g*\&lt;h*i$ $T=\$37$`;
    expect(expressions(source)).toEqual([
      "a*<*b",
      "c*<*d",
      String.raw`e*\$8*f`,
      String.raw`g*\&lt;h*i`,
      String.raw`T=\$37`,
    ]);
  });

  it("consumes TeX markers before Markdown but retains prose wrappers", () => {
    const source = String.raw`**Choose $r_*$, then $Q^{r_*}$ and $e_{r_*}$ with *gentle* prose.**`;
    expect(expressions(source)).toEqual(["r_*", "Q^{r_*}", "e_{r_*}"]);
    expect(
      parse(source).filter((token) => token.type === "strong_open"),
    ).toHaveLength(1);
    expect(
      parse(source).filter((token) => token.type === "em_open"),
    ).toHaveLength(1);
    expect(
      expressions(
        String.raw`$a*b\{c\}d*e$ and $p_{*q_{**r**}*}$ then $a~~b~~c$`,
      ),
    ).toEqual([String.raw`a*b\{c\}d*e`, "p_{*q_{**r**}*}", "a~~b~~c"]);
  });

  it("declines partial overlap instead of stealing intentional formatting", () => {
    for (const source of [
      "**strong $u**v$",
      "$u**v$ strong**",
      "*soft $u*v$",
      "~~gone $u~~v$",
    ]) {
      expect(expressions(source)).toEqual([]);
      const baseline = new MarkdownIt().parse(source, {});
      const baselineChildren = baseline
        .flatMap((token) => token.children ?? [])
        .map((token) => [token.type, token.content]);
      const actualChildren = parse(source)
        .filter(
          (token) =>
            !["paragraph_open", "paragraph_close", "inline"].includes(
              token.type,
            ),
        )
        .map((token) => [token.type, token.content]);
      expect(actualChildren).toEqual(baselineChildren);
    }
  });

  it("preserves source while streaming and promotes only complete delimiters", () => {
    for (const source of [
      "$u",
      "$u+",
      String.raw`\(u+`,
      String.raw`\[u+`,
      "$$\nu+",
      "```math\nu+",
      "```math\nu+\n``` not-closed",
    ]) {
      expect(hasMath(source)).toBe(false);
      expect(expressions(source)).toEqual([]);
    }
    const source = String.raw`Result $u+v$; \(w+z\); inline \[a+b\] ends.`;
    expect(formulas(source).map((token) => [token.type, token.meta])).toEqual([
      ["math_inline", { source: "$u+v$", display: false }],
      ["math_inline", { source: String.raw`\(w+z\)`, display: false }],
      ["math_inline", { source: String.raw`\[a+b\]`, display: true }],
    ]);
    expect(hasMath(source)).toBe(true);
  });

  it("retains blank lines, nested containers, and closing-line prose", () => {
    const source = [
      "> - $$",
      ">   a+b",
      ">",
      ">   c+d",
      ">   $$ After **math**.",
      ">",
      ">   - \\[e+f\\] tail",
    ].join("\n");
    expect(expressions(source).map((value) => value.trim())).toEqual([
      "a+b\n\nc+d",
      "e+f",
    ]);
    expect(text(source)).toContain("After math.");
    expect(text(source)).toContain("tail");
    expect(
      parse(source).filter((token) => token.type === "blockquote_open"),
    ).toHaveLength(1);
    expect(
      parse(source).filter((token) => token.type === "bullet_list_open"),
    ).toHaveLength(2);
    expect(formulas(source).every((token) => token.block)).toBe(true);
  });

  it("does not pair displays across a container boundary", () => {
    expect(expressions("- $$\n  unfinished\n\noutside\n$$")).toEqual([]);
    expect(expressions("> $$\n> unfinished\n\noutside\n$$")).toEqual([]);
  });

  it("promotes closed math fences in containers, never lookalike code", () => {
    const source = [
      "> ~~~math",
      "> a+b",
      "> ~~~",
      "",
      "- ```math",
      "  c+d",
      "  ```",
      "",
      "```mathematica",
      "$notMath$",
      "```",
    ].join("\n");
    expect(expressions(source)).toEqual(["a+b\n", "c+d\n"]);
    expect(
      parse(source)
        .filter((token) => token.type === "fence")
        .map((token) => token.info),
    ).toEqual(["mathematica"]);
  });

  it("hasMath confirms tokens rather than dollar-shaped strings", () => {
    for (const source of [
      "$-7 and $.25",
      "`$hidden$`",
      "[label](https://example.org/$hidden$)",
      "&#36;hidden$",
      String.raw`\$hidden$`,
      "mathematics",
    ])
      expect(hasMath(source)).toBe(false);
    expect(hasMath("~~~math\nx+y\n~~~")).toBe(true);
    expect(hasMath("$" + "x".repeat(4097) + "$")).toBe(false);
    expect(hasMath("x".repeat(65_536) + " $u$")).toBe(false);
  });
});

describe("standalone equation tags", () => {
  it("places leading, middle, and grouped tags after the display", () => {
    for (const tex of [String.raw`\tag{1}x=y`, String.raw`x\tag{1}=y`]) {
      expect(compactEquationTags(tex)).toBe(String.raw`x=y\qquad{\text{(}1\text{)}}`);
    }
    expect(compactEquationTags(String.raw`{x\tag*{A}}=y`)).toBe(
      String.raw`{x}=y\qquad{A}`,
    );
    expect(compactEquationTags("\\tag{1}x=y % comment")).toBe(
      "x=y % comment\n\\qquad{\\text{(}1\\text{)}}",
    );
  });

  it("places labels at their AMS row ends without splitting nested matrices", () => {
    expect(compactEquationTags(
      String.raw`\begin{align}\tag{1}x&=\begin{matrix}a\\b\end{matrix}\\[2pt]u\tag*{B}&=v\end{align}`,
    )).toBe(
      String.raw`\begin{align}x&=\begin{matrix}a\\b\end{matrix}\qquad{\text{(}1\text{)}}\\[2pt]u&=v\qquad{B}\end{align}`,
    );
    expect(compactEquationTags(
      String.raw`\begin{equation}\tag{2}\begin{split}x&=y\\&=z\end{split}\end{equation}`,
    )).toBe(
      String.raw`\begin{equation}\begin{split}x&=y\\&=z\end{split}\qquad{\text{(}2\text{)}}\end{equation}`,
    );
  });

  it("compacts numbered and custom display tags without touching literal TeX", () => {
    expect(
      compactEquationTags(
        String.raw`x=y\tag{7} + z\tag*{\dagger} + \verb|\tag{hidden}|`,
      ),
    ).toBe(
      String.raw`x=y + z + \verb|\tag{hidden}|\qquad{\text{(}7\text{)}}\qquad{\dagger}`,
    );
    expect(compactEquationTags("x % \\tag{hidden}\n+y")).toBe(
      "x % \\tag{hidden}\n+y",
    );
    expect(compactEquationTags(String.raw`x\tag{unfinished`)).toBe(
      String.raw`x\tag{unfinished`,
    );
  });
});

describe("context-limited text percent repair", () => {
  it("repairs balanced text families, nested and escaped braces, just once", () => {
    const source = String.raw`\text{18% {net} \{gain\} and 2\%} + \textbf{7%}`;
    const expected = String.raw`\text{18\% {net} \{gain\} and 2\%} + \textbf{7\%}`;
    expect(normalizeTex(source)).toBe(expected);
    expect(normalizeTex(expected)).toBe(expected);
  });

  it("does not interpret commands inside comments or verbatim", () => {
    const source =
      "a=b % \\text{not 8%}\n" +
      String.raw`\verb|\text{9%}| + \text{\verb|5%| and 6%}`;
    expect(normalizeTex(source)).toBe(
      "a=b % \\text{not 8%}\n" +
        String.raw`\verb|\text{9%}| + \text{\verb|5%| and 6\%}`,
    );
    expect(normalizeTex(String.raw`\text{unfinished 8%`)).toBe(
      String.raw`\text{unfinished 8%`,
    );
    expect(normalizeTex(String.raw`a\% + \verb*+6%+`)).toBe(
      String.raw`a\% + \verb*+6%+`,
    );
  });
});
