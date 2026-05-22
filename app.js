const FORMULA_MAX_ABS_Y = 1000000;
const FORMULA_E_CONSTANT = 2.718281828459045;
const DEG = Math.PI / 180;
const ZERO_SIZE_TOLERANCE = 1e-7;

const els = {
  upperEquation: document.getElementById("upperEquation"),
  lowerEquation: document.getElementById("lowerEquation"),
  orientationToggle: document.getElementById("orientationToggle"),
  upperEquationPrefix: document.getElementById("upperEquationPrefix"),
  lowerEquationPrefix: document.getElementById("lowerEquationPrefix"),
  upperFunctionLabel: document.getElementById("upperFunctionLabel"),
  lowerFunctionLabel: document.getElementById("lowerFunctionLabel"),
  minValueLabel: document.getElementById("minValueLabel"),
  maxValueLabel: document.getElementById("maxValueLabel"),
  crossSectionShape: document.getElementById("crossSectionShape"),
  rectangleWidth: document.getElementById("rectangleWidth"),
  trapezoidK: document.getElementById("trapezoidK"),
  rectangleWidthRow: document.getElementById("rectangleWidthRow"),
  trapezoidKRow: document.getElementById("trapezoidKRow"),
  xMin: document.getElementById("xMin"),
  xMax: document.getElementById("xMax"),
  sliceCount: document.getElementById("sliceCount"),
  scaleFactor: document.getElementById("scaleFactor"),
  alternateSlices: document.getElementById("alternateSlices"),
  statusPill: document.getElementById("statusPill"),
  sampleSummary: document.getElementById("sampleSummary"),
  shapeSummary: document.getElementById("shapeSummary"),
  regionSvg: document.getElementById("regionSvg"),
  solidCanvas: document.getElementById("solidCanvas"),
  formulaOutput: document.getElementById("formulaOutput"),
  exactOutput: document.getElementById("exactOutput"),
  exportSvg: document.getElementById("exportSvg"),
  exportCsv: document.getElementById("exportCsv"),
  exportJson: document.getElementById("exportJson"),
  exportPng: document.getElementById("exportPng"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
  solidHome: document.getElementById("solidHome"),
  tabsList: document.getElementById("tabsList"),
  addTabButton: document.getElementById("addTabButton"),
  tabPreview: document.getElementById("tabPreview")
};

let lastState = null;
let graphViewport = null;
let graphBaseViewport = null;
let previousGraphKey = "";
let graphDrag = null;
let solidDrag = null;
let applyingTabSettings = false;
let activeTabId = "tab-1";
let tabCounter = 1;
let functionTabs = [];
let equationOrientation = "y";
const solidView = {
  rotX: -0.46,
  rotY: 0.72,
  panX: 0,
  panY: 0,
  zoom: 1.45
};
const solidHomeView = { ...solidView };

function formulaIsDigit(c) {
  return c >= "0" && c <= "9";
}

function formulaIsLetter(c) {
  return c >= "a" && c <= "z";
}

function formulaIsFunctionName(name) {
  return ["sin", "cos", "tan", "sqrt", "abs", "arcsin", "arccos", "arctan", "log", "ln"].includes(name);
}

function formulaRemoveSpaces(text) {
  return text.split("").filter((c) => c !== " ").join("");
}

function formulaNormalizeEquation(equation) {
  let compact = formulaRemoveSpaces(equation);
  const equalsIndex = compact.indexOf("=");

  if (equalsIndex >= 0) {
    if (compact.indexOf("=", equalsIndex + 1) >= 0) throw new Error("Only one equals sign is supported.");
    const leftSide = compact.substring(0, equalsIndex).toLowerCase();
    if (!["x", "y", "f", "g", "f(x)", "g(x)", "y(x)", "x(y)"].includes(leftSide)) {
      throw new Error("Use a bare expression like 2x, or choose x= or y= and enter only the expression.");
    }
    compact = compact.substring(equalsIndex + 1);
  }

  if (compact.length === 0) throw new Error("Formula is empty.");
  return compact;
}

function formulaDescribeToken(token) {
  return token.kind === "NUMBER" ? String(token.value) : token.value;
}

function formulaTokenize(expression) {
  const tokens = [];
  let i = 0;

  while (i < expression.length) {
    const c = expression.substring(i, i + 1);

    if (formulaIsDigit(c) || c === ".") {
      const start = i;
      let hasDot = c === ".";
      i += 1;
      while (i < expression.length) {
        const nextC = expression.substring(i, i + 1);
        if (formulaIsDigit(nextC)) i += 1;
        else if (nextC === "." && !hasDot) {
          hasDot = true;
          i += 1;
        } else break;
      }

      const numberText = expression.substring(start, i);
      if (numberText === ".") throw new Error("Invalid number: decimal point must have digits.");
      tokens.push({ kind: "NUMBER", value: Number(numberText) });
      continue;
    }

    if (c === "x" || c === "y") {
      tokens.push({ kind: "X", value: "x" });
      i += 1;
      continue;
    }

    if (formulaIsLetter(c)) {
      const startLetter = i;
      i += 1;
      while (i < expression.length && formulaIsLetter(expression.substring(i, i + 1))) i += 1;
      const name = expression.substring(startLetter, i);

      if (name === "pi") tokens.push({ kind: "NUMBER", value: Math.PI });
      else if (name === "e") tokens.push({ kind: "NUMBER", value: FORMULA_E_CONSTANT });
      else if (formulaIsFunctionName(name)) tokens.push({ kind: "FUNC", value: name });
      else throw new Error(`Unsupported function or name: ${name}. Supported names are x, y, pi, e, sin, cos, tan, sqrt, abs, arcsin, arccos, arctan, log, and ln.`);
      continue;
    }

    if (["+", "-", "*", "/", "^"].includes(c)) {
      tokens.push({ kind: "OP", value: c });
      i += 1;
      continue;
    }

    if (c === "(") {
      tokens.push({ kind: "LPAREN", value: c });
      i += 1;
      continue;
    }

    if (c === ")") {
      tokens.push({ kind: "RPAREN", value: c });
      i += 1;
      continue;
    }

    throw new Error(`Unsupported character in formula: ${c}`);
  }

  return tokens;
}

function formulaCanEndFactor(token) {
  return token.kind === "NUMBER" || token.kind === "X" || token.kind === "RPAREN";
}

function formulaCanStartFactor(token) {
  return token.kind === "NUMBER" || token.kind === "X" || token.kind === "LPAREN" || token.kind === "FUNC";
}

function formulaInsertImplicitMultiplication(tokens) {
  const result = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (i > 0 && formulaCanEndFactor(tokens[i - 1]) && formulaCanStartFactor(tokens[i])) {
      result.push({ kind: "OP", value: "*" });
    }
    result.push(tokens[i]);
  }
  return result;
}

function formulaParseComplete(tokens) {
  const parsed = formulaParseAdditive(tokens, 0);
  if (parsed.index !== tokens.length) {
    throw new Error(`Unexpected token after complete expression: ${formulaDescribeToken(tokens[parsed.index])}.`);
  }
  return parsed.node;
}

function formulaParseAdditive(tokens, index) {
  let parsedLeft = formulaParseMultiplicative(tokens, index);
  let left = parsedLeft.node;
  let nextIndex = parsedLeft.index;

  while (nextIndex < tokens.length && tokens[nextIndex].kind === "OP" && ["+", "-"].includes(tokens[nextIndex].value)) {
    const op = tokens[nextIndex].value;
    const parsedRight = formulaParseMultiplicative(tokens, nextIndex + 1);
    left = { nodeType: "BINARY", op, left, right: parsedRight.node };
    nextIndex = parsedRight.index;
  }
  return { node: left, index: nextIndex };
}

function formulaParseMultiplicative(tokens, index) {
  let parsedLeft = formulaParseUnary(tokens, index);
  let left = parsedLeft.node;
  let nextIndex = parsedLeft.index;

  while (nextIndex < tokens.length && tokens[nextIndex].kind === "OP" && ["*", "/"].includes(tokens[nextIndex].value)) {
    const op = tokens[nextIndex].value;
    const parsedRight = formulaParseUnary(tokens, nextIndex + 1);
    left = { nodeType: "BINARY", op, left, right: parsedRight.node };
    nextIndex = parsedRight.index;
  }
  return { node: left, index: nextIndex };
}

function formulaParseUnary(tokens, index) {
  if (index >= tokens.length) throw new Error("Expected a value but reached the end of the formula.");
  const token = tokens[index];

  if (token.kind === "OP" && (token.value === "+" || token.value === "-")) {
    const parsedArgument = formulaParseUnary(tokens, index + 1);
    if (token.value === "+") return parsedArgument;
    return { node: { nodeType: "UNARY", op: "-", argument: parsedArgument.node }, index: parsedArgument.index };
  }
  return formulaParsePower(tokens, index);
}

function formulaParsePower(tokens, index) {
  let parsedBase = formulaParsePrimary(tokens, index);
  let base = parsedBase.node;
  let nextIndex = parsedBase.index;

  if (nextIndex < tokens.length && tokens[nextIndex].kind === "OP" && tokens[nextIndex].value === "^") {
    if (nextIndex + 1 >= tokens.length) throw new Error("Invalid exponent syntax: expected a value after '^'.");
    const nextToken = tokens[nextIndex + 1];
    if (nextToken.kind === "RPAREN" || (nextToken.kind === "OP" && nextToken.value !== "-" && nextToken.value !== "+")) {
      throw new Error("Invalid exponent syntax: expected a value after '^'.");
    }
    const parsedExponent = formulaParseUnary(tokens, nextIndex + 1);
    base = { nodeType: "BINARY", op: "^", left: base, right: parsedExponent.node };
    nextIndex = parsedExponent.index;
  }
  return { node: base, index: nextIndex };
}

function formulaParsePrimary(tokens, index) {
  if (index >= tokens.length) throw new Error("Expected a value but reached the end of the formula.");
  const token = tokens[index];

  if (token.kind === "NUMBER") return { node: { nodeType: "NUMBER", value: token.value }, index: index + 1 };
  if (token.kind === "X") return { node: { nodeType: "X" }, index: index + 1 };

  if (token.kind === "FUNC") {
    const functionName = token.value;
    if (index + 1 >= tokens.length || tokens[index + 1].kind !== "LPAREN") {
      throw new Error(`Function ${functionName} requires parentheses, for example ${functionName}(x).`);
    }
    const parsedArgument = formulaParseAdditive(tokens, index + 2);
    if (parsedArgument.index >= tokens.length || tokens[parsedArgument.index].kind !== "RPAREN") {
      throw new Error(`Missing closing parenthesis after function ${functionName}.`);
    }
    return { node: { nodeType: "FUNC", name: functionName, argument: parsedArgument.node }, index: parsedArgument.index + 1 };
  }

  if (token.kind === "LPAREN") {
    const parsedInside = formulaParseAdditive(tokens, index + 1);
    if (parsedInside.index >= tokens.length || tokens[parsedInside.index].kind !== "RPAREN") throw new Error("Missing closing parenthesis.");
    return { node: parsedInside.node, index: parsedInside.index + 1 };
  }

  if (token.kind === "RPAREN") throw new Error("Missing value before closing parenthesis.");
  if (token.kind === "OP" && token.value === "^") throw new Error("Invalid exponent syntax: expected a base before '^'.");
  if (token.kind === "OP") throw new Error(`Expected a value but found operator '${token.value}'.`);
  throw new Error("Unexpected parser token.");
}

function formulaOk(value) {
  if (Math.abs(value) > FORMULA_MAX_ABS_Y) return { ok: false, value: 0, reason: "value is too large or near a vertical asymptote" };
  return { ok: true, value, reason: "" };
}

function formulaFail(reason) {
  return { ok: false, value: 0, reason };
}

function formulaIsNearlyInteger(value) {
  const rounded = value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
  return Math.abs(value - rounded) < 1e-10;
}

