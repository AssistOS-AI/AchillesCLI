// Derives search terms and tags from a short topic description when the operator leaves them empty.
// The rule is local and deterministic; the operator can always replace its output.

const functionWords = new Set(`a an the of on in into for to from and or nor but with without about at by as via over under
  vs versus is are was were be been being do does did how what why when where which who whom whose this that these those
  my your our their its his her i you we they it me us them all any some each every no not new
  use uses used using based like such also more most than then other others own`.split(/\s+/));
// Words that describe the kind of post or a time rather than its subject.
const genericWords = new Set(`news latest recent update updates info information tips tip guide guides advice discussion
  discussions post posts article articles thread threads question questions help today week month year
  launch launches launched release releases released announcement announcements report reports`.split(/\s+/));
// Modifiers that make sense inside a search phrase but are useless as a tag on their own.
const modifiers = new Set(`mid low high small big large good better best cheap free simple easy great top full`.split(/\s+/));
const isYear = word => /^(19|20)\d\d$/.test(word);

export const deriveLimits = Object.freeze({ terms: 5, tags: 5 });

export function significantWords(label) {
  const words = String(label ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);
  return [...new Set(words.filter(word => !functionWords.has(word) && !genericWords.has(word) && !isYear(word)))];
}

// Splits words into consecutive phrases of two or three words, never leaving a single word alone.
function phrases(words) {
  if (words.length <= 3) return [words.join(' ')];
  const chunks = [];
  for (let i = 0; i < words.length; i += 2) chunks.push(words.slice(i, i + 2));
  if (chunks.at(-1).length === 1) chunks.at(-2).push(chunks.pop()[0]);
  return chunks.map(chunk => chunk.join(' '));
}

export function deriveFields(label) {
  const words = significantWords(label);
  if (!words.length) return { searchTerms: [], tags: [] };
  const searchTerms = phrases(words).slice(0, deriveLimits.terms);
  // Two-word phrases become compound tags (written per site as "linuxgaming" or "linux-gaming"), then single subjects.
  const compounds = searchTerms.filter(term => term.split(' ').length === 2);
  const singles = words.filter(word => !modifiers.has(word) && word.length > 1);
  const tags = [...new Set([...compounds, ...singles])].slice(0, deriveLimits.tags);
  return { searchTerms, tags };
}

// Stored lists win; an empty list means "derive from the description".
export function effectiveFields(topic) {
  const derived = deriveFields(topic.label);
  return {
    searchTerms: topic.search_terms.length ? topic.search_terms : derived.searchTerms.length ? derived.searchTerms : [topic.label],
    tags: topic.tags.length ? topic.tags : derived.tags,
    derivedTerms: !topic.search_terms.length, derivedTags: !topic.tags.length,
  };
}
