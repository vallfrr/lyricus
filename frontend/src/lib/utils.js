import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize a word for comparison:
 * - lowercase
 * - remove accents
 * - remove apostrophes and special chars
 * - keep only a-z and 0-9
 */
export function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // remove accents
    .replace(/['\u2019\u0060\u00b4\u2018]/g, "") // remove apostrophes
    .replace(/[^a-z0-9]/g, "");         // keep only alphanumeric
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: b.length + 1 }, (_, i) =>
    Array.from({ length: a.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Fuzzy match: exact after normalize, or levenshtein tolerance for longer words.
 * - 1-3 chars: exact only
 * - 4-6 chars: distance ≤ 1
 * - 7+ chars: distance ≤ 2
 */
export function fuzzyMatch(input, expected) {
  const a = normalize(input);
  const b = normalize(expected);
  if (!a || !b) return false;
  if (a === b) return true;

  const minLen = Math.min(a.length, b.length);
  if (minLen <= 3) return false; // short words: exact only
  const maxDist = minLen >= 7 ? 2 : 1;
  return levenshtein(a, b) <= maxDist;
}

/**
 * Extract all candidate words from a speech transcript.
 * Handles contractions by generating both merged and split forms.
 * e.g. "j'ai" → ["jai", "j", "ai"]
 *      "don't" → ["dont", "don", "t"]
 */
export function transcriptWords(transcript) {
  const words = transcript.trim().split(/\s+/);
  const candidates = new Set();
  for (const word of words) {
    const norm = normalize(word);
    if (norm) candidates.add(norm);
    // Also add parts split at apostrophe (for contractions)
    const parts = word.split(/['\u2019]/);
    if (parts.length > 1) {
      for (const part of parts) {
        const n = normalize(part);
        if (n) candidates.add(n);
      }
    }
  }
  return candidates;
}
