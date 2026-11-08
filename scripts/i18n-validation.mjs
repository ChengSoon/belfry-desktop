/** Complete sentences may end in a period/question mark; punctuation fragments may not. */
export function translationProblems(text) {
  const problems = [];
  if (text !== text.trim()) problems.push("leading/trailing whitespace");
  if (/^[，。、；：！？·]|[，、；：·]$/.test(text)) problems.push("punctuation fragment");
  if (/\{\{value\d+\}\}/.test(text)) problems.push("unnamed valueN parameter");
  return problems;
}

export function missingParameters(texts, provided, plural = false) {
  const required = new Set(texts.flatMap(text => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1])));
  if (plural) required.add("count");
  return [...required].filter(name => !provided.includes(name));
}
