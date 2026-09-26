import { evaluateExpression, extractIdentifiers } from "./expression";

export interface ComponentDef {
  code: string; // e.g. "BASIC", "HRA", "EMPLOYER_PF"
  formula?: string | null; // e.g. "40% of CTC" or "BASIC * 0.5"; null => fixed amount
  fixedAnnualAmount?: number; // used when formula is null, or as an override
}

export interface ResolvedComponent {
  code: string;
  annualAmount: number;
  monthlyAmount: number;
  formulaTrace: string;
}

/**
 * Resolves every component's annual/monthly amount from CTC + formulas,
 * evaluating in dependency order (e.g. "Special Allowance = CTC - Basic -
 * HRA" is evaluated after Basic and HRA). Every result carries a
 * human-readable trace back to the formula that produced it.
 */
export function resolveSalaryStructure(
  annualCTC: number,
  components: ComponentDef[],
): Record<string, ResolvedComponent> {
  const byCode = new Map(components.map((c) => [c.code.toUpperCase(), c]));
  const context: Record<string, number> = { CTC: annualCTC };
  const resolved: Record<string, ResolvedComponent> = {};

  const visiting = new Set<string>();
  const done = new Set<string>();

  function resolve(code: string) {
    if (done.has(code)) return;
    if (visiting.has(code)) {
      throw new Error(`Circular formula dependency detected involving '${code}'`);
    }
    const def = byCode.get(code);
    if (!def) throw new Error(`Unknown salary component '${code}' referenced in a formula`);
    visiting.add(code);

    let annual: number;
    let trace: string;
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
