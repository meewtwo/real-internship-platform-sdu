/**
 * Skill relationships used for PARTIAL credit in matching: a student who knows Vue.js is not a stranger to React,
 * and PostgreSQL implies most of SQL. Partial credit is always < 1 so a related skill never counts as "matched";
 * the skill stays in `missingSkills` (and in learning recommendations) and is additionally reported in `partialSkills`.
 * Keys are lower-cased skill names from the vocabulary (database/migrations/002_skills_vocabulary.sql).
 */
export const CLUSTER_CREDIT = 0.5;
export const IMPLIES_CREDIT = 0.85;

/** Skills in one cluster give each other CLUSTER_CREDIT. */
export const SKILL_CLUSTERS: readonly (readonly string[])[] = [
  ['react', 'vue.js', 'angular'],
  ['javascript', 'typescript'],
  ['node.js', 'express'],
  ['django', 'flask'],
  ['sql', 'postgresql', 'mysql'],
  ['mongodb', 'redis'],
  ['aws', 'azure', 'google cloud'],
  ['machine learning', 'deep learning', 'tensorflow', 'pytorch'],
  ['data analysis', 'pandas', 'numpy', 'statistics'],
  ['power bi', 'tableau', 'excel'],
  ['docker', 'kubernetes'],
  ['cybersecurity', 'penetration testing', 'network security', 'cryptography'],
  ['agile', 'scrum', 'project management', 'product management'],
  ['marketing', 'smm', 'seo', 'copywriting', 'content creation'],
  ['financial analysis', 'accounting', 'banking', 'economics'],
  ['java', 'kotlin', 'spring boot'],
  ['c++', 'rust', 'go'],
  ['figma', 'ui/ux design'],
  ['law', 'contract law'],
  ['management', 'leadership', 'project management'],
  ['html', 'css', 'tailwind css'],
  ['research', 'academic writing'],
];

/** Directed: owning the key gives IMPLIES_CREDIT for each listed skill. */
export const SKILL_IMPLIES: Readonly<Record<string, readonly string[]>> = {
  postgresql: ['sql'], mysql: ['sql'], pandas: ['data analysis', 'python'], numpy: ['python'], tensorflow: ['machine learning', 'deep learning', 'python'],
  pytorch: ['machine learning', 'deep learning', 'python'], 'deep learning': ['machine learning'], django: ['python'], flask: ['python'],
  express: ['node.js', 'javascript'], 'node.js': ['javascript'], react: ['javascript'], 'vue.js': ['javascript'], angular: ['typescript', 'javascript'],
  typescript: ['javascript'], 'spring boot': ['java'], 'tailwind css': ['css'], kubernetes: ['docker'], 'penetration testing': ['cybersecurity'],
  'network security': ['cybersecurity'], scrum: ['agile'], 'contract law': ['law'],
};

const clusterIndex = new Map<string, Set<string>>();
for (const cl of SKILL_CLUSTERS) for (const s of cl) { const set = clusterIndex.get(s) ?? new Set<string>(); for (const o of cl) if (o !== s) set.add(o); clusterIndex.set(s, set); }

export interface PartialSkill { skill: string; via: string; credit: number }

/**
 * Best partial credit for `required` (already lower-cased) given the lower-cased skills the student `have`.
 * Returns null when nothing related is owned. Deterministic: ties are broken alphabetically by the owned skill.
 */
export function partialCredit(required: string, have: ReadonlySet<string>): { via: string; credit: number } | null {
  let best: { via: string; credit: number } | null = null;
  const consider = (via: string, credit: number) => {
    if (!best || credit > best.credit || (credit === best.credit && via < best.via)) best = { via, credit };
  };
  for (const h of have) {
    if (h === required) continue;
    if (SKILL_IMPLIES[h]?.includes(required)) consider(h, IMPLIES_CREDIT);
    else if (clusterIndex.get(required)?.has(h)) consider(h, CLUSTER_CREDIT);
  }
  return best;
}
