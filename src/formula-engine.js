// Formula engine - ported verbatim (logic-for-logic) from lib/formula-engine/*.ts
// Safe (no eval/Function) arithmetic expression parser/evaluator used to
// drive salary-structure formulas, e.g. "40% of CTC", "0.5 * BASIC",
// "CTC - BASIC - HRA - EMPLOYER_PF - EMPLOYER_NPS".

function feTokenize(input) {
  const normalized = input.replace(/,/g, "").replace(/\bof\b/gi, "*");
  const tokens = [];
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

class FeParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek() {
    return this.tokens[this.pos];
  }
  next() {
    return this.tokens[this.pos++];
  }
  parseExpression(context) {
    const value = this.parseAddSub(context);
    if (this.peek().type !== "eof") {
      throw new Error(`Unexpected token '${this.peek().value}'`);
    }
    return value;
  }
  parseAddSub(context) {
    let left = this.parseMulDiv(context);
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const right = this.parseMulDiv(context);
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  parseMulDiv(context) {
    let left = this.parseUnary(context);
    while (this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next().value;
      const right = this.parseUnary(context);
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  parseUnary(context) {
    if (this.peek().type === "op" && this.peek().value === "-") {
      this.next();
      return -this.parseUnary(context);
    }
    return this.parsePrimary(context);
  }
  parsePrimary(context) {
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

function evaluateExpression(formula, context) {
  const tokens = feTokenize(formula);
  return new FeParser(tokens).parseExpression(context);
}

function extractIdentifiers(formula) {
  const tokens = feTokenize(formula);
  return tokens.filter((t) => t.type === "ident").map((t) => t.value);
}

/**
 * Resolves every component's annual/monthly amount from CTC + formulas,
 * evaluating in dependency order. Every result carries a human-readable
 * trace back to the formula that produced it.
 */
function resolveSalaryStructure(annualCTC, components) {
  const byCode = new Map(components.map((c) => [c.code.toUpperCase(), c]));
  const context = { CTC: annualCTC };
  const resolved = {};

  const visiting = new Set();
  const done = new Set();

  function resolve(code) {
    if (done.has(code)) return;
    if (visiting.has(code)) {
      throw new Error(`Circular formula dependency detected involving '${code}'`);
    }
    const def = byCode.get(code);
    if (!def) throw new Error(`Unknown salary component '${code}' referenced in a formula`);
    visiting.add(code);

    let annual;
    let trace;
    if (!def.formula || !def.formula.trim()) {
      annual = def.fixedAnnualAmount ?? 0;
      trace = `Fixed amount: Rs ${annual.toLocaleString("en-IN")}`;
    } else {
      const deps = extractIdentifiers(def.formula).filter((id) => id !== "CTC" && byCode.has(id));
      for (const dep of deps) resolve(dep);
      annual = evaluateExpression(def.formula, context);
      const substituted = extractIdentifiers(def.formula)
        .map((id) => `${id}=Rs ${(context[id] ?? 0).toLocaleString("en-IN")}`)
        .join(", ");
      trace = `${def.formula} (${substituted}) = Rs ${Math.round(annual).toLocaleString("en-IN")}`;
    }

    context[code] = annual;
    resolved[code] = {
      code,
      annualAmount: annual,
      monthlyAmount: Math.round((annual / 12) * 100) / 100,
      formulaTrace: trace,
    };
    visiting.delete(code);
    done.add(code);
  }

  for (const code of byCode.keys()) resolve(code);
  return resolved;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { evaluateExpression, extractIdentifiers, resolveSalaryStructure };
}
