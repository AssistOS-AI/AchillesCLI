import { fail } from '../embeddings/config.mjs';

let detector;

// Loads the local n-gram language detector once; it runs offline and needs no model download.
async function load() {
  if (detector) return detector;
  try {
    const { eld } = await import('eld');
    await eld.load('medium');
    detector = eld;
  } catch (cause) {
    throw fail('DEPENDENCY_MISSING', `Language filtering requires eld 2.1.0. Restart the agent so its install step prepares it. ${cause.message}`);
  }
  return detector;
}

export const languageRules = Object.freeze({ minLetters: 30, englishShare: 0.9, minScriptLetters: 10, latinShare: 0.5 });

// Links, hashtags and mentions are not language evidence and mislead short-text detection.
const evidence = text => String(text ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\s*[\p{L}\p{N}_]+/gu, ' ')
  .replace(/\s+/g, ' ').trim();
const count = (text, pattern) => (text.match(pattern) ?? []).length;

// Returns '' (keep: English or undecided) or the code of another language. The rule prefers keeping an entry:
// short titles are often misread, so only text with enough letters, a reliable verdict and a clear margin over
// English is rejected. Text written mostly outside the Latin script is never English.
export async function detectLanguage(title, text) {
  const sample = evidence(`${title ?? ''} ${text ?? ''}`);
  const letters = count(sample, /\p{L}/gu);
  if (!letters) return '';
  const eld = await load();
  const result = eld.detect(sample);
  if (letters >= languageRules.minScriptLetters && count(sample, /\p{Script=Latin}/gu) / letters < languageRules.latinShare) {
    return result.language && result.language !== 'en' ? result.language : 'other';
  }
  if (letters < languageRules.minLetters || !result.language || result.language === 'en' || !result.isReliable()) return '';
  const scores = result.getScores();
  return (scores.en ?? 0) < languageRules.englishShare * scores[result.language] ? result.language : '';
}

export const rankedLanguages = Object.freeze(['en', '']);
