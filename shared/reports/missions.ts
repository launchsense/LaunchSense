// Serial missions for Phase 1. One at a time, in order. Completion is
// verified from actual scan state, never self-declared. No points, no
// leaderboards, no rewards.

export interface MissionFacts {
  scanRan: boolean;
  analyzed: boolean;
  highSecrets: number;
  highOpen: number;
  hasReadme: boolean;
  hasTests: boolean;
  rescanRan: boolean;
  passportIssued: boolean;
  shareCreated: boolean;
  shareViewed: boolean;
  liveOk: boolean | null;
}

export interface Mission {
  id: string;
  order: number;
  title: string;
  plain: string;
  done: boolean;
  blocked: string | null;
}

export interface Achievement {
  id: string;
  title: string;
  plain: string;
  earned: boolean;
}

const SEQUENTIAL: Array<{ id: string; title: string; plain: string; done: (f: MissionFacts) => boolean }> = [
  {
    id: "first-scan",
    title: "First Scan",
    plain: "Paste a repo link and run your first scan.",
    done: (f) => f.scanRan,
  },
  {
    id: "secure-project",
    title: "Clear high severity secrets",
    plain: "Fix every high severity secret finding in the files we could read. Skipped files stay unchecked.",
    done: (f) => f.analyzed && f.highSecrets === 0,
  },
  {
    id: "understandable",
    title: "Make It Understandable",
    plain: "Add a README and some tests.",
    done: (f) => f.analyzed && f.hasReadme && f.hasTests,
  },
  {
    id: "judge-ready",
    title: "Make the Demo Ready to Share",
    // Gate on high findings only. Console noise is low severity and would
    // make this unreachable for a normal AI-built repo.
    plain: "Clear every high severity finding and confirm the live site loads.",
    done: (f) => f.analyzed && f.highOpen === 0 && f.liveOk === true,
  },
  {
    id: "rescan-compare",
    title: "Rescan and Compare",
    plain: "Re-scan after fixing and read the compare result.",
    done: (f) => f.rescanRan,
  },
  {
    id: "issue-passport",
    title: "Issue Passport",
    plain: "Create a Passport for your scan.",
    done: (f) => f.passportIssued,
  },
  {
    id: "safe-share",
    title: "Create a share link",
    plain: "Create a share link and confirm it opens.",
    done: (f) => f.shareCreated && f.shareViewed,
  },
];

export function buildMissions(facts: MissionFacts): {
  missions: Mission[];
  achievements: Achievement[];
  currentMissionId: string | null;
  progress: { done: number; total: number };
} {
  const missions: Mission[] = [];
  let unlocked = true;
  let currentMissionId: string | null = null;

  for (let i = 0; i < SEQUENTIAL.length; i++) {
    const spec = SEQUENTIAL[i];
    if (spec === undefined) continue;
    const done = unlocked && spec.done(facts);
    let blocked: string | null = null;
    if (!unlocked) {
      blocked = "Finish the previous mission first.";
    } else if (!done) {
      blocked = null;
    }
    if (!done && currentMissionId === null && unlocked) {
      currentMissionId = spec.id;
    }
    missions.push({ id: spec.id, order: i + 1, title: spec.title, plain: spec.plain, done, blocked });
    if (!done) unlocked = false;
  }

  const doneCount = missions.filter((m) => m.done).length;
  const achievements: Achievement[] = [
    {
      id: "first-report",
      title: "First Report",
      plain: "You produced a report with its not-checked list.",
      earned: missions[0]?.done === true,
    },
    {
      id: "no-leaks",
      title: "No Leaks",
      plain: "Zero high severity secret findings.",
      earned: facts.analyzed && facts.highSecrets === 0,
    },
    {
      id: "clean-compare",
      title: "Rescan compared",
      plain: "Your rescan compared two commits with no high findings still open. Unknown items stay unknown.",
      earned: facts.rescanRan && facts.highOpen === 0,
    },
    {
      id: "shared-safely",
      title: "Share link opened",
      plain: "You created a share link and confirmed it opens. This does not mean the repo is safe to share.",
      earned: facts.shareCreated,
    },
    {
      id: "judge-ready",
      title: "Blockers reviewed",
      plain: "No shared scan was blocked in the files we could read.",
      earned: missions[3]?.done === true,
    },
    {
      id: "all-missions",
      title: "Full Sweep",
      plain: "Every mission finished.",
      earned: doneCount === SEQUENTIAL.length,
    },
  ];

  return {
    missions,
    achievements,
    currentMissionId,
    progress: { done: doneCount, total: SEQUENTIAL.length },
  };
}

