// Asks GitHub about pull requests through the user's own `gh` (docs/protocol.md,
// "Pull request status"). One GraphQL query covers a whole batch of PRs, so a
// poll costs one call however many threads have PRs. Threadbear keeps no token.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loginShell } from './system-tools.ts';
import type { Logger } from './log.ts';
import { parsePrUrl } from './pr-find.ts';
import type { PrCheck, PrDetail, PrOutcome, PrReview, ThreadPr } from './pr-status-types.ts';

const run = promisify(execFile);

export const BATCH = 25;

const FRAGMENT = `fragment F on PullRequest {
  title url state isDraft merged headRefName baseRefName mergeable reviewDecision
  latestReviews(first:20){nodes{author{login} state}}
  reviewRequests(first:10){nodes{requestedReviewer{... on User{login} ... on Team{name}}}}
  baseRef{branchProtectionRule{requiredApprovingReviewCount}}
  commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename
    ... on CheckRun{name status conclusion detailsUrl startedAt completedAt checkSuite{workflowRun{workflow{name}}}}
    ... on StatusContext{context state targetUrl}}}}}}}
}`;

export function buildQuery(prs: { owner: string; name: string; number: number }[]): string {
  const parts = prs.map(
    (p, i) => `p${i}: repository(owner:${JSON.stringify(p.owner)}, name:${JSON.stringify(p.name)}) { pullRequest(number: ${p.number}) { ...F } }`,
  );
  return `query { ${parts.join('\n')} }\n${FRAGMENT}`;
}

// GraphQL values are loosely typed on purpose: GitHub may add fields or states.
type Node = Record<string, any>;

// Same rules as the github-pr patch: unfinished is running, neutral is skipped.
export function outcomeOf(c: Node): PrOutcome {
  if (c.__typename === 'StatusContext') {
    if (c.state === 'SUCCESS') return 'passed';
    if (c.state === 'PENDING' || c.state === 'EXPECTED') return 'running';
    return 'failed';
  }
  if (c.status !== 'COMPLETED') return 'running';
  if (c.conclusion === 'SUCCESS') return 'passed';
  if (c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL') return 'skipped';
  return 'failed';
}

function seconds(c: Node): number | undefined {
  // GitHub uses year 0001 for "not finished".
  if (typeof c.startedAt !== 'string' || typeof c.completedAt !== 'string' || c.completedAt.startsWith('0001')) return undefined;
  const s = Math.round((Date.parse(c.completedAt) - Date.parse(c.startedAt)) / 1000);
  return s >= 0 ? s : undefined;
}

function checkOf(c: Node): PrCheck {
  const check: PrCheck = { name: String(c.name ?? c.context ?? 'Check'), outcome: outcomeOf(c) };
  const workflow = c.checkSuite?.workflowRun?.workflow?.name;
  if (typeof workflow === 'string' && workflow) check.workflow = workflow;
  const url = c.detailsUrl ?? c.targetUrl;
  // Only a web page: a check's link comes from whoever set up the check.
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) check.url = url;
  const s = seconds(c);
  if (s !== undefined) check.seconds = s;
  return check;
}

const REVIEW_STATE: Record<string, PrReview['state']> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes' };
const DECISION: Record<string, NonNullable<PrDetail['review']>['decision']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'waiting',
};

function detailOf(pr: Node, url: string, now: string): PrDetail {
  const state: PrDetail['state'] = pr.merged ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open';
  const checkList = ((pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []) as Node[]).filter(Boolean).map(checkOf);
  const reviews: PrReview[] = ((pr.latestReviews?.nodes ?? []) as Node[])
    .filter((r) => r?.author?.login)
    .map((r) => ({ author: String(r.author.login), state: REVIEW_STATE[r.state] ?? 'commented' }));
  const requested = ((pr.reviewRequests?.nodes ?? []) as Node[])
    .map((r) => r?.requestedReviewer?.login ?? r?.requestedReviewer?.name)
    .filter((n): n is string => typeof n === 'string');
  const parsed = parsePrUrl(url);
  const rule = pr.baseRef?.branchProtectionRule;
  const review: NonNullable<PrDetail['review']> = {
    decision: DECISION[pr.reviewDecision] ?? 'none',
    approvals: reviews.filter((r) => r.state === 'approved').length,
  };
  if (typeof rule?.requiredApprovingReviewCount === 'number') review.required = rule.requiredApprovingReviewCount;
  const d: PrDetail = {
    url,
    repo: parsed ? `${parsed.owner}/${parsed.name}` : '',
    number: parsed?.number ?? 0,
    title: String(pr.title ?? ''),
    state,
    review,
    checkedAt: now,
    headRef: String(pr.headRefName ?? ''),
    baseRef: String(pr.baseRefName ?? ''),
    checkList,
    reviews,
    requested,
  };
  if (pr.mergeable === 'CONFLICTING') d.conflicts = true;
  d.checks = checksOf(checkList);
  return d;
}