function formulaEvaluateAst(node, x) {
  if (node.nodeType === "NUMBER") return formulaOk(node.value);
  if (node.nodeType === "X") return formulaOk(x);

  if (node.nodeType === "UNARY") {
    const valueResult = formulaEvaluateAst(node.argument, x);
    if (!valueResult.ok) return valueResult;
    return formulaOk(-valueResult.value);
  }

  if (node.nodeType === "FUNC") {
    const argumentResult = formulaEvaluateAst(node.argument, x);
    if (!argumentResult.ok) return argumentResult;
    const a = argumentResult.value;

    if (node.name === "sqrt") return a < 0 ? formulaFail("sqrt argument is negative") : formulaOk(Math.sqrt(a));
    if (node.name === "abs") return formulaOk(Math.abs(a));
    if (node.name === "ln") return a <= 0 ? formulaFail("ln argument must be greater than 0") : formulaOk(Math.log(a));
    if (node.name === "log") return a <= 0 ? formulaFail("log argument must be greater than 0") : formulaOk(Math.log(a) / Math.log(10));
    if (node.name === "sin") return formulaOk(Math.sin(a * DEG));
    if (node.name === "cos") return formulaOk(Math.cos(a * DEG));
    if (node.name === "tan") {
      const denominator = Math.cos(a * DEG);
      if (Math.abs(denominator) < 1e-7) return formulaFail("tan is undefined near this x-value");
      return formulaOk(Math.sin(a * DEG) / denominator);
    }
    if (node.name === "arcsin") {
      const tolerance = 1e-10;
      if (a < -1 - tolerance || a > 1 + tolerance) return formulaFail("arcsin argument must be between -1 and 1");
      return formulaOk(Math.asin(Math.max(-1, Math.min(1, a))) / DEG);
    }
    if (node.name === "arccos") {
      const tolerance = 1e-10;
      if (a < -1 - tolerance || a > 1 + tolerance) return formulaFail("arccos argument must be between -1 and 1");
      return formulaOk(Math.acos(Math.max(-1, Math.min(1, a))) / DEG);
    }
    if (node.name === "arctan") return formulaOk(Math.atan(a) / DEG);
    return formulaFail("unsupported function");
  }

  if (node.nodeType === "BINARY") {
    const leftResult = formulaEvaluateAst(node.left, x);
    if (!leftResult.ok) return leftResult;
    const rightResult = formulaEvaluateAst(node.right, x);
    if (!rightResult.ok) return rightResult;
    const a = leftResult.value;
    const b = rightResult.value;

    if (node.op === "+") return formulaOk(a + b);
    if (node.op === "-") return formulaOk(a - b);
    if (node.op === "*") return formulaOk(a * b);
    if (node.op === "/") return Math.abs(b) < 1e-12 ? formulaFail("division by zero") : formulaOk(a / b);
    if (node.op === "^") {
      if (Math.abs(a) < 1e-12 && b < 0) return formulaFail("zero cannot be raised to a negative exponent");
      if (a < 0 && !formulaIsNearlyInteger(b)) return formulaFail("negative base with non-integer exponent is not real-valued");
      return formulaOk(a ** b);
    }
    return formulaFail("unsupported operator");
  }

  return formulaFail("unknown expression node");
}

function formulaBuildAst(equation) {
  const normalized = formulaNormalizeEquation(equation);
  const rawTokens = formulaTokenize(normalized);
  const tokens = formulaInsertImplicitMultiplication(rawTokens);
  return formulaParseComplete(tokens);
}

/* -------------------------- Math.js algebra engine ----------------------- */

const SUPERSCRIPT_DIGITS = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9"
};

function mathEngineReady() {
  return typeof window.math !== "undefined";
}

function replaceSuperscripts(text) {
  return text.replace(/([a-zA-Z0-9)\]])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, base, powers) => {
    return `${base}^${powers.split("").map((c) => SUPERSCRIPT_DIGITS[c]).join("")}`;
  });
}

function replaceAbsoluteBars(text) {
  let result = "";
  let open = false;
  for (const c of text) {
    if (c === "|") {
      result += open ? ")" : "abs(";
      open = !open;
    } else {
      result += c;
    }
  }
  if (open) throw new Error("Absolute value bars are not balanced. Use |x| or abs(x).");
  return result;
}

