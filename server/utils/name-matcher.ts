/**
 * Name Matching Utilities
 * 
 * Provides name similarity checking for patient identity verification
 */

/**
 * Normalize name for comparison (lowercase, trim, remove punctuation)
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"]/g, '') // Remove punctuation
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Split name into tokens (words)
 */
function tokenizeName(name: string): string[] {
  return normalizeName(name).split(/\s+/).filter(t => t.length > 0);
}

/**
 * Calculate name similarity score (0-1)
 * Returns 1.0 for exact match, lower for partial matches
 */
export function calculateNameSimilarity(name1: string, name2: string): number {
  const normalized1 = normalizeName(name1);
  const normalized2 = normalizeName(name2);
  
  // Exact match after normalization
  if (normalized1 === normalized2) {
    return 1.0;
  }
  
  const tokens1 = tokenizeName(name1);
  const tokens2 = tokenizeName(name2);
  
  // If one name is empty, no match
  if (tokens1.length === 0 || tokens2.length === 0) {
    return 0.0;
  }
  
  // Calculate token overlap
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  let matches = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      matches++;
    }
  }
  
  // Jaccard similarity: intersection / union
  const intersection = matches;
  const union = set1.size + set2.size - intersection;
  
  if (union === 0) return 0.0;
  
  return intersection / union;
}

/**
 * Check if names are significantly different (should trigger disambiguation)
 * Returns true if names are different enough to warrant asking for confirmation
 */
export function shouldDisambiguateName(existingName: string, newName: string): boolean {
  const similarity = calculateNameSimilarity(existingName, newName);
  
  // If similarity is below 0.5, names are significantly different
  // Also check if one name is much shorter (could be nickname vs full name)
  const tokens1 = tokenizeName(existingName);
  const tokens2 = tokenizeName(newName);
  const lengthRatio = Math.min(tokens1.length, tokens2.length) / Math.max(tokens1.length, tokens2.length);
  
  // If similarity is low OR one name is much shorter, disambiguate
  return similarity < 0.5 || (similarity < 0.8 && lengthRatio < 0.6);
}