function checksOf(list: PrCheck[]): NonNullable<ThreadPr['checks']> {
  const counted = list.filter((c) => c.outcome !== 'skipped');
  const passed = counted.filter((c) => c.outcome === 'passed').length;
  const has = (o: PrOutcome) => counted.some((c) => c.outcome === o);
  const state = has('failed') ? 'failing' : has('running') ? 'running' : passed > 0 ? 'passing' : 'none';
  return { state, passed, total: counted.length };
}

// What the app and the thread summary carry: the detail without its lists.
export function toThreadPr(d: PrDetail): ThreadPr {
  const { headRef: _h, baseRef: _b, checkList, reviews: _r, requested: _q, ...pr } = d;
  return { ...pr, checks: checksOf(checkList) };
}

// `asked[i]` is the PR behind alias p<i>. A null or missing one is left out,
// so the caller keeps that PR's last snapshot.
export function parseAnswer(json: unknown, asked: { url: string }[], now: string): Map<string, PrDetail> {
  const out = new Map<string, PrDetail>();
  const data = (json as Node | null)?.data;
  if (!data || typeof data !== 'object') return out;
  asked.forEach((a, i) => {
    const pr = data[`p${i}`]?.pullRequest;
    if (pr && typeof pr === 'object') out.set(a.url, detailOf(pr, a.url, now));
  });
  return out;
}

// Branch names come from command text and tool output, so only a plain ref
// name goes to gh: nothing that starts with "-" (a flag) or holds "..".
export function isSafeBranch(branch: string): boolean {
  return /^(?!-)[A-Za-z0-9._\/-]+$/.test(branch) && !branch.includes('..');
}

export type Gh = {
  graphql(query: string): Promise<unknown>;
  prForBranch(cwd: string, branch?: string): Promise<string | undefined>;
};

// Finds `gh` the way a terminal would (the runner's own PATH is short), once.
// Undefined when it's missing or not logged in: the feature is then off.
export async function ghFromLoginShell(log: Logger): Promise<Gh | undefined> {
  let bin: string;
  try {
    const [shell, ...flags] = loginShell();
    const { stdout } = await run(shell!, [...flags, 'command -v gh'], { timeout: 10_000 });
    bin = stdout.trim().split('\n').pop() ?? '';
    if (!bin) throw new Error('empty');
  } catch {
    log.info('pr status: gh not found, PR status is off');
    return undefined;
  }
  try {
    await run(bin, ['auth', 'status'], { timeout: 10_000 });
  } catch {
    log.info('pr status: gh is not logged in, PR status is off');
    return undefined;
  }
  return {
    async graphql(query) {
      let stdout: string;
      try {
        ({ stdout } = await run(bin, ['api', 'graphql', '-f', `query=${query}`], { timeout: 20_000, maxBuffer: 20 * 1024 * 1024 }));
      } catch (e) {
        // gh exits non-zero when the answer carries errors, but still prints it.
        stdout = (e as { stdout?: string }).stdout ?? '';
        if (!stdout) throw e;
      }
      const json = JSON.parse(stdout);
      if (!json || typeof json !== 'object' || !('data' in json) || !json.data) throw new Error('gh returned no data');
      return json;
    },
    async prForBranch(cwd, branch) {
      if (branch !== undefined && !isSafeBranch(branch)) return undefined;
      try {
        // gh reads everything after "--" as arguments, so the flags go first.
        const { stdout } = await run(bin, ['pr', 'view', '--json', 'url,state', ...(branch ? ['--', branch] : [])], { cwd, timeout: 20_000 });
        const pr = JSON.parse(stdout);
        return pr?.state === 'OPEN' && typeof pr.url === 'string' ? pr.url : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