function replaceBalancedFunction(expression, name, replacementName, suffixArgument = "") {
  let result = "";
  let i = 0;
  while (i < expression.length) {
    if (expression.slice(i, i + name.length + 1).toLowerCase() === `${name}(`) {
      let depth = 0;
      let end = -1;
      for (let j = i + name.length; j < expression.length; j += 1) {
        const c = expression[j];
        if (c === "(") depth += 1;
        if (c === ")") depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
      if (end < 0) throw new Error(`Missing closing parenthesis after ${name}.`);
      const inside = expression.slice(i + name.length + 1, end);
      result += `${replacementName}(${inside}${suffixArgument})`;
      i = end + 1;
    } else {
      result += expression[i];
      i += 1;
    }
  }
  return result;
}

function normalizeAlgebraEquation(equation) {
  let compact = equation.trim();
  compact = compact.replace(/−/g, "-").replace(/π/g, "pi");
  compact = replaceSuperscripts(compact);
  compact = replaceAbsoluteBars(compact);
  compact = compact.replace(/\s+/g, "");
  const equalsIndex = compact.indexOf("=");
  if (equalsIndex >= 0) {
    if (compact.indexOf("=", equalsIndex + 1) >= 0) throw new Error("Only one equals sign is supported.");
    const leftSide = compact.slice(0, equalsIndex).toLowerCase();
    if (!["x", "y", "f", "g", "f(x)", "g(x)", "y(x)", "x(y)"].includes(leftSide)) {
      throw new Error("Use a bare expression like 2x, or choose x= or y= and enter only the expression.");
    }
    compact = compact.slice(equalsIndex + 1);
  }
  if (!compact) throw new Error("Formula is empty.");
  compact = compact.replace(/\barcsin\s*\(/gi, "asin(")
    .replace(/\barccos\s*\(/gi, "acos(")
    .replace(/\barctan\s*\(/gi, "atan(")
    .replace(/\bln\s*\(/gi, "log(")
    .replace(/\blog(?!10)\s*\(/gi, "log10(");
  compact = replaceBalancedFunction(compact, "cbrt", "nthRoot", ",3");
  return compact;
}

function buildMathExpression(equation, field) {
  try {
    const normalized = normalizeAlgebraEquation(equation);
    if (!mathEngineReady()) {
      const ast = formulaBuildAst(equation);
      return {
        engine: "featurescript-fallback",
        normalized,
        display: formulaNormalizeEquation(equation),
        ast,
        evaluate(x) {
          return formulaEvaluateAst(ast, x);
        },
        toTex() {
          return symToTex(symFromAst(ast));
        },
        toSym() {
          return symFromAst(ast);
        }
      };
    }
    const node = window.math.parse(normalized);
    const simplified = window.math.simplify(node);
    const code = node.compile();
    return {
      engine: "mathjs",
      normalized,
      display: simplified.toString(),
      node,
      simplified,
      evaluate(x) {
        try {
          const value = code.evaluate({ x, pi: Math.PI, e: Math.E });
          if (typeof value !== "number" || !Number.isFinite(value)) return formulaFail("value is not real-valued at this x-value");
          return formulaOk(value);
        } catch (error) {
          return formulaFail(error.message || "cannot evaluate this x-value");
        }
      },
      toTex() {
        return simplified.toTex({ parenthesis: "auto", implicit: "show" });
      },
      toSym() {
        return symFromMathNode(simplified);
      }
    };
  } catch (error) {
    error.field = field;
    error.examples = "Examples: x^2, 2x + 1, sqrt(1 - x^2), sin(x), ln(x), |x|, e^x, (x^2 + 1)/(x + 2).";
    throw error;
  }
}

function replaceVariableForDisplay(text, fromVariable, toVariable) {
  return text.replace(new RegExp(`\\b${fromVariable}\\b`, "g"), toVariable);
}

function adaptExpressionVariable(expression, orientation) {
  if (orientation === "y") return expression;
  const normalized = replaceVariableForDisplay(expression.normalized, "x", "y");
  const display = replaceVariableForDisplay(expression.display, "x", "y");
  return {
    ...expression,
    normalized,
    display,
    evaluate(y) {
      try {
        if (expression.engine === "mathjs") {
          const value = expression.node.compile().evaluate({ x: y, y, pi: Math.PI, e: Math.E });
          if (typeof value !== "number" || !Number.isFinite(value)) return formulaFail("value is not real-valued at this y-value");
          return formulaOk(value);
        }
        return expression.evaluate(y);
      } catch (error) {
        return formulaFail(error.message || "cannot evaluate this y-value");
      }
    },
    toTex() {
      return replaceVariableForDisplay(expression.toTex(), "x", "y");
    }
  };
}

function getSettings() {
  const orientation = equationOrientation;
  return {
    upperEquation: els.upperEquation.value,
    lowerEquation: els.lowerEquation.value,
    orientation,
    upperOrientation: orientation,
    lowerOrientation: orientation,
    crossSectionShape: els.crossSectionShape.value,
    rectangleWidth: Number(els.rectangleWidth.value),
    trapezoidK: Number(els.trapezoidK.value),
    xMin: Number(els.xMin.value),
    xMax: Number(els.xMax.value),
    sliceCount: Math.round(Number(els.sliceCount.value)),
    scaleFactor: Number(els.scaleFactor.value),
    alternateSlices: els.alternateSlices.checked
  };
}

function settingsFromDom() {
  const orientation = equationOrientation;
  return {
    upperEquation: els.upperEquation.value,
    lowerEquation: els.lowerEquation.value,
    orientation,
    upperOrientation: orientation,
    lowerOrientation: orientation,
    crossSectionShape: els.crossSectionShape.value,
    rectangleWidth: els.rectangleWidth.value,
    trapezoidK: els.trapezoidK.value,
    xMin: els.xMin.value,
    xMax: els.xMax.value,
    sliceCount: els.sliceCount.value,
    scaleFactor: els.scaleFactor.value,
    alternateSlices: els.alternateSlices.checked
  };
}

function applySettingsToDom(settings) {
  applyingTabSettings = true;
  equationOrientation = settings.orientation ?? settings.upperOrientation ?? "y";
  els.upperEquation.value = settings.upperEquation ?? "";
  els.lowerEquation.value = settings.lowerEquation ?? "";
  els.crossSectionShape.value = settings.crossSectionShape ?? "CIRCLE";
  els.rectangleWidth.value = settings.rectangleWidth ?? "0.5";
  els.trapezoidK.value = settings.trapezoidK ?? "1";
  els.xMin.value = settings.xMin ?? "";
  els.xMax.value = settings.xMax ?? "";
  els.sliceCount.value = settings.sliceCount ?? "100";
  els.scaleFactor.value = settings.scaleFactor ?? "1";
  els.alternateSlices.checked = Boolean(settings.alternateSlices);
  applyingTabSettings = false;
}

function defaultTabSettings() {
  return {
    upperEquation: "",
    lowerEquation: "",
    orientation: "y",
    upperOrientation: "y",
    lowerOrientation: "y",
    crossSectionShape: "CIRCLE",
    rectangleWidth: "0.5",
    trapezoidK: "1",
    xMin: "",
    xMax: "",
    sliceCount: "100",
    scaleFactor: "1",
    alternateSlices: false
  };
}

function currentTab() {
  return functionTabs.find((tab) => tab.id === activeTabId);
}

function saveActiveTabSettings() {
  const tab = currentTab();
  if (!tab) return;
  tab.settings = settingsFromDom();
}

function validateBounds(s) {
  const variable = s.upperOrientation === "x" ? "y" : "x";
  if (els.xMin.value.trim() === "") throw new Error(`Minimum ${variable}-value is required.`);
  if (els.xMax.value.trim() === "") throw new Error(`Maximum ${variable}-value is required.`);
  if (els.upperEquation.value.trim() === "") {
    const error = new Error("Upper equation f(x) is required.");
    error.field = "upper";
    error.examples = "Examples: x^2, 2x + 1, sqrt(1 - x^2), sin(x), ln(x), |x|.";
    throw error;
  }
  if (els.lowerEquation.value.trim() === "") {
    const error = new Error("Lower equation g(x) is required.");
    error.field = "lower";
    error.examples = "Examples: 0, x, -sqrt(1 - x^2), x^2 - 1.";
    throw error;
  }
  if (s.xMax <= s.xMin) throw new Error(`Maximum ${variable}-value must be greater than minimum ${variable}-value.`);
  if (s.sliceCount < 2) throw new Error("Number of slices must be at least 2.");
  if (s.sliceCount > 250) throw new Error("Number of slices cannot exceed 250.");
  if (s.scaleFactor <= 0) throw new Error("scaleFactor must be greater than 0.");
  if (s.crossSectionShape === "RECTANGLE" && s.rectangleWidth <= 0) throw new Error("Rectangle width must be greater than 0.");
  if (s.crossSectionShape === "TRAPEZOID" && s.trapezoidK <= 0) throw new Error("Trapezoid k value must be greater than 0.");
}

function modelAreaForDistance(distance, s) {
  const modelDistance = distance * s.scaleFactor;
  if (s.crossSectionShape === "SEMICIRCLE") return Math.PI * modelDistance * modelDistance / 8;
  if (s.crossSectionShape === "CIRCLE") return Math.PI * modelDistance * modelDistance / 4;
  if (s.crossSectionShape === "RECTANGLE") return modelDistance * s.rectangleWidth;
  return 1.5 * s.trapezoidK * modelDistance * modelDistance;
}

function computeState() {
  const settings = getSettings();
  validateBounds(settings);
  if (settings.upperOrientation !== settings.lowerOrientation) {
    throw new Error("Both functions must use the same orientation for one solid: choose y= for both, or x= for both.");
  }
  const sweepVariable = settings.upperOrientation === "x" ? "y" : "x";
  const dependentVariable = settings.upperOrientation === "x" ? "x" : "y";
  const upperExpression = adaptExpressionVariable(buildMathExpression(settings.upperEquation, "upper"), settings.upperOrientation);
  const lowerExpression = adaptExpressionVariable(buildMathExpression(settings.lowerEquation, "lower"), settings.lowerOrientation);
  const denominator = settings.sliceCount - 1;
  const graphUnitLength = settings.scaleFactor;
  const sliceSpacing = ((settings.xMax - settings.xMin) / denominator) * graphUnitLength;
  const alternateSliceHalfThickness = sliceSpacing * 0.225;
  const samples = [];
  const skipped = [];

  for (let i = 0; i < settings.sliceCount; i += 1) {
    const t = i / denominator;
    const sweep = settings.xMin + t * (settings.xMax - settings.xMin);
    if (settings.alternateSlices && i % 2 === 1) {
      skipped.push({ index: i, x: sweep, reason: "alternate slice skipped" });
      continue;
    }

    const upperResult = upperExpression.evaluate(sweep);
    const lowerResult = lowerExpression.evaluate(sweep);
    if (!upperResult.ok || !lowerResult.ok) {
      skipped.push({ index: i, x: sweep, reason: upperResult.ok ? lowerResult.reason : upperResult.reason });
      continue;
    }

    const upperValue = upperResult.value;
    const lowerValue = lowerResult.value;
    const distance = upperValue - lowerValue;
    if (distance < -ZERO_SIZE_TOLERANCE) throw new Error(`Upper equation is below lower equation at ${sweepVariable} = ${formatNumber(sweep)}.`);
    const midValue = (upperValue + lowerValue) / 2;
    const area = Math.abs(distance) <= ZERO_SIZE_TOLERANCE ? 0 : modelAreaForDistance(distance, settings);
    const graphX = settings.upperOrientation === "x" ? midValue : sweep;
    const graphY = settings.upperOrientation === "x" ? sweep : midValue;
    const upperPoint = settings.upperOrientation === "x" ? { x: upperValue, y: sweep } : { x: sweep, y: upperValue };
    const lowerPoint = settings.upperOrientation === "x" ? { x: lowerValue, y: sweep } : { x: sweep, y: lowerValue };

    samples.push({
      index: i,
      x: sweep,
      sweep,
      t,
      upperY: upperValue,
      lowerY: lowerValue,
      upperPoint,
      lowerPoint,
      distance,
      midY: midValue,
      graphX,
      graphY,
      area,
      modelX: graphX * graphUnitLength,
      modelMidY: graphY * graphUnitLength,
      modelDistance: distance * graphUnitLength
    });
  }

  if (samples.length < 1) throw new Error("The selected range produced no usable cross sections.");
  if (!settings.alternateSlices && samples.length < 2) throw new Error("The selected range produced fewer than two usable cross sections.");

  return {
    settings,
    samples,
    skipped,
    normalizedUpper: upperExpression.display,
    normalizedLower: lowerExpression.display,
    upperExpression,
    lowerExpression,
    upperAst: upperExpression.ast,
    lowerAst: lowerExpression.ast,
    sweepVariable,
    dependentVariable,
    sliceSpacing,
    alternateSliceHalfThickness,
    graphUnitLength,
    browserEstimate: estimateVolume(samples, settings)
  };
}

function estimateVolume(samples, s) {
  // The FeatureScript lofts or extrudes geometry and does not report volume.
  // This estimate is intentionally labeled browser-only, and uses the same sampled cross-section areas.
  if (samples.length < 2) return null;
  if (s.alternateSlices) {
    const dx = ((s.xMax - s.xMin) / (s.sliceCount - 1)) * s.scaleFactor;
    return samples.reduce((sum, p) => sum + p.area * dx * 0.45, 0);
  }
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const dx = (samples[i].x - samples[i - 1].x) * s.scaleFactor;
    total += ((samples[i - 1].area + samples[i].area) / 2) * dx;
  }
  return total;
}

function formatNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return String(value);
  const fixed = Math.abs(value) >= 10000 || Math.abs(value) < 0.0001 && value !== 0
    ? value.toExponential(4)
    : value.toFixed(digits);
  return fixed.replace(/\.?0+($|e)/, "$1");
}

function areaFormula(shape, s) {
  const b = "[f(x) - g(x)]";
  const scaledB = `(${formatNumber(s.scaleFactor)} * ${b})`;
  if (shape === "SEMICIRCLE") return `A_model(x) = pi/8 * ${scaledB}^2`;
  if (shape === "CIRCLE") return `A_model(x) = pi/4 * ${scaledB}^2`;
  if (shape === "RECTANGLE") return `A_model(x) = ${formatNumber(s.rectangleWidth)} * ${scaledB}`;
  return `A_model(x) = (3/2) * ${formatNumber(s.trapezoidK)} * ${scaledB}^2`;
}

function shapeDescription(shape, s) {
  if (shape === "SEMICIRCLE") return "Semicircle: diameter = b(x)";
  if (shape === "CIRCLE") return "Circle: diameter = b(x)";
  if (shape === "RECTANGLE") return `Rectangle: height = b(x), width = ${formatNumber(s.rectangleWidth)} in`;
  return `Trapezoid: top = b(x), bottom = 2b(x), height = ${formatNumber(s.trapezoidK)}b(x)`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function texEscapeText(text) {
  return String(text).replace(/\\/g, "\\textbackslash{}").replace(/[{}_&%$#]/g, (c) => `\\${c}`);
}

function renderMathBlock(container, entries) {
  container.innerHTML = entries.map((entry) => {
    if (entry.type === "note") return `<div class="math-note">${escapeHtml(entry.text)}</div>`;
    return `<div class="math-line">\\[${entry.tex}\\]</div>`;
  }).join("");
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([container]).catch(() => {});
  } else if (window.MathJax?.startup?.promise) {
    window.MathJax.startup.promise.then(() => window.MathJax.typesetPromise?.([container])).catch(() => {});
  }
}

function sym(type, props = {}) {
  return { type, ...props };
}

function symFromAst(node) {
  if (node.nodeType === "NUMBER") return sym("num", { value: node.value });
  if (node.nodeType === "X") return sym("x");
  if (node.nodeType === "UNARY") return symSimplify(sym("*", { left: sym("num", { value: -1 }), right: symFromAst(node.argument) }));
  if (node.nodeType === "FUNC") return symSimplify(sym(node.name, { argument: symFromAst(node.argument) }));
  if (node.nodeType === "BINARY") return symSimplify(sym(node.op, { left: symFromAst(node.left), right: symFromAst(node.right) }));
  throw new Error("Unsupported expression node.");
}

function symFromMathNode(node) {
  if (!node) throw new Error("Unsupported empty expression.");
  if (node.isParenthesisNode) return symFromMathNode(node.content);
  if (node.isConstantNode) {
    if (node.name === "pi") return sym("num", { value: Math.PI });
    if (node.name === "e") return sym("num", { value: Math.E });
    return sym("num", { value: Number(node.value) });
  }
  if (node.isSymbolNode) {
    if (node.name === "x") return sym("x");
    if (node.name === "pi") return sym("num", { value: Math.PI });
    if (node.name === "e") return sym("num", { value: Math.E });
    throw new Error(`Only x is supported as a variable, but found ${node.name}.`);
  }
  if (node.isOperatorNode) {
    if (node.fn === "unaryMinus") return symSimplify(sym("*", { left: sym("num", { value: -1 }), right: symFromMathNode(node.args[0]) }));
    if (node.fn === "unaryPlus") return symFromMathNode(node.args[0]);
    return symSimplify(sym(node.op, { left: symFromMathNode(node.args[0]), right: symFromMathNode(node.args[1]) }));
  }
  if (node.isFunctionNode) {
    const name = node.name === "nthRoot" && node.args.length === 2 && node.args[1].value === "3" ? "cbrt" : node.name;
    return symSimplify(sym(name, { argument: symFromMathNode(node.args[0]) }));
  }
  throw new Error(`The exact integrator does not support ${node.type}.`);
}

function symEquals(a, b) {
  return symToString(a) === symToString(b);
}

function symSimplify(node) {
  if (!node || node.type === "num" || node.type === "x") return node;
  if (node.argument) {
    const argument = symSimplify(node.argument);
    if (node.type === "sqrt") return sym("sqrt", { argument });
    return sym(node.type, { argument });
  }

  const left = symSimplify(node.left);
  const right = symSimplify(node.right);
  if (left.type === "num" && right.type === "num") {
    if (node.type === "+") return sym("num", { value: left.value + right.value });
    if (node.type === "-") return sym("num", { value: left.value - right.value });
    if (node.type === "*") return sym("num", { value: left.value * right.value });
    if (node.type === "/" && Math.abs(right.value) > 1e-12) return sym("num", { value: left.value / right.value });
    if (node.type === "^") return sym("num", { value: left.value ** right.value });
  }
  if (node.type === "+") {
    if (left.type === "num" && Math.abs(left.value) < 1e-12) return right;
    if (right.type === "num" && Math.abs(right.value) < 1e-12) return left;
    if (symEquals(left, right)) return symSimplify(sym("*", { left: sym("num", { value: 2 }), right: left }));
  }
  if (node.type === "-") {
    if (right.type === "num" && Math.abs(right.value) < 1e-12) return left;
    if (symEquals(left, right)) return sym("num", { value: 0 });
    if (right.type === "*" && right.left.type === "num" && Math.abs(right.left.value + 1) < 1e-12) {
      return symSimplify(sym("+", { left, right: right.right }));
    }
  }
  if (node.type === "*") {
    if ((left.type === "num" && Math.abs(left.value) < 1e-12) || (right.type === "num" && Math.abs(right.value) < 1e-12)) return sym("num", { value: 0 });
    if (left.type === "num" && Math.abs(left.value - 1) < 1e-12) return right;
    if (right.type === "num" && Math.abs(right.value - 1) < 1e-12) return left;
    if (left.type === "sqrt" && right.type === "sqrt" && symEquals(left.argument, right.argument)) return left.argument;
  }
  if (node.type === "^") {
    if (right.type === "num" && Math.abs(right.value - 1) < 1e-12) return left;
    if (right.type === "num" && Math.abs(right.value) < 1e-12) return sym("num", { value: 1 });
    if (right.type === "num" && Math.abs(right.value - 2) < 1e-12 && left.type === "sqrt") return left.argument;
    if (right.type === "num" && formulaIsNearlyInteger(right.value) && right.value >= 0 && left.type === "*") {
      return symSimplify(sym("*", {
        left: symSimplify(sym("^", { left: left.left, right })),
        right: symSimplify(sym("^", { left: left.right, right }))
      }));
    }
  }
  return sym(node.type, { left, right });
}

function symToString(node) {
  if (node.type === "num") return formatNumber(node.value, 6);
  if (node.type === "x") return "x";
  if (node.argument) return `${node.type}(${symToString(node.argument)})`;
  const op = node.type;
  return `(${symToString(node.left)} ${op} ${symToString(node.right)})`;
}

function needsParensForTex(node) {
  return node.type === "+" || node.type === "-";
}

function symToTex(node) {
  node = symSimplify(node);
  if (node.type === "num") return formatNumber(node.value, 6);
  if (node.type === "x") return "x";
  if (node.argument) {
    if (node.type === "sqrt") return `\\sqrt{${symToTex(node.argument)}}`;
    if (node.type === "cbrt") return `\\sqrt[3]{${symToTex(node.argument)}}`;
    if (node.type === "abs") return `\\left|${symToTex(node.argument)}\\right|`;
    if (node.type === "log10") return `\\log_{10}\\left(${symToTex(node.argument)}\\right)`;
    if (node.type === "asin") return `\\arcsin\\left(${symToTex(node.argument)}\\right)`;
    if (node.type === "acos") return `\\arccos\\left(${symToTex(node.argument)}\\right)`;
    if (node.type === "atan") return `\\arctan\\left(${symToTex(node.argument)}\\right)`;
    return `\\${node.type}\\left(${symToTex(node.argument)}\\right)`;
  }
  const left = symToTex(node.left);
  const rightRaw = symToTex(node.right);
  const right = needsParensForTex(node.right) ? `\\left(${rightRaw}\\right)` : rightRaw;
  if (node.type === "+") return `${left} + ${rightRaw}`;
  if (node.type === "-") return `${left} - ${right}`;
  if (node.type === "*") {
    if (node.left.type === "num" && node.right.type !== "num") {
      if (Math.abs(node.left.value + 1) < 1e-12) return `-${needsParensForTex(node.right) ? `\\left(${rightRaw}\\right)` : rightRaw}`;
      if (Math.abs(node.left.value - 1) < 1e-12) return `${needsParensForTex(node.right) ? `\\left(${rightRaw}\\right)` : rightRaw}`;
      return `${formatNumber(node.left.value, 6)}${needsParensForTex(node.right) ? `\\left(${rightRaw}\\right)` : rightRaw}`;
    }
    return `${needsParensForTex(node.left) ? `\\left(${left}\\right)` : left}\\left(${rightRaw}\\right)`;
  }
  if (node.type === "/") return `\\frac{${left}}{${rightRaw}}`;
  if (node.type === "^") return `${needsParensForTex(node.left) ? `\\left(${left}\\right)` : left}^{${rightRaw}}`;
  return symToString(node);
}

function polyAdd(a, b) {
  const out = { ...a };
  for (const [power, coefficient] of Object.entries(b)) out[power] = (out[power] || 0) + coefficient;
  return cleanPoly(out);
}

function polyScale(a, scalar) {
  const out = {};
  for (const [power, coefficient] of Object.entries(a)) out[power] = coefficient * scalar;
  return cleanPoly(out);
}

function polyMul(a, b) {
  const out = {};
  for (const [ap, ac] of Object.entries(a)) {
    for (const [bp, bc] of Object.entries(b)) {
      const power = Number(ap) + Number(bp);
      out[power] = (out[power] || 0) + ac * bc;
    }
  }
  return cleanPoly(out);
}

function polyPow(poly, exponent) {
  let out = { 0: 1 };
  for (let i = 0; i < exponent; i += 1) out = polyMul(out, poly);
  return out;
}

function cleanPoly(poly) {
  const out = {};
  for (const [power, coefficient] of Object.entries(poly)) {
    if (Math.abs(coefficient) > 1e-10) out[power] = coefficient;
  }
  return out;
}

function polyFromSym(node) {
  node = symSimplify(node);
  if (node.type === "num") return { 0: node.value };
  if (node.type === "x") return { 1: 1 };
  if (node.type === "+") return polyAdd(polyFromSym(node.left), polyFromSym(node.right));
  if (node.type === "-") return polyAdd(polyFromSym(node.left), polyScale(polyFromSym(node.right), -1));
  if (node.type === "*") return polyMul(polyFromSym(node.left), polyFromSym(node.right));
  if (node.type === "/") {
    const right = polyFromSym(node.right);
    if (Object.keys(right).length === 1 && right[0] !== undefined) return polyScale(polyFromSym(node.left), 1 / right[0]);
  }
  if (node.type === "^" && node.right.type === "num" && formulaIsNearlyInteger(node.right.value) && node.right.value >= 0) {
    return polyPow(polyFromSym(node.left), Math.round(node.right.value));
  }
  throw new Error(`The exact integrator cannot reduce ${symToString(node)} to a polynomial.`);
}

function polyToString(poly) {
  const terms = Object.entries(cleanPoly(poly)).map(([power, coefficient]) => ({ power: Number(power), coefficient })).sort((a, b) => b.power - a.power);
  if (terms.length === 0) return "0";
  return terms.map(({ power, coefficient }, index) => {
    const sign = coefficient < 0 ? "-" : index === 0 ? "" : "+";
    const absCoeff = Math.abs(coefficient);
    const coeffText = power === 0 || Math.abs(absCoeff - 1) > 1e-10 ? formatNumber(absCoeff, 6) : "";
    const xText = power === 0 ? "" : power === 1 ? "x" : `x^${power}`;
    return `${sign}${coeffText}${coeffText && xText ? "*" : ""}${xText}`;
  }).join(" ").replace(/\+ -/g, "- ");
}

function antiderivativePoly(poly) {
  const out = {};
  for (const [powerText, coefficient] of Object.entries(poly)) {
    const power = Number(powerText);
    out[power + 1] = coefficient / (power + 1);
  }
  return cleanPoly(out);
}

function evaluatePoly(poly, x) {
  return Object.entries(poly).reduce((sum, [power, coefficient]) => sum + coefficient * x ** Number(power), 0);
}

function coefficientToTex(value, options = {}) {
  const { omitOne = false, piFactor = false } = options;
  if (Math.abs(value) < 1e-10) return "0";
  const absValue = Math.abs(value);
  const rational = rationalApprox(absValue);
  let base;
  if (rational && rational.error < 1e-8) {
    if (omitOne && rational.numerator === 1 && rational.denominator === 1 && !piFactor) base = "";
    else if (rational.denominator === 1) base = String(rational.numerator);
    else base = `\\frac{${rational.numerator}}{${rational.denominator}}`;
  } else {
    base = formatNumber(absValue, 6);
  }
  if (piFactor) {
    if (base === "" || base === "1") return "\\pi";
    if (base.startsWith("\\frac{")) {
      const match = base.match(/^\\frac\{(.+)\}\{(.+)\}$/);
      if (match) return match[1] === "1" ? `\\frac{\\pi}{${match[2]}}` : `\\frac{${match[1]}\\pi}{${match[2]}}`;
    }
    return `${base}\\pi`;
  }
  return base;
}

function polyToTex(poly, options = {}) {
  const terms = Object.entries(cleanPoly(poly)).map(([power, coefficient]) => ({ power: Number(power), coefficient })).sort((a, b) => b.power - a.power);
  if (terms.length === 0) return "0";
  return terms.map(({ power, coefficient }, index) => {
    const sign = coefficient < 0 ? "-" : index === 0 ? "" : "+";
    const coeff = coefficientToTex(coefficient, { omitOne: power !== 0, piFactor: options.piFactor });
    const variable = power === 0 ? "" : power === 1 ? "x" : `x^{${power}}`;
    const body = `${coeff}${coeff && variable ? " " : ""}${variable}`;
    return `${sign}${index === 0 ? "" : " "}${body}`;
  }).join(" ");
}

function volumeMultiplierForShape(s) {
  if (s.crossSectionShape === "SEMICIRCLE") return Math.PI / 8 * s.scaleFactor ** 3;
  if (s.crossSectionShape === "CIRCLE") return Math.PI / 4 * s.scaleFactor ** 3;
  if (s.crossSectionShape === "RECTANGLE") return s.rectangleWidth * s.scaleFactor ** 2;
  return 1.5 * s.trapezoidK * s.scaleFactor ** 3;
}

function volumeMultiplierTex(s) {
  if (s.crossSectionShape === "SEMICIRCLE") return multiplierTimesTex(1 / 8 * s.scaleFactor ** 3, true);
  if (s.crossSectionShape === "CIRCLE") return multiplierTimesTex(1 / 4 * s.scaleFactor ** 3, true);
  if (s.crossSectionShape === "RECTANGLE") return coefficientToTex(s.rectangleWidth * s.scaleFactor ** 2);
  return coefficientToTex(1.5 * s.trapezoidK * s.scaleFactor ** 3);
}

function multiplierTimesTex(value, piFactor) {
  return coefficientToTex(value, { piFactor });
}

function rationalApprox(value, maxDenominator = 100000) {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  value = Math.abs(value);
  let bestNumerator = Math.round(value);
  let bestDenominator = 1;
  let bestError = Math.abs(value - bestNumerator);
  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(value * denominator);
    const error = Math.abs(value - numerator / denominator);
    if (error < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
      if (error < 1e-10) break;
    }
  }
  return { numerator: sign * bestNumerator, denominator: bestDenominator, error: bestError };
}

function exactValueLine(value, state, baseIntegral) {
  const s = state.settings;
  const hasPi = s.crossSectionShape === "SEMICIRCLE" || s.crossSectionShape === "CIRCLE";
  if (!hasPi) return `Exact volume = ${formatNumber(value, 8)} cubic inches`;
  const coefficient = baseIntegral * (volumeMultiplierForShape(s) / Math.PI);
  const rational = rationalApprox(coefficient);
  if (rational && rational.error < 1e-8 && rational.denominator !== 1) {
    return `Exact volume = ${rational.numerator}*pi/${rational.denominator} cubic inches ≈ ${formatNumber(value, 8)}`;
  }
  if (rational && rational.error < 1e-8) {
    return `Exact volume = ${rational.numerator}*pi cubic inches ≈ ${formatNumber(value, 8)}`;
  }
  return `Exact volume = ${formatNumber(coefficient, 8)}*pi cubic inches ≈ ${formatNumber(value, 8)}`;
}

function exactValueTex(value, state, baseIntegral) {
  const s = state.settings;
  const hasPi = s.crossSectionShape === "SEMICIRCLE" || s.crossSectionShape === "CIRCLE";
  if (!hasPi) return { exact: coefficientToTex(value), approx: formatNumber(value, 8) };
  const coefficient = baseIntegral * (volumeMultiplierForShape(s) / Math.PI);
  return { exact: coefficientToTex(coefficient, { piFactor: true }), approx: formatNumber(value, 8) };
}

function algebriteReady() {
  return typeof window.Algebrite !== "undefined" && typeof window.Algebrite.run === "function";
}

function algebriteExpr(text) {
  return text
    .replace(/\bnthRoot\(([^,]+),3\)/g, "($1)^(1/3)")
    .replace(/\blog10\(/g, "log10(")
    .replace(/\basin\(/g, "arcsin(")
    .replace(/\bacos\(/g, "arccos(")
    .replace(/\batan\(/g, "arctan(");
}

function algebriteRun(command) {
  return String(window.Algebrite.run(command)).trim();
}

function algebriteNumeric(expression) {
  const candidates = [];
  try {
    candidates.push(algebriteRun(`float(${expression})`));
  } catch (error) {
    candidates.push(expression);
  }
  candidates.push(expression);

  for (const candidate of candidates) {
    const direct = Number(candidate);
    if (Number.isFinite(direct)) return direct;
    const jsExpression = candidate.replace(/\bpi\b/gi, `(${Math.PI})`).replace(/\^/g, "**");
    if (/^[0-9+\-*/().\sEe]+$/.test(jsExpression)) {
      try {
        const value = Function(`"use strict"; return (${jsExpression});`)();
        if (Number.isFinite(value)) return value;
      } catch (error) {
        // Try the next candidate.
      }
    }
  }

  return NaN;
}

function algebriteLatex(expression) {
  try {
    return algebriteRun(`printlatex(${expression})`);
  } catch (error) {
    return expression.replace(/\*/g, " ");
  }
}

function algebriteMultiplier(s) {
  const scale = formatNumber(s.scaleFactor, 12);
  if (s.crossSectionShape === "SEMICIRCLE") return `(pi/8)*(${scale})^3`;
  if (s.crossSectionShape === "CIRCLE") return `(pi/4)*(${scale})^3`;
  if (s.crossSectionShape === "RECTANGLE") return `(${formatNumber(s.rectangleWidth, 12)})*(${scale})^2`;
  return `(3/2)*(${formatNumber(s.trapezoidK, 12)})*(${scale})^3`;
}

function algebriteExactVolumeEntries(state) {
  if (!algebriteReady()) return null;
  try {
    const s = state.settings;
    const v = state.sweepVariable;
    const upper = algebriteExpr(state.upperExpression.normalized);
    const lower = algebriteExpr(state.lowerExpression.normalized);
    const bExpr = algebriteRun(`simplify((${upper})-(${lower}))`);
    const baseExpr = s.crossSectionShape === "RECTANGLE" ? bExpr : algebriteRun(`simplify((${bExpr})^2)`);
    const areaExpr = algebriteRun(`simplify((${algebriteMultiplier(s)})*(${baseExpr}))`);
    const antiderivative = algebriteRun(`integral(${areaExpr},${v})`);
    const upperValue = algebriteRun(`subst(${formatNumber(s.xMax, 12)},${v},${antiderivative})`);
    const lowerValue = algebriteRun(`subst(${formatNumber(s.xMin, 12)},${v},${antiderivative})`);
    const exactVolume = algebriteRun(`simplify((${upperValue})-(${lowerValue}))`);
    const approx = algebriteNumeric(exactVolume);
    return [
      { tex: `b(${v}) = ${algebriteLatex(bExpr)}` },
      { tex: `${s.crossSectionShape === "RECTANGLE" ? `b(${v})` : `b(${v})^2`} = ${algebriteLatex(baseExpr)}` },
      { tex: `A(${v}) = ${algebriteLatex(areaExpr)}` },
      { tex: `V = \\int_{${formatNumber(s.xMin)}}^{${formatNumber(s.xMax)}} ${algebriteLatex(areaExpr)}\\,d${v}` },
      { tex: `V = \\left[${algebriteLatex(antiderivative)}\\right]_{${formatNumber(s.xMin)}}^{${formatNumber(s.xMax)}}` },
      { tex: `V = ${algebriteLatex(exactVolume)}\\text{ cubic inches}` },
      { tex: `V \\approx ${formatNumber(approx, 8)}\\text{ cubic inches}` },
      { type: "note", text: "Exact work simplified with Algebrite CAS." }
    ];
  } catch (error) {
    return null;
  }
}

function setupMathEntries(state) {
  const s = state.settings;
  const v = state.sweepVariable;
  const entries = [
    { tex: `b(${v}) = ${state.upperExpression.toTex()} - \\left(${state.lowerExpression.toTex()}\\right)` }
  ];
  if (v === "x") {
    const upperSym = state.upperExpression.toSym();
    const lowerSym = state.lowerExpression.toSym();
    const rawB = symSimplify(sym("-", { left: upperSym, right: lowerSym }));
    const simplifiedB = symSimplify(rawB);
    if (symToTex(simplifiedB) !== `${state.upperExpression.toTex()} - \\left(${state.lowerExpression.toTex()}\\right)`) {
      entries.push({ tex: `b(${v}) = ${symToTex(simplifiedB)}` });
    }
  }
  entries.push({ tex: areaFormulaTex(s, v) });
  entries.push({ tex: `V = \\int_{${formatNumber(s.xMin)}}^{${formatNumber(s.xMax)}} A(${v})\\,d${v}` });
  entries.push({ tex: `\\text{Model scale: }1\\text{ graph unit }= ${formatNumber(s.scaleFactor)}\\text{ inch}` });
  return entries;
}

function areaFormulaTex(s, variable = "x") {
  if (s.crossSectionShape === "SEMICIRCLE") return `A(${variable}) = \\frac{\\pi}{8}\\left[f(${variable})-g(${variable})\\right]^2`;
  if (s.crossSectionShape === "CIRCLE") return `A(${variable}) = \\frac{\\pi}{4}\\left[f(${variable})-g(${variable})\\right]^2`;
  if (s.crossSectionShape === "RECTANGLE") return `A(${variable}) = ${coefficientToTex(s.rectangleWidth)}\\left[f(${variable})-g(${variable})\\right]`;
  return `A(${variable}) = \\frac{3}{2}\\,${coefficientToTex(s.trapezoidK)}\\left[f(${variable})-g(${variable})\\right]^2`;
}

function tabTitle(tab, index) {
  const settings = tab.settings;
  const upper = settings.upperEquation?.trim();
  const lower = settings.lowerEquation?.trim();
  if (upper || lower) {
    const orientation = settings.orientation ?? settings.upperOrientation ?? "y";
    const variable = orientation === "x" ? "y" : "x";
    return `${orientation} = ${upper || "?"} / ${lower || "?"} (${variable})`;
  }
  return `Setup ${index + 1}`;
}

function renderTabs() {
  els.tabsList.innerHTML = "";
  functionTabs.forEach((tab, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `function-tab${tab.id === activeTabId ? " active" : ""}`;
    button.textContent = tabTitle(tab, index);
    button.setAttribute("aria-current", tab.id === activeTabId ? "page" : "false");
    button.addEventListener("click", () => switchToTab(tab.id));
    button.addEventListener("mouseenter", (event) => showTabPreview(tab, event.currentTarget));
    button.addEventListener("mousemove", (event) => positionTabPreview(event.currentTarget));
    button.addEventListener("mouseleave", hideTabPreview);
    els.tabsList.append(button);
  });
}

function switchToTab(tabId) {
  if (tabId === activeTabId) return;
  saveActiveTabSettings();
  activeTabId = tabId;
  const tab = currentTab();
  if (!tab) return;
  applySettingsToDom(tab.settings);
  graphViewport = null;
  graphBaseViewport = null;
  previousGraphKey = "";
  renderTabs();
  render();
}

function addFunctionTab() {
  saveActiveTabSettings();
  tabCounter += 1;
  const tab = {
    id: `tab-${tabCounter}`,
    settings: defaultTabSettings()
  };
  functionTabs.push(tab);
  activeTabId = tab.id;
  applySettingsToDom(tab.settings);
  graphViewport = null;
  graphBaseViewport = null;
  previousGraphKey = "";
  renderTabs();
  render();
}

function tabSettingsAsNumbers(settings) {
  return {
    ...settings,
    rectangleWidth: Number(settings.rectangleWidth),
    trapezoidK: Number(settings.trapezoidK),
    xMin: Number(settings.xMin),
    xMax: Number(settings.xMax),
    sliceCount: Math.round(Number(settings.sliceCount)),
    scaleFactor: Number(settings.scaleFactor),
    alternateSlices: Boolean(settings.alternateSlices)
  };
}

function previewSectionSvg(shape, distance, settings) {
  const safeDistance = Math.max(Math.abs(distance), 0.001);
  const width = 290;
  const height = 120;
  const cx = width / 2;
  const floorY = 92;
  const scale = Math.min(50 / safeDistance, 28);
  const r = safeDistance * scale / 2;
  const depth = Math.max(10, Math.min(44, (settings.rectangleWidth || 1) * scale));
  const trapezoidHeight = Math.max(14, Math.min(52, (settings.trapezoidK || 1) * safeDistance * scale));
  const stroke = "#0284c7";
  const fill = "rgba(2, 132, 199, 0.15)";

  if (shape === "SEMICIRCLE") {
    return `<svg viewBox="0 0 ${width} ${height}" aria-label="Semicircle cross-section preview">
      <line x1="18" y1="${floorY}" x2="${width - 18}" y2="${floorY}" stroke="#d7ddd2"/>
      <path d="M ${cx - r} ${floorY} A ${r} ${r} 0 0 1 ${cx + r} ${floorY} L ${cx - r} ${floorY} Z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    </svg>`;
  }
  if (shape === "CIRCLE") {
    return `<svg viewBox="0 0 ${width} ${height}" aria-label="Circle cross-section preview">
      <line x1="18" y1="${floorY}" x2="${width - 18}" y2="${floorY}" stroke="#d7ddd2"/>
      <circle cx="${cx}" cy="${floorY - r}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    </svg>`;
  }
  if (shape === "RECTANGLE") {
    return `<svg viewBox="0 0 ${width} ${height}" aria-label="Rectangle cross-section preview">
      <line x1="18" y1="${floorY}" x2="${width - 18}" y2="${floorY}" stroke="#d7ddd2"/>
      <rect x="${cx - r}" y="${floorY - depth}" width="${2 * r}" height="${depth}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" aria-label="Trapezoid cross-section preview">
    <line x1="18" y1="${floorY}" x2="${width - 18}" y2="${floorY}" stroke="#d7ddd2"/>
    <polygon points="${cx - r},${floorY} ${cx + r},${floorY} ${cx + 2 * r},${floorY - trapezoidHeight} ${cx - 2 * r},${floorY - trapezoidHeight}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
  </svg>`;
}

function buildTabPreview(tab) {
  const raw = tab.settings;
  if (!raw.upperEquation?.trim() || !raw.lowerEquation?.trim()) {
    return `<h3>${escapeHtml(tabTitle(tab, functionTabs.indexOf(tab)))}</h3><p>No function preview yet. Add upper and lower equations in this tab.</p>`;
  }
  if (String(raw.xMin).trim() === "" || String(raw.xMax).trim() === "") {
    return `<h3>${escapeHtml(tabTitle(tab, functionTabs.indexOf(tab)))}</h3><p>Add an interval to preview the cross-sectional area.</p>`;
  }

  try {
    const settings = tabSettingsAsNumbers(raw);
    const orientation = settings.orientation ?? settings.upperOrientation ?? "y";
    const variable = orientation === "x" ? "y" : "x";
    const upperExpression = adaptExpressionVariable(buildMathExpression(raw.upperEquation, "upper"), orientation);
    const lowerExpression = adaptExpressionVariable(buildMathExpression(raw.lowerEquation, "lower"), orientation);
    const midpoint = (settings.xMin + settings.xMax) / 2;
    const upper = upperExpression.evaluate(midpoint);
    const lower = lowerExpression.evaluate(midpoint);
    if (!upper.ok || !lower.ok) throw new Error(upper.ok ? lower.reason : upper.reason);
    const distance = upper.value - lower.value;
    const area = modelAreaForDistance(Math.max(distance, 0), settings);
    return `
      <h3>${escapeHtml(tabTitle(tab, functionTabs.indexOf(tab)))}</h3>
      <p>${escapeHtml(shapeDescription(settings.crossSectionShape, settings))}</p>
      <p class="preview-math">\\(${areaFormulaTex(settings, variable)}\\)</p>
      <p>At ${variable} = ${formatNumber(midpoint)}, b(${variable}) = ${formatNumber(distance)} and A(${variable}) ≈ ${formatNumber(area, 6)} sq in.</p>
      ${previewSectionSvg(settings.crossSectionShape, distance, settings)}
    `;
  } catch (error) {
    return `<h3>${escapeHtml(tabTitle(tab, functionTabs.indexOf(tab)))}</h3><p>${escapeHtml(error.message || "Preview unavailable for this tab.")}</p>`;
  }
}

function positionTabPreview(target) {
  const rect = target.getBoundingClientRect();
  const preview = els.tabPreview;
  const left = Math.min(window.innerWidth - preview.offsetWidth - 18, Math.max(18, rect.left));
  const top = rect.bottom + 10;
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
}

function showTabPreview(tab, target) {
  saveActiveTabSettings();
  els.tabPreview.innerHTML = buildTabPreview(tab);
  els.tabPreview.classList.remove("hidden");
  positionTabPreview(target);
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([els.tabPreview]).catch(() => {});
  }
}

function hideTabPreview() {
  els.tabPreview.classList.add("hidden");
}

function toggleEquationOrientation() {
  equationOrientation = equationOrientation === "y" ? "x" : "y";
  graphViewport = null;
  graphBaseViewport = null;
  previousGraphKey = "";
  render();
}

function exactVolumeWorkEntries(state) {
  const casEntries = algebriteExactVolumeEntries(state);
  if (casEntries) return casEntries;
  if (state.sweepVariable !== "x") {
    return [
      { tex: `b(y) = ${state.upperExpression.toTex()} - \\left(${state.lowerExpression.toTex()}\\right)` },
      { tex: `V = \\int_{${formatNumber(state.settings.xMin)}}^{${formatNumber(state.settings.xMax)}} A(y)\\,dy` },
      { type: "note", text: "Exact symbolic work for x = f(y) is shown as setup only in this version." }
    ];
  }

  const s = state.settings;
  const b = symSimplify(sym("-", { left: state.upperExpression.toSym(), right: state.lowerExpression.toSym() }));
  const usesSquare = s.crossSectionShape !== "RECTANGLE";
  const baseIntegrand = usesSquare ? symSimplify(sym("^", { left: b, right: sym("num", { value: 2 }) })) : b;
  const multiplier = volumeMultiplierForShape(s);
  const multiplierTex = volumeMultiplierTex(s);
  const piFactor = s.crossSectionShape === "SEMICIRCLE" || s.crossSectionShape === "CIRCLE";

  try {
    const basePoly = polyFromSym(baseIntegrand);
    const integrandPoly = polyScale(basePoly, multiplier);
    const baseAntiderivative = antiderivativePoly(basePoly);
    const baseIntegral = evaluatePoly(baseAntiderivative, s.xMax) - evaluatePoly(baseAntiderivative, s.xMin);
    const antiderivative = antiderivativePoly(integrandPoly);
    const antiderivativeBase = antiderivativePoly(polyScale(basePoly, piFactor ? volumeMultiplierForShape(s) / Math.PI : multiplier));
    const upperValue = evaluatePoly(antiderivative, s.xMax);
    const lowerValue = evaluatePoly(antiderivative, s.xMin);
    const exactValue = upperValue - lowerValue;
    const exact = exactValueTex(exactValue, state, baseIntegral);
    const entries = [
      { tex: `b(x) = ${symToTex(b)}` }
    ];
    if (usesSquare && b.type === "*" && b.left.type === "num" && b.right.type === "sqrt") {
      entries.push({ tex: `b(x)^2 = ${coefficientToTex(b.left.value ** 2)}\\left(${symToTex(b.right.argument)}\\right)` });
    }
    entries.push({ tex: `${usesSquare ? "b(x)^2" : "b(x)"} = ${polyToTex(basePoly)}` });
    entries.push({ tex: `A(x) = ${multiplierTex}\\left(${polyToTex(basePoly)}\\right)` });
    entries.push({ tex: `A(x) = ${polyToTex(piFactor ? polyScale(basePoly, volumeMultiplierForShape(s) / Math.PI) : integrandPoly, { piFactor })}` });
    entries.push({ tex: `V = \\int_{${formatNumber(s.xMin)}}^{${formatNumber(s.xMax)}} \\left(${polyToTex(piFactor ? polyScale(basePoly, volumeMultiplierForShape(s) / Math.PI) : integrandPoly, { piFactor })}\\right)\\,dx` });
    entries.push({ tex: `V = \\left[${polyToTex(piFactor ? antiderivativeBase : antiderivative, { piFactor })}\\right]_{${formatNumber(s.xMin)}}^{${formatNumber(s.xMax)}}` });
    entries.push({ tex: `V = ${exact.exact}\\text{ cubic inches}` });
    entries.push({ tex: `V \\approx ${exact.approx}\\text{ cubic inches}` });
    return entries;
  } catch (error) {
    return [
      { tex: `b(x) = ${symToTex(b)}` },
      { tex: `V = \\int_{${formatNumber(s.xMin)}}^{${formatNumber(s.xMax)}} ${multiplierTex}\\left(${symToTex(baseIntegrand)}\\right)\\,dx` },
      { type: "note", text: `Symbolic antiderivative unavailable: ${error.message}` }
    ];
  }
}

function updateFormula(state) {
  renderMathBlock(els.formulaOutput, setupMathEntries(state));
  renderMathBlock(els.exactOutput, exactVolumeWorkEntries(state));
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function niceStep(span, targetTicks) {
  const raw = span / targetTicks;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const normalized = raw / power;
  if (normalized <= 1) return power;
  if (normalized <= 2) return 2 * power;
  if (normalized <= 5) return 5 * power;
  return 10 * power;
}

function appendText(parent, text, attrs) {
  const node = svgEl("text", attrs);
  node.textContent = text;
  parent.append(node);
  return node;
}

function sampleCurve(expression, xMin, xMax, count, orientation = "y") {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const sweep = xMin + (i / (count - 1)) * (xMax - xMin);
    const result = expression.evaluate(sweep);
    if (!result.ok) points.push(null);
    else points.push(orientation === "x" ? { x: result.value, y: sweep } : { x: sweep, y: result.value });
  }
  return points;
}

function pathFromPoints(points, sx, sy) {
  let d = "";
  let open = false;
  for (const point of points) {
    if (!point) {
      open = false;
      continue;
    }
    d += `${open ? "L" : "M"} ${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)} `;
    open = true;
  }
  return d.trim();
}

function getGraphKey(state) {
  const s = state.settings;
  return [
    s.upperEquation,
    s.lowerEquation,
    s.upperOrientation,
    s.lowerOrientation,
    s.xMin,
    s.xMax,
    s.sliceCount,
    s.alternateSlices
  ].join("|");
}

function computeGraphBaseViewport(state) {
  const s = state.settings;
  const usable = state.samples;
  const padX = Math.max((s.xMax - s.xMin) * 0.14, 0.5);
  const minX = s.xMin - padX;
  const maxX = s.xMax + padX;
  const denseCount = Math.max(420, s.sliceCount * 8);
  const sweepMin = state.settings.xMin - Math.max((state.settings.xMax - state.settings.xMin) * 0.14, 0.5);
  const sweepMax = state.settings.xMax + Math.max((state.settings.xMax - state.settings.xMin) * 0.14, 0.5);
  const upperCurve = sampleCurve(state.upperExpression, sweepMin, sweepMax, denseCount, state.settings.upperOrientation);
  const lowerCurve = sampleCurve(state.lowerExpression, sweepMin, sweepMax, denseCount, state.settings.lowerOrientation);
  const yValues = [
    ...usable.flatMap((p) => [p.upperPoint.y, p.lowerPoint.y, p.graphY]),
    ...upperCurve.filter(Boolean).map((p) => p.y),
    ...lowerCurve.filter(Boolean).map((p) => p.y),
    0
  ].filter((v) => Number.isFinite(v) && Math.abs(v) <= FORMULA_MAX_ABS_Y);
  const xValues = [
    ...usable.flatMap((p) => [p.upperPoint.x, p.lowerPoint.x, p.graphX]),
    ...upperCurve.filter(Boolean).map((p) => p.x),
    ...lowerCurve.filter(Boolean).map((p) => p.x),
    0
  ].filter((v) => Number.isFinite(v) && Math.abs(v) <= FORMULA_MAX_ABS_Y);
  const candidateMinX = Math.min(...xValues, state.settings.xMin);
  const candidateMaxX = Math.max(...xValues, state.settings.xMax);
  let minY = Math.min(...yValues, 0);
  let maxY = Math.max(...yValues, 0);
  const padY = Math.max((maxY - minY) * 0.18, 0.75);
  minY -= padY;
  maxY += padY;
  const finalMinX = state.settings.upperOrientation === "x" ? candidateMinX - Math.max((candidateMaxX - candidateMinX) * 0.14, 0.5) : minX;
  const finalMaxX = state.settings.upperOrientation === "x" ? candidateMaxX + Math.max((candidateMaxX - candidateMinX) * 0.14, 0.5) : maxX;
  const rect = els.regionSvg.getBoundingClientRect();
  const plot = graphPlotRect(rect.width || 900, rect.height || 500);
  return equalizeGraphViewport({ minX: finalMinX, maxX: finalMaxX, minY, maxY }, plot);
}

function graphPlotRect(width, height) {
  return { left: 54, top: 22, right: width - 24, bottom: height - 42 };
}

function equalizeGraphViewport(viewport, plot) {
  const plotWidth = Math.max(plot.right - plot.left, 1);
  const plotHeight = Math.max(plot.bottom - plot.top, 1);
  const targetRatio = plotWidth / plotHeight;
  const cx = (viewport.minX + viewport.maxX) / 2;
  const cy = (viewport.minY + viewport.maxY) / 2;
  let xSpan = viewport.maxX - viewport.minX;
  let ySpan = viewport.maxY - viewport.minY;

  if (xSpan / ySpan > targetRatio) {
    ySpan = xSpan / targetRatio;
  } else {
    xSpan = ySpan * targetRatio;
  }

  return {
    minX: cx - xSpan / 2,
    maxX: cx + xSpan / 2,
    minY: cy - ySpan / 2,
    maxY: cy + ySpan / 2
  };
}

function ensureGraphViewport(state) {
  const key = getGraphKey(state);
  if (!graphViewport || key !== previousGraphKey) {
    graphBaseViewport = computeGraphBaseViewport(state);
    graphViewport = { ...graphBaseViewport };
    previousGraphKey = key;
  }
}

function zoomGraph(factor, anchor) {
  if (!lastState || !graphViewport) return;
  const viewport = graphViewport;
  const cx = anchor?.x ?? (viewport.minX + viewport.maxX) / 2;
  const cy = anchor?.y ?? (viewport.minY + viewport.maxY) / 2;
  const nextWidth = (viewport.maxX - viewport.minX) * factor;
  const nextHeight = (viewport.maxY - viewport.minY) * factor;
  const minSpan = 1e-6;
  const maxSpan = Math.max((graphBaseViewport.maxX - graphBaseViewport.minX) * 80, 1);

  if (nextWidth < minSpan || nextHeight < minSpan || nextWidth > maxSpan || nextHeight > maxSpan) return;

  const xRatio = (cx - viewport.minX) / (viewport.maxX - viewport.minX);
  const yRatio = (cy - viewport.minY) / (viewport.maxY - viewport.minY);
  graphViewport = {
    minX: cx - nextWidth * xRatio,
    maxX: cx + nextWidth * (1 - xRatio),
    minY: cy - nextHeight * yRatio,
    maxY: cy + nextHeight * (1 - yRatio)
  };
  drawRegion(lastState);
}

function resetGraphZoom() {
  if (!lastState) return;
  graphBaseViewport = computeGraphBaseViewport(lastState);
  graphViewport = { ...graphBaseViewport };
  drawRegion(lastState);
}

function resetSolidView() {
  solidView.rotX = solidHomeView.rotX;
  solidView.rotY = solidHomeView.rotY;
  solidView.panX = solidHomeView.panX;
  solidView.panY = solidHomeView.panY;
  solidView.zoom = solidHomeView.zoom;
  if (lastState) drawSolid(lastState);
}

function panGraphByPixels(dx, dy, rect) {
  if (!lastState || !graphViewport) return;
  const plot = graphPlotRect(rect.width, rect.height);
  const xPerPixel = (graphViewport.maxX - graphViewport.minX) / (plot.right - plot.left);
  const yPerPixel = (graphViewport.maxY - graphViewport.minY) / (plot.bottom - plot.top);
  graphViewport = {
    minX: graphViewport.minX - dx * xPerPixel,
    maxX: graphViewport.maxX - dx * xPerPixel,
    minY: graphViewport.minY + dy * yPerPixel,
    maxY: graphViewport.maxY + dy * yPerPixel
  };
  drawRegion(lastState);
}

function drawRegion(state) {
  ensureGraphViewport(state);
  const svg = els.regionSvg;
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 500;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  const s = state.settings;
  const usable = state.samples;
  const plot = graphPlotRect(width, height);
  graphViewport = equalizeGraphViewport(graphViewport, plot);
  const minX = graphViewport.minX;
  const maxX = graphViewport.maxX;
  const denseCount = Math.max(420, s.sliceCount * 8);
  const sweepPad = Math.max((s.xMax - s.xMin) * 0.14, 0.5);
  const upperCurve = sampleCurve(state.upperExpression, s.xMin - sweepPad, s.xMax + sweepPad, denseCount, s.upperOrientation);
  const lowerCurve = sampleCurve(state.lowerExpression, s.xMin - sweepPad, s.xMax + sweepPad, denseCount, s.lowerOrientation);
  const minY = graphViewport.minY;
  const maxY = graphViewport.maxY;

  const sx = (x) => plot.left + ((x - minX) / (maxX - minX)) * (plot.right - plot.left);
  const sy = (y) => plot.bottom - ((y - minY) / (maxY - minY)) * (plot.bottom - plot.top);
  const clipId = "plotClip";
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id: clipId });
  clip.append(svgEl("rect", { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top }));
  defs.append(clip);
  svg.append(defs);

  const bg = svgEl("rect", { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top, fill: "#fff" });
  svg.append(bg);

  const gridStep = niceStep(Math.max(maxX - minX, maxY - minY), 9);
  const xStep = gridStep;
  const yStep = gridStep;
  const minorGrid = svgEl("g", { stroke: "#eef0f2", "stroke-width": "1" });
  const majorGrid = svgEl("g", { stroke: "#d8dce0", "stroke-width": "1" });
  const axisLabels = svgEl("g", { fill: "#6b7280", "font-size": "11", "font-family": "Inter, sans-serif" });

  for (let x = Math.ceil(minX / (xStep / 5)) * (xStep / 5); x <= maxX; x += xStep / 5) {
    const line = svgEl("line", { x1: sx(x), y1: plot.top, x2: sx(x), y2: plot.bottom });
    if (Math.abs(x / xStep - Math.round(x / xStep)) < 1e-7) majorGrid.append(line);
    else minorGrid.append(line);
  }

  for (let y = Math.ceil(minY / (yStep / 5)) * (yStep / 5); y <= maxY; y += yStep / 5) {
    const line = svgEl("line", { x1: plot.left, y1: sy(y), x2: plot.right, y2: sy(y) });
    if (Math.abs(y / yStep - Math.round(y / yStep)) < 1e-7) majorGrid.append(line);
    else minorGrid.append(line);
  }

  svg.append(minorGrid);
  svg.append(majorGrid);

  for (let x = Math.ceil(minX / xStep) * xStep; x <= maxX; x += xStep) {
    if (Math.abs(x) < 1e-9) continue;
    appendText(axisLabels, formatNumber(x, 3), { x: sx(x) + 3, y: Math.min(plot.bottom + 18, Math.max(plot.top + 14, sy(0) + 14)) });
  }

  for (let y = Math.ceil(minY / yStep) * yStep; y <= maxY; y += yStep) {
    if (Math.abs(y) < 1e-9) continue;
    appendText(axisLabels, formatNumber(y, 3), { x: Math.min(plot.right - 30, Math.max(plot.left + 4, sx(0) + 6)), y: sy(y) - 4 });
  }
  svg.append(axisLabels);

  svg.append(svgEl("line", { x1: plot.left, y1: sy(0), x2: plot.right, y2: sy(0), stroke: "#4b5563", "stroke-width": "1.8" }));
  svg.append(svgEl("line", { x1: sx(0), y1: plot.top, x2: sx(0), y2: plot.bottom, stroke: "#4b5563", "stroke-width": "1.8" }));

  const plotLayer = svgEl("g", { "clip-path": `url(#${clipId})` });
  const upper = usable.map((p) => `${sx(p.upperPoint.x)},${sy(p.upperPoint.y)}`).join(" ");
  const lower = usable.slice().reverse().map((p) => `${sx(p.lowerPoint.x)},${sy(p.lowerPoint.y)}`).join(" ");
  plotLayer.append(svgEl("polygon", { points: `${upper} ${lower}`, fill: "rgba(47, 95, 159, 0.16)", stroke: "none" }));
  plotLayer.append(svgEl("path", { d: pathFromPoints(upperCurve, sx, sy), fill: "none", stroke: "#c74440", "stroke-width": "3.4", "stroke-linecap": "round", "stroke-linejoin": "round" }));
  plotLayer.append(svgEl("path", { d: pathFromPoints(lowerCurve, sx, sy), fill: "none", stroke: "#2d70b3", "stroke-width": "3.4", "stroke-linecap": "round", "stroke-linejoin": "round" }));

  for (const p of usable) {
    const x1 = sx(p.lowerPoint.x);
    const y1 = sy(p.lowerPoint.y);
    const x2 = sx(p.upperPoint.x);
    const y2 = sy(p.upperPoint.y);
    plotLayer.append(svgEl("line", { x1, y1, x2, y2, stroke: "#111827", "stroke-width": s.alternateSlices ? "2.2" : "1", opacity: s.alternateSlices ? "0.62" : "0.28" }));
    if (Math.abs(p.distance) <= ZERO_SIZE_TOLERANCE) {
      plotLayer.append(svgEl("circle", { cx: sx(p.graphX), cy: sy(p.graphY), r: 3, fill: "#111827" }));
    }
  }
  svg.append(plotLayer);

  const legend = svgEl("g", { transform: `translate(${plot.left + 12}, ${plot.top + 14})` });
  legend.append(svgEl("rect", { x: 0, y: 0, width: 250, height: 72, rx: 6, fill: "rgba(255,255,255,0.88)", stroke: "#d8dce0" }));
  legend.append(svgEl("circle", { cx: 15, cy: 20, r: 5, fill: "#c74440" }));
  appendText(legend, `${s.upperOrientation} = ${state.normalizedUpper}`, { x: 28, y: 24, fill: "#222", "font-size": "12", "font-family": "Inter, sans-serif", "font-weight": "700" });
  legend.append(svgEl("circle", { cx: 15, cy: 44, r: 5, fill: "#2d70b3" }));
  appendText(legend, `${s.lowerOrientation} = ${state.normalizedLower}`, { x: 28, y: 48, fill: "#222", "font-size": "12", "font-family": "Inter, sans-serif", "font-weight": "700" });
  legend.append(svgEl("rect", { x: 11, y: 58, width: 8, height: 8, fill: "rgba(47, 95, 159, 0.22)", stroke: "#111827", "stroke-width": "0.8" }));
  appendText(legend, "sampled cross sections", { x: 28, y: 67, fill: "#4b5563", "font-size": "11", "font-family": "Inter, sans-serif" });
  svg.append(legend);

  appendText(svg, "x", { x: plot.right - 10, y: Math.min(plot.bottom - 8, Math.max(plot.top + 16, sy(0) - 8)), fill: "#4b5563", "font-size": "13", "font-weight": "800" });
  appendText(svg, "y", { x: Math.min(plot.right - 18, Math.max(plot.left + 8, sx(0) + 8)), y: plot.top + 16, fill: "#4b5563", "font-size": "13", "font-weight": "800" });
}

function rotatePoint(point) {
  const [x, y, z] = point;
  const cosY = Math.cos(solidView.rotY);
  const sinY = Math.sin(solidView.rotY);
  const cosX = Math.cos(solidView.rotX);
  const sinX = Math.sin(solidView.rotX);
  const xz = x * cosY + z * sinY;
  const zz = -x * sinY + z * cosY;
  const yz = y * cosX - zz * sinX;
  const z2 = y * sinX + zz * cosX;
  return [xz, yz, z2];
}

function project(point, width, height, bounds) {
  const rotated = rotatePoint([
    point[0] - bounds.center[0],
    point[1] - bounds.center[1],
    point[2] - bounds.center[2]
  ]);
  const scale = Math.min(width, height) / (bounds.span || 1) * 0.72 * solidView.zoom;
  return [
    width * 0.5 + solidView.panX + rotated[0] * scale,
    height * 0.56 + solidView.panY - rotated[1] * scale,
    rotated[2]
  ];
}

function computeSolidBounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const zs = points.map((p) => p[2]);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);
  const minZ = Math.min(...zs, 0);
  const maxZ = Math.max(...zs, 0);
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ
  };
}

function sectionPoints(sample, settings, segments = 28) {
  if (settings.upperOrientation === "x") {
    const midX = sample.modelX;
    const y = sample.modelMidY;
    const b = Math.max(sample.modelDistance, 0);
    const r = b / 2;
    if (Math.abs(b) <= ZERO_SIZE_TOLERANCE) return [[midX, y, 0]];

    if (settings.crossSectionShape === "SEMICIRCLE") {
      const pts = [];
      for (let i = 0; i <= segments; i += 1) {
        const angle = Math.PI - (Math.PI * i / segments);
        pts.push([midX + Math.cos(angle) * r, y, Math.sin(angle) * r]);
      }
      pts.push([midX - r, y, 0]);
      return pts;
    }
    if (settings.crossSectionShape === "CIRCLE") {
      const pts = [];
      for (let i = 0; i < segments; i += 1) {
        const angle = 2 * Math.PI * i / segments;
        pts.push([midX + Math.cos(angle) * r, y, r + Math.sin(angle) * r]);
      }
      return pts;
    }
    if (settings.crossSectionShape === "RECTANGLE") {
      return [
        [midX - r, y, 0],
        [midX + r, y, 0],
        [midX + r, y, settings.rectangleWidth],
        [midX - r, y, settings.rectangleWidth]
      ];
    }
    const topHalfBase = r;
    const bottomHalfBase = b;
    const h = settings.trapezoidK * b;
    return [
      [midX - topHalfBase, y, 0],
      [midX + topHalfBase, y, 0],
      [midX + bottomHalfBase, y, h],
      [midX - bottomHalfBase, y, h]
    ];
  }

  const x = sample.modelX;
  const midY = sample.modelMidY;
  const b = Math.max(sample.modelDistance, 0);
  const r = b / 2;
  if (Math.abs(b) <= ZERO_SIZE_TOLERANCE) return [[x, midY, 0]];

  if (settings.crossSectionShape === "SEMICIRCLE") {
    const pts = [];
    for (let i = 0; i <= segments; i += 1) {
      const angle = Math.PI - (Math.PI * i / segments);
      pts.push([x, midY + Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    pts.push([x, midY - r, 0]);
    return pts;
  }
  if (settings.crossSectionShape === "CIRCLE") {
    const pts = [];
    for (let i = 0; i < segments; i += 1) {
      const angle = 2 * Math.PI * i / segments;
      pts.push([x, midY + Math.cos(angle) * r, r + Math.sin(angle) * r]);
    }
    return pts;
  }
  if (settings.crossSectionShape === "RECTANGLE") {
    return [
      [x, midY - r, 0],
      [x, midY + r, 0],
      [x, midY + r, settings.rectangleWidth],
      [x, midY - r, settings.rectangleWidth]
    ];
  }
  const topHalfBase = r;
  const bottomHalfBase = b;
  const h = settings.trapezoidK * b;
  return [
    [x, midY - topHalfBase, 0],
    [x, midY + topHalfBase, 0],
    [x, midY + bottomHalfBase, h],
    [x, midY - bottomHalfBase, h]
  ];
}

function drawSolid(state) {
  const canvas = els.solidCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(600, Math.round(rect.width * dpr));
  canvas.height = Math.max(350, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  const sections = state.samples.map((p) => sectionPoints(p, state.settings));
  const allPoints = sections.flat();
  const bounds = computeSolidBounds(allPoints);

  ctx.fillStyle = "#fbfcfa";
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1;
  const gridSpacing = 40;
  ctx.strokeStyle = "#eef0eb";
  for (let x = 28; x <= width - 28; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, height - 30);
    ctx.stroke();
  }
  for (let y = 24; y <= height - 30; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(width - 28, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#d7ddd2";
  for (let x = 28; x <= width - 28; x += gridSpacing * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, height - 30);
    ctx.stroke();
  }
  for (let y = 24; y <= height - 30; y += gridSpacing * 2) {
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(width - 28, y);
    ctx.stroke();
  }

  drawInfiniteAxis(ctx, bounds, width, height, [0, 0, 0], [1, 0, 0], "#c74440", "X");
  drawInfiniteAxis(ctx, bounds, width, height, [0, 0, 0], [0, 1, 0], "#2d70b3", "Y");
  drawInfiniteAxis(ctx, bounds, width, height, [0, 0, 0], [0, 0, 1], "#388c46", "Z");

  if (!state.settings.alternateSlices && sections.length > 1) {
    ctx.fillStyle = "rgba(2, 132, 199, 0.13)";
    ctx.strokeStyle = "rgba(2, 132, 199, 0.3)";
    for (let i = 1; i < sections.length; i += 1) {
      const a = sections[i - 1];
      const b = sections[i];
      const n = Math.min(a.length, b.length);
      for (let j = 0; j < n; j += 1) {
        const p1 = project(a[j], width, height, bounds);
        const p2 = project(a[(j + 1) % n], width, height, bounds);
        const p3 = project(b[(j + 1) % n], width, height, bounds);
        const p4 = project(b[j], width, height, bounds);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.lineTo(p4[0], p4[1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  sections.forEach((section, i) => {
    const projected = section.map((p) => project(p, width, height, bounds));
    ctx.beginPath();
    ctx.moveTo(projected[0][0], projected[0][1]);
    for (let j = 1; j < projected.length; j += 1) ctx.lineTo(projected[j][0], projected[j][1]);
    if (projected.length > 1) ctx.closePath();
    ctx.fillStyle = state.settings.alternateSlices ? "rgba(47, 95, 159, 0.22)" : "rgba(182, 80, 47, 0.08)";
    ctx.strokeStyle = state.settings.alternateSlices ? "#2f5f9f" : "#b6502f";
    ctx.lineWidth = state.settings.alternateSlices ? 2.2 : Math.max(0.8, 2 - i / sections.length);
    if (projected.length > 2) ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = "#17201a";
  ctx.font = "700 13px Inter, sans-serif";
  ctx.fillText(state.settings.alternateSlices ? "Extruded alternate slice approximation" : "Lofted profile approximation", 28, 28);
}

function drawAxis(ctx, bounds, width, height, start, end, color, label) {
  const a = project(start, width, height, bounds);
  const b = project(end, width, height, bounds);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();

  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const size = 9;
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - Math.cos(angle - 0.45) * size, b[1] - Math.sin(angle - 0.45) * size);
  ctx.lineTo(b[0] - Math.cos(angle + 0.45) * size, b[1] - Math.sin(angle + 0.45) * size);
  ctx.closePath();
  ctx.fill();
  ctx.font = "800 14px Inter, sans-serif";
  ctx.fillText(label, b[0] + Math.cos(angle) * 12, b[1] + Math.sin(angle) * 12);
  ctx.restore();
}

function drawInfiniteAxis(ctx, bounds, width, height, origin, direction, color, label) {
  const a = project(origin, width, height, bounds);
  const b = project([
    origin[0] + direction[0],
    origin[1] + direction[1],
    origin[2] + direction[2]
  ], width, height, bounds);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return;

  const ux = dx / length;
  const uy = dy / length;
  const intersections = [];
  const addIfInside = (t) => {
    const x = a[0] + ux * t;
    const y = a[1] + uy * t;
    if (x >= -1 && x <= width + 1 && y >= -1 && y <= height + 1) intersections.push([x, y, t]);
  };

  if (Math.abs(ux) > 1e-9) {
    addIfInside((0 - a[0]) / ux);
    addIfInside((width - a[0]) / ux);
  }
  if (Math.abs(uy) > 1e-9) {
    addIfInside((0 - a[1]) / uy);
    addIfInside((height - a[1]) / uy);
  }

  let start;
  let end;
  if (intersections.length >= 2) {
    intersections.sort((p, q) => p[2] - q[2]);
    start = intersections[0];
    end = intersections[intersections.length - 1];
  } else {
    const reach = Math.hypot(width, height) * 2;
    start = [a[0] - ux * reach, a[1] - uy * reach];
    end = [a[0] + ux * reach, a[1] + uy * reach];
  }

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();

  const labelPoint = end;
  const labelX = Math.min(width - 28, Math.max(28, labelPoint[0] - ux * 28));
  const labelY = Math.min(height - 28, Math.max(32, labelPoint[1] - uy * 28));
  ctx.font = "800 14px Inter, sans-serif";
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}

function render() {
  if (!applyingTabSettings) saveActiveTabSettings();
  els.rectangleWidthRow.classList.toggle("hidden", els.crossSectionShape.value !== "RECTANGLE");
  els.trapezoidKRow.classList.toggle("hidden", els.crossSectionShape.value !== "TRAPEZOID");
  const intervalVariable = equationOrientation === "x" ? "y" : "x";
  els.orientationToggle.dataset.orientation = equationOrientation;
  els.orientationToggle.textContent = equationOrientation === "x" ? "Mode: x = f(y)" : "Mode: y = f(x)";
  els.upperEquationPrefix.textContent = `${equationOrientation} =`;
  els.lowerEquationPrefix.textContent = `${equationOrientation} =`;
  els.upperFunctionLabel.textContent = `Upper equation f(${intervalVariable})`;
  els.lowerFunctionLabel.textContent = `Lower equation g(${intervalVariable})`;
  els.minValueLabel.textContent = `Minimum ${intervalVariable}-value`;
  els.maxValueLabel.textContent = `Maximum ${intervalVariable}-value`;
  els.upperEquation.classList.remove("input-error");
  els.lowerEquation.classList.remove("input-error");
  els.xMin.classList.remove("input-error");
  els.xMax.classList.remove("input-error");

  try {
    const state = computeState();
    lastState = state;
    document.documentElement.dataset.mathEngine = state.upperExpression.engine;
    els.statusPill.textContent = "Ready";
    els.statusPill.classList.remove("error");
    els.sampleSummary.textContent = `${state.samples.length} usable of ${state.settings.sliceCount}`;
    els.shapeSummary.textContent = shapeDescription(state.settings.crossSectionShape, state.settings);
    drawRegion(state);
    drawSolid(state);
    updateFormula(state);
  } catch (error) {
    lastState = null;
    if (error.field === "upper") els.upperEquation.classList.add("input-error");
    if (error.field === "lower") els.lowerEquation.classList.add("input-error");
    if (error.message.includes("Minimum x-value") || error.message.includes("Minimum y-value")) els.xMin.classList.add("input-error");
    if (error.message.includes("Maximum x-value") || error.message.includes("Maximum y-value")) els.xMax.classList.add("input-error");
    els.statusPill.textContent = "Input error";
    els.statusPill.classList.add("error");
    els.sampleSummary.textContent = "";
    els.shapeSummary.textContent = "";
    els.regionSvg.innerHTML = "";
    const ctx = els.solidCanvas.getContext("2d");
    ctx.clearRect(0, 0, els.solidCanvas.width, els.solidCanvas.height);
    els.formulaOutput.innerHTML = `<div class="math-note">${escapeHtml(error.message)}</div><div class="math-note">${escapeHtml(error.examples || "Use formats like x^2, sqrt(x), sin(x), ln(x), |x|.")}</div>`;
    els.exactOutput.textContent = "No exact volume work can be shown until the input matches the FeatureScript constraints.";
  }
  if (!applyingTabSettings) renderTabs();
}

function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportSvg() {
  if (!lastState) return;
  const source = new XMLSerializer().serializeToString(els.regionSvg);
  download("cross-section-region.svg", source, "image/svg+xml");
}

function exportCsv() {
  if (!lastState) return;
  const rows = [
    ["index", "x", "upperY", "lowerY", "b(x)", "midY", "area_sq_in"],
    ...lastState.samples.map((p) => [p.index, p.x, p.upperY, p.lowerY, p.distance, p.midY, p.area])
  ];
  download("cross-section-points.csv", rows.map((row) => row.join(",")).join("\n"), "text/csv");
}

function exportJson() {
  if (!lastState) return;
  download("cross-section-settings.json", JSON.stringify({
    settings: lastState.settings,
    generatedSectionCount: lastState.samples.length,
    skippedSamples: lastState.skipped,
    browserEstimate: lastState.browserEstimate
  }, null, 2), "application/json");
}

function exportPng() {
  if (!lastState) return;
  els.solidCanvas.toBlob((blob) => download("cross-section-solid.png", blob, "image/png"));
}

function runAlgebraEngineTests() {
  const cases = [
    "y = x^2",
    "y = sqrt(1 - x^2)",
    "y = sin(x)",
    "y = ln(x)",
    "y = abs(x)",
    "y = |x|",
    "y = 1/x",
    "y = e^x",
    "y = arcsin(x)",
    "y = (x^2 + 1)/(x + 2)",
    "y = x³",
    "y = cbrt(x)",
    "y = log10(x)"
  ];
  const sampleX = 0.5;
  return cases.map((equation) => {
    try {
      const expression = buildMathExpression(equation, "upper");
      const value = expression.evaluate(sampleX);
      return {
        equation,
        normalized: expression.normalized,
        engine: expression.engine,
        parsed: true,
        evaluated: value.ok,
        value: value.ok ? value.value : null,
        reason: value.reason,
        tex: expression.toTex()
      };
    } catch (error) {
      return { equation, parsed: false, evaluated: false, reason: error.message };
    }
  });
}

window.runAlgebraEngineTests = runAlgebraEngineTests;

function initializeTabs() {
  functionTabs = [{
    id: activeTabId,
    settings: settingsFromDom()
  }];
  renderTabs();
}

initializeTabs();

document.querySelectorAll("input, select").forEach((input) => {
  input.addEventListener("input", () => {
    render();
  });
  input.addEventListener("change", () => {
    render();
  });
});
window.addEventListener("resize", render);
window.addEventListener("load", () => {
  if (lastState) updateFormula(lastState);
  window.__algebraEngineTests = runAlgebraEngineTests();
});
els.exportSvg.addEventListener("click", exportSvg);
els.exportCsv.addEventListener("click", exportCsv);
els.exportJson.addEventListener("click", exportJson);
els.exportPng.addEventListener("click", exportPng);
els.zoomIn.addEventListener("click", () => zoomGraph(0.72));
els.zoomOut.addEventListener("click", () => zoomGraph(1.38));
els.zoomReset.addEventListener("click", resetGraphZoom);
els.solidHome.addEventListener("click", resetSolidView);
els.addTabButton.addEventListener("click", addFunctionTab);
els.orientationToggle.addEventListener("click", toggleEquationOrientation);
els.regionSvg.addEventListener("wheel", (event) => {
  if (!lastState || !graphViewport) return;
  event.preventDefault();
  const rect = els.regionSvg.getBoundingClientRect();
  const plot = graphPlotRect(rect.width, rect.height);
  const px = Math.min(plot.right, Math.max(plot.left, event.clientX - rect.left));
  const py = Math.min(plot.bottom, Math.max(plot.top, event.clientY - rect.top));
  const anchor = {
    x: graphViewport.minX + ((px - plot.left) / (plot.right - plot.left)) * (graphViewport.maxX - graphViewport.minX),
    y: graphViewport.maxY - ((py - plot.top) / (plot.bottom - plot.top)) * (graphViewport.maxY - graphViewport.minY)
  };
  zoomGraph(event.deltaY < 0 ? 0.86 : 1.16, anchor);
}, { passive: false });
els.regionSvg.addEventListener("pointerdown", (event) => {
  if (!lastState || !graphViewport) return;
  graphDrag = { x: event.clientX, y: event.clientY };
  els.regionSvg.classList.add("dragging");
  els.regionSvg.setPointerCapture?.(event.pointerId);
});
els.regionSvg.addEventListener("pointermove", (event) => {
  if (!graphDrag) return;
  const dx = event.clientX - graphDrag.x;
  const dy = event.clientY - graphDrag.y;
  graphDrag = { x: event.clientX, y: event.clientY };
  panGraphByPixels(dx, dy, els.regionSvg.getBoundingClientRect());
});
els.regionSvg.addEventListener("pointerup", (event) => {
  graphDrag = null;
  els.regionSvg.classList.remove("dragging");
  els.regionSvg.releasePointerCapture?.(event.pointerId);
});
els.regionSvg.addEventListener("pointercancel", () => {
  graphDrag = null;
  els.regionSvg.classList.remove("dragging");
});
els.solidCanvas.addEventListener("pointerdown", (event) => {
  if (!lastState) return;
  solidDrag = { x: event.clientX, y: event.clientY };
  els.solidCanvas.classList.add("dragging");
  els.solidCanvas.setPointerCapture?.(event.pointerId);
});
els.solidCanvas.addEventListener("pointermove", (event) => {
  if (!solidDrag || !lastState) return;
  const dx = event.clientX - solidDrag.x;
  const dy = event.clientY - solidDrag.y;
  solidDrag = { x: event.clientX, y: event.clientY };
  if (event.shiftKey) {
    solidView.panX += dx;
    solidView.panY += dy;
  } else {
    solidView.rotY += dx * 0.01;
    solidView.rotX += dy * 0.01;
    solidView.rotX = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, solidView.rotX));
  }
  drawSolid(lastState);
});
els.solidCanvas.addEventListener("pointerup", (event) => {
  solidDrag = null;
  els.solidCanvas.classList.remove("dragging");
  els.solidCanvas.releasePointerCapture?.(event.pointerId);
});
els.solidCanvas.addEventListener("pointercancel", () => {
  solidDrag = null;
  els.solidCanvas.classList.remove("dragging");
});
els.solidCanvas.addEventListener("wheel", (event) => {
  if (!lastState) return;
  event.preventDefault();
  solidView.zoom *= event.deltaY < 0 ? 1.08 : 0.92;
  solidView.zoom = Math.max(0.25, Math.min(5, solidView.zoom));
  drawSolid(lastState);
}, { passive: false });

render();
