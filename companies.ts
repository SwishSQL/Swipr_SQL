// Display-only grouping of raw company names into umbrella groups.
// This does NOT change stored company values (which drive manager scoping /
// approver matching) — it only affects how companies are shown and filtered.

export const COMPANY_GROUPS: Record<string, string[]> = {
  // Mishmash, FM and Swish are all part of the Swish Call Center.
  'Swish Call Center': ['swish', 'mishmash', 'fm'],
};

// Map a raw company name to its umbrella group, or itself if ungrouped.
export function companyGroup(name?: string): string {
  const n = (name || '').trim().toLowerCase();
  for (const [group, members] of Object.entries(COMPANY_GROUPS)) {
    if (members.includes(n)) return group;
  }
  return (name || '').trim() || '—';
}
