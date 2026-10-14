export function parseJSON(text: string): unknown {
  let safe = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index++] === '"') break;
      }
      safe += text.slice(start, index);
    } else if (char === '-' || /\d/.test(char)) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index))?.[0];
      if (!token) {
        safe += char;
        index++;
        continue;
      }
      const unsafe =
        /^-?\d+$/.test(token) &&
        (BigInt(token) > BigInt(Number.MAX_SAFE_INTEGER) ||
          BigInt(token) < BigInt(Number.MIN_SAFE_INTEGER));
      safe += unsafe ? JSON.stringify(token) : token;
      index += token.length;
    } else {
      safe += char;
      index++;
    }
  }
  const decoded: unknown = JSON.parse(safe);
  return decoded;
}
