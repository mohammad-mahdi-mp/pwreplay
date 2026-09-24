// پارسر Pine Script → AST

export function parse (tokens) {
  let pos = 0;
  const peek = (k = 0) => tokens[pos + k] || tokens[tokens.length - 1];
  const next = () => tokens[pos++];
  const isOp = (v, k = 0) => peek(k).type === 'OP' && peek(k).value === v;
  const isKw = (v, k = 0) => peek(k).type === 'KW' && peek(k).value === v;
  const isType = (t, k = 0) => peek(k).type === t;

  const skipNl = () => { while (isType('NL')) next(); };
  const expectOp = (v) => {
    if (!isOp(v)) err(`انتظار «${v}» داشتیم`);
    next();
  };
  const err = (msg) => {
    const t = peek();
    throw new Error(`خط ${t.line || '?'}: ${msg}`);
  };

  // ---------- عبارات ----------
  function parseExpr () { return parseTernary(); }

  function parseTernary () {
    const cond = parseOr();
    if (isOp('?')) {
      const line = peek().line;
      next();
      const a = parseTernary();
      expectOp(':');
      const b = parseTernary();
      return { kind: 'Ternary', cond, a, b, line };
    }
    return cond;
  }

  function parseOr () {
    let l = parseAnd();
    while (isKw('or')) {
      const line = peek().line; next();
      l = { kind: 'Binary', op: 'or', l, r: parseAnd(), line };
    }
    return l;
  }

  function parseAnd () {
    let l = parseNot();
    while (isKw('and')) {
      const line = peek().line; next();
      l = { kind: 'Binary', op: 'and', l, r: parseNot(), line };
    }
    return l;
  }

  function parseNot () {
    if (isKw('not')) {
      const line = peek().line; next();
      return { kind: 'Unary', op: 'not', expr: parseNot(), line };
    }
    return parseCompare();
  }

  function parseCompare () {
    let l = parseAdd();
    while (isOp('==') || isOp('!=') || isOp('<') || isOp('<=') || isOp('>') || isOp('>=')) {
      const op = next();
      l = { kind: 'Binary', op: op.value, l, r: parseAdd(), line: op.line };
    }
    return l;
  }

  function parseAdd () {
    let l = parseMul();
    while (isOp('+') || isOp('-')) {
      const op = next();
      l = { kind: 'Binary', op: op.value, l, r: parseMul(), line: op.line };
    }
    return l;
  }

  function parseMul () {
    let l = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = next();
      l = { kind: 'Binary', op: op.value, l, r: parseUnary(), line: op.line };
    }
    return l;
  }

  function parseUnary () {
    if (isOp('-')) {
      const line = peek().line; next();
      return { kind: 'Unary', op: '-', expr: parseUnary(), line };
    }
    if (isOp('+')) { next(); return parseUnary(); }
    return parsePostfix();
  }

  function parsePostfix () {
    let e = parsePrimary();
    for (;;) {
      if (isOp('[')) {
        const line = peek().line;
        next();
        const offset = parseExpr();
        expectOp(']');
        e = { kind: 'Index', expr: e, offset, line };
      } else if (isOp('(') && (e.kind === 'Member' || e.kind === 'Id')) {
        e = parseCall(e);
      } else break;
    }
    return e;
  }

  function parseCall (callee) {
    const line = peek().line;
    next(); // (
    const ns = callee.kind === 'Member' ? callee.obj.name : null;
    const name = callee.kind === 'Member' ? callee.name : callee.name;
    const args = [];
    while (!isOp(')')) {
      skipNl();
      // آرگومان اسمی
      if (isType('ID') && isOp('=', 1)) {
        const argName = next().value;
        next(); // =
        args.push({ name: argName, value: parseExpr() });
      } else {
        args.push({ name: null, value: parseExpr() });
      }
      skipNl();
      if (isOp(',')) next();
      else break;
    }
    expectOp(')');
    return { kind: 'Call', ns, name, args, line };
  }

  function parsePrimary () {
    const t = peek();
    if (t.type === 'NUM') { next(); return { kind: 'Num', value: t.value, line: t.line }; }
    if (t.type === 'STR') { next(); return { kind: 'Str', value: t.value, line: t.line }; }
    if (t.type === 'COLOR') { next(); return { kind: 'Color', value: t.value, line: t.line }; }
    if (isKw('true')) { next(); return { kind: 'Bool', value: true, line: t.line }; }
    if (isKw('false')) { next(); return { kind: 'Bool', value: false, line: t.line }; }
    if (isKw('na')) { next(); return { kind: 'Na', line: t.line }; }
    if (isOp('(')) {
      next();
      const e = parseExpr();
      expectOp(')');
      return e;
    }
    if (isKw('if')) {
      return parseIfExpr();
    }
    if (t.type === 'ID') {
      next();
      // دسترسی عضو: ta.sma / color.red / input.int
      if (isOp('.') && isType('ID', 1)) {
        next();
        const name = next();
        return { kind: 'Member', obj: { kind: 'Id', name: t.value, line: t.line }, name: name.value, line: t.line };
      }
      return { kind: 'Id', name: t.value, line: t.line };
    }
    err(`عبارت نامعتبر «${t.value ?? t.type}»`);
  }

  // if به‌عنوان عبارت:  x = if cond \n expr \n else \n expr
  function parseIfExpr () {
    const lineT = peek(); next(); // if
    const cond = parseOr();
    skipNl();
    if (!isType('INDENT')) err('بعد از if بلوک با تورفتگی لازم است');
    next();
    skipNl();
    const thenExpr = parseExpr();
    skipNl();
    let elseExpr = null;
    if (isType('DEDENT')) {
      next();
      if (isKw('else')) {
        next();
        skipNl();
        if (isKw('if')) {
          elseExpr = parseIfExpr();
        } else {
          if (!isType('INDENT')) err('بعد از else بلوک با تورفتگی لازم است');
          next();
          skipNl();
          elseExpr = parseExpr();
          skipNl();
          if (isType('DEDENT')) next();
        }
      }
    }
    return { kind: 'IfExpr', cond, then: thenExpr, else: elseExpr, line: lineT.line };
  }

  // ---------- دستورات ----------

  function parseBlock () {
    skipNl();
    if (!isType('INDENT')) err('بلوک با تورفتگی لازم است');
    next();
    const stmts = [];
    skipNl();
    while (!isType('DEDENT') && !isType('EOF')) {
      stmts.push(parseStatement());
      skipNl();
    }
    if (isType('DEDENT')) next();
    return stmts;
  }

  function parseIfStatement () {
    const lineT = peek(); next(); // if
    const cond = parseOr();
    const then = parseBlock();
    let elseB = null;
    skipNl();
    if (isKw('else')) {
      next();
      skipNl();
      if (isKw('if')) {
        elseB = [parseIfStatement()];
      } else {
        elseB = parseBlock();
      }
    }
    return { kind: 'IfStmt', cond, then, else: elseB, line: lineT.line };
  }

  function parseForStatement () {
    const lineT = peek(); next(); // for
    const varTok = peek();
    if (varTok.type !== 'ID') err('بعد از for نام متغیر لازم است');
    next();
    expectOp('=');
    const from = parseExpr();
    if (!isKw('to')) err('انتظار «to» داشتیم');
    next();
    const to = parseExpr();
    let step = null;
    if (isKw('by')) { next(); step = parseExpr(); }
    const body = parseBlock();
    return { kind: 'ForStmt', var: varTok.value, from, to, step, body, line: lineT.line };
  }

  function parseStatement () {
    const t = peek();

    // انتساب چندتایی: [a, b, c] = ta.macd(...)
    if (t.type === 'OP' && t.value === '[') {
      next();
      const targets = [];
      while (!isOp(']')) {
        if (isType('ID')) targets.push(next().value);
        else err('در انتساب چندتایی نام متغیر لازم است');
        if (isOp(',')) next();
      }
      next(); // ]
      expectOp('=');
      const expr = parseExpr();
      return { kind: 'TupleAssign', targets, expr, line: t.line };
    }

    if (isKw('import') || isKw('export') || isKw('library')) {
      err('«import/export/library» پشتیبانی نمی‌شود — کل کد را در یک اسکریپت بنویسید');
    }

    if (isKw('var') || isKw('varip')) {
      next();
      if (isType('ID') && isOp('=', 1)) {
        const name = next().value;
        next(); // =
        const expr = parseExpr();
        return { kind: 'Assign', target: name, op: '=', isVar: true, expr, line: t.line };
      }
      // var با نوع صریح مثل var float x = ...
      if (isType('ID') && isType('ID', 1) && isOp('=', 2)) {
        next(); // نوع (float/int/...)
        const name = next().value;
        next(); // =
        const expr = parseExpr();
        return { kind: 'Assign', target: name, op: '=', isVar: true, expr, line: t.line };
      }
      err('بعد از var انتساب نامعتبر است');
    }

    if (isKw('if')) return parseIfStatement();
    if (isKw('for')) return parseForStatement();

    if (t.type === 'ID') {
      // تعریف تابع:  f(a, b) => expr
      if (isOp('(', 1)) {
        // تابع یا فراخوانی؟ بعد از بستن پرانتز باید => بیاید تا تعریف باشد
        let k = 2, depth = 1;
        while (depth > 0 && tokens[pos + k] && tokens[pos + k].type !== 'EOF') {
          if (tokens[pos + k].type === 'OP' && tokens[pos + k].value === '(') depth++;
          if (tokens[pos + k].type === 'OP' && tokens[pos + k].value === ')') depth--;
          k++;
        }
        if (depth === 0 && tokens[pos + k] && tokens[pos + k].type === 'OP' && tokens[pos + k].value === '=>') {
          const name = next().value;
          next(); // (
          const params = [];
          while (!isOp(')')) {
            if (isType('ID')) params.push(next().value);
            else err('پارامتر تابع نامعتبر است');
            if (isOp(',')) next();
          }
          next(); // )
          expectOp('=>');
          const body = parseExpr();
          return { kind: 'FnDef', name, params, body, line: t.line };
        }
      }

      // انتساب
      if (isOp('=', 1) || isOp(':=', 1)) {
        const name = next().value;
        const op = next().value;
        const expr = parseExpr();
        return { kind: 'Assign', target: name, op, isVar: false, expr, line: t.line };
      }
    }

    const expr = parseExpr();
    return { kind: 'ExprStmt', expr, line: t.line };
  }

  // ---------- برنامه ----------

  const body = [];
  skipNl();
  while (!isType('EOF')) {
    if (isType('NL') || isType('DEDENT')) { next(); continue; }
    if (isType('INDENT')) err('تورفتگی نامعتبر است — بلوک بدون if/else/for');
    body.push(parseStatement());
    skipNl();
  }
  return { kind: 'Program', body };
}
