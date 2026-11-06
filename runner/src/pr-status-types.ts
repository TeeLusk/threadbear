// Pull request status (docs/protocol.md, "Pull request status"): what the
// runner knows of a thread's GitHub PRs. The same shapes are in the protocol.

export type PrState = 'open' | 'draft' | 'merged' | 'closed';
export type PrOutcome = 'passed' | 'failed' | 'running' | 'skipped';
export type PrCheck = { name: string; workflow?: string; outcome: PrOutcome; url?: string; seconds?: number };
export type PrReview = { author: string; state: 'approved' | 'changes' | 'commented' };
export type ThreadPr = {
  url: string;
  repo: string;
  number: number;
  title: string;
  state: PrState;
  checks?: { state: 'passing' | 'failing' | 'running' | 'none'; passed: number; total: number }; // total leaves out skipped
  review?: { decision: 'approved' | 'changes' | 'waiting' | 'none'; approvals: number; required?: number };
  conflicts?: true;
  checkedAt?: string;
};
export type PrDetail = ThreadPr & { headRef: string; baseRef: string; checkList: PrCheck[]; reviews: PrReview[]; requested: string[] };
export type TrackedPr = { url: string; repo: string; number: number; how: 'created' | 'pushed' | 'pinned'; addedAt: string; snapshot?: PrDetail; final?: true };
