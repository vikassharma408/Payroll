// A small, safe (no eval/Function) arithmetic expression parser/evaluator
// used to drive salary-structure formulas, e.g. "40% of CTC", "0.5 * BASIC",
// "CTC - BASIC - HRA - EMPLOYER_PF - EMPLOYER_NPS".
//
// Supported syntax: identifiers (component codes / CTC), numbers, a trailing
// `%` on a number (40% == 0.4), the `of` keyword as a synonym for `*`,
// + - * / and parentheses, unary minus.

type TokenType = "num" | "ident" | "op" | "lparen" | "rparen" | "eof";
interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const normalized = input.replace(/,/g, "").replace(/\bof\b/gi, "*");
  const tokens: Token[] = [];
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < normalized.length && /[0-9.]/.test(normalized[j])) j++;
      let value = normalized.slice(i, j);
      if (normalized[j] === "%") {
        value = String(parseFloat(value) / 100);
        j++;
      }
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < normalized.length && /[A-Za-z0-9_]/.test(normalized[j])) j++;
      tokens.push({ type: "ident", value: normalized.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    if ("+-*/".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' in formula: ${input}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}
  private peek() {
    return this.tokens[this.pos];
  }
  private next() {
    return this.tokens[this.pos++];
  }

  parseExpression(context: Record<string, number>): number {
    const value = this.parseAddSub(context);
    if (this.peek().type !== "eof") {
      throw new Error(`Unexpected token '${this.peek().value}'`);
    }
    return value;
  }

  private parseAddSub(context: Record<string, number>): number {
    let left = this.parseMulDiv(context);
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const right = this.parseMulDiv(context);
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseMulDiv(context: Record<string, number>): number {
    let left = this.parseUnary(context);
    while (this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next().value;
      const right = this.parseUnary(context);
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  private parseUnary(context: Record<string, number>): number {
    if (this.peek().type === "op" && this.peek().value === "-") {
      this.next();
      return -this.parseUnary(context);
    }
    return this.parsePrimary(context);
  }

  private parsePrimary(context: Record<string, number>): number {
    const tok = this.peek();
    if (tok.type === "num") {
      this.next();
      return parseFloat(tok.value);
    }
    if (tok.type === "ident") {
      this.next();
      if (!(tok.value in context)) {
        throw new Error(`Unknown identifier '${tok.value}' in formula`);
      }
      return context[tok.value];
    }
    if (tok.type === "lparen") {
      this.next();
      const value = this.parseAddSub(context);
      if (this.peek().type !== "rparen") throw new Error("Expected ')'");
      this.next();
      return value;
    }
    throw new Error(`Unexpected token '${tok.value}'`);
  }
}

export function evaluateExpression(formula: string, context: Record<string, number>): number {
  const tokens = tokenize(formula);
  return new Parser(tokens).parseExpression(context);
}

/** Identifiers referenced by a formula (uppercased), used for dependency ordering. */
export function extractIdentifiers(formula: string): string[] {
  const tokens = tokenize(formula);
  return tokens.filter((t) => t.type === "ident").map((t) => t.value);
}
