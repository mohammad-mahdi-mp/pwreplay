// لکسر Pine Script — با پشتیبانی از تورفتگی برای بلوک‌ها

const KEYWORDS = new Set(['if', 'else', 'for', 'var', 'varip', 'to', 'by', 'and', 'or', 'not', 'true', 'false', 'na']);

export function lex (src) {
  const tokens = [];
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const indentStack = [0];
  let parenDepth = 0;

  const pushParen = (ch) => {
    if (ch === '(' || ch === '[') parenDepth++;
    else if (ch === ')' || ch === ']') parenDepth = Math.max(0, parenDepth - 1);
  };

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    let line = lines[lineNo].replace(/\t/g, '    ');
    const lineNum = lineNo + 1;

    const commentIdx = findCommentIdx(line);
    if (commentIdx >= 0) line = line.slice(0, commentIdx);
    if (!line.trim()) continue;

    if (parenDepth === 0) {
      const indent = line.match(/^ */)[0].length;
      if (indent > indentStack[indentStack.length - 1]) {
        indentStack.push(indent);
        tokens.push({ type: 'INDENT', line: lineNum });
      } else {
        while (indent < indentStack[indentStack.length - 1]) {
          indentStack.pop();
          tokens.push({ type: 'DEDENT', line: lineNum });
        }
        if (indent !== indentStack[indentStack.length - 1]) {
          throw new Error(`خط ${lineNum}: تورفتگی نامعتبر است`);
        }
      }
      tokens.push({ type: 'NL', line: lineNum });
    }
    // در ادامه پرانتزی، بدون NL و INDENT

    lexLine(line.trimEnd(), lineNum, tokens, pushParen);
  }

  const lastLine = lines.length;
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: 'DEDENT', line: lastLine });
  }
  tokens.push({ type: 'EOF', line: lastLine });
  return tokens;
}

function findCommentIdx (line) {
  let inQ = false, q = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === q && line[i - 1] !== '\\') inQ = false;
    } else if (ch === '"' || ch === "'") {
      inQ = true; q = ch;
    } else if (ch === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}

function lexLine (line, lineNum, tokens, pushParen) {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ') { i++; continue; }

    // عدد
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] || ''))) {
      let j = i;
      while (j < line.length && /[0-9._]/.test(line[j])) j++;
      if (line[j] === 'e' || line[j] === 'E') {
        j++;
        if (line[j] === '+' || line[j] === '-') j++;
        while (j < line.length && /[0-9]/.test(line[j])) j++;
      }
      const raw = line.slice(i, j).replace(/_/g, '');
      tokens.push({ type: 'NUM', value: Number(raw), line: lineNum });
      i = j;
      continue;
    }

    // رشته
    if (ch === '"' || ch === "'") {
      let j = i + 1, out = '';
      while (j < line.length && line[j] !== ch) {
        if (line[j] === '\\' && j + 1 < line.length) {
          const nx = line[j + 1];
          out += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
          j += 2;
        } else { out += line[j]; j++; }
      }
      if (j >= line.length) throw new Error(`رشته بسته نشده`);
      tokens.push({ type: 'STR', value: out, line: lineNum });
      i = j + 1;
      continue;
    }

    // رنگ #RGB
    if (ch === '#') {
      let j = i + 1;
      while (j < line.length && /[0-9a-fA-F]/.test(line[j])) j++;
      const hex = line.slice(i + 1, j);
      if (![3, 4, 6, 8].includes(hex.length)) throw new Error(`کد رنگ نامعتبر #${hex}`);
      tokens.push({ type: 'COLOR', value: '#' + hex, line: lineNum });
      i = j;
      continue;
    }

    // شناسه (تا نقطه به‌عنوان دسترسی عضو)
    if (/[a-zA-Z_\u0600-\u06FF]/.test(ch)) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_\u0600-\u06FF]/.test(line[j])) j++;
      const value = line.slice(i, j);
      tokens.push({ type: KEYWORDS.has(value) ? 'KW' : 'ID', value, line: lineNum });
      i = j;
      continue;
    }

    // اپراتورها
    const two = line.slice(i, i + 2);
    if (['=>', '==', '!=', '<=', '>=', ':='].includes(two)) {
      tokens.push({ type: 'OP', value: two, line: lineNum });
      i += 2;
      continue;
    }
    if ('+-*/%()[]<>=?:,.'.includes(ch)) {
      tokens.push({ type: 'OP', value: ch, line: lineNum });
      pushParen(ch);
      i++;
      continue;
    }
    throw new Error(`کاراکتر ناشناخته «${ch}»`);
  }
}
