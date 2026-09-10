export function parseJson(text) {
  const parser = new JsonParser(text);
  const result = parser.read(0); parser.space();
  if (parser.cursor !== text.length) parser.fail();
  return result;
}

const MAX_DEPTH = 64;
class JsonParser {
  constructor(text) { this.text = text; this.cursor = 0; }
  space() { while (/\s/.test(this.text[this.cursor] ?? "")) this.cursor++; }
  fail() { throw new Error("JSON 格式无效或存在重复字段"); }
  string() {
    const start = this.cursor++;
    while (this.cursor < this.text.length) {
      const char = this.text[this.cursor++];
      if (char === "\\") this.cursor++;
      else if (char === '"') return JSON.parse(this.text.slice(start, this.cursor));
    }
    return this.fail();
  }
  collection(depth, object) {
    this.cursor++;
    const result = object ? Object.create(null) : [];
    const end = object ? "}" : "]";
    this.space();
    if (this.text[this.cursor] === end) { this.cursor++; return result; }
    while (this.cursor < this.text.length) {
      let key;
      if (object) key = this.objectKey(result);
      const value = this.read(depth + 1);
      if (object) result[key] = value;
      else result.push(value);
      this.space();
      const separator = this.text[this.cursor++];
      if (separator === end) return result;
      if (separator !== ",") return this.fail();
      this.space();
    }
    return this.fail();
  }
  objectKey(result) {
    if (this.text[this.cursor] !== '"') return this.fail();
    const key = this.string(); this.space();
    if (Object.hasOwn(result, key) || this.text[this.cursor++] !== ":") return this.fail();
    return key;
  }
  read(depth) {
    if (depth > MAX_DEPTH) return this.fail();
    this.space();
    const char = this.text[this.cursor];
    if (char === '"') return this.string();
    if (char === "{" || char === "[") return this.collection(depth, char === "{");
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(this.text.slice(this.cursor));
    if (!token) return this.fail();
    this.cursor += token[0].length;
    return JSON.parse(token[0]);
  }
}
