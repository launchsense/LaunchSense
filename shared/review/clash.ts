// A small conservative clash table. A hit is a review signal, not a verdict.

export function clashSignal(projectTerms: string, dependencyTerms: string): string | null {
  const project = projectTerms.toUpperCase();
  const dependency = dependencyTerms.toUpperCase();
  const apache = dependency.includes("APACHE-2.0");
  const gpl2only = project.includes("GPL-2.0-ONLY") || project === "GPL-2.0";
  if (apache && gpl2only) {
    return "Project terms include GPL-2.0-only. This dependency declares Apache-2.0. Review the combination before a combined distribution. Signal, not legal advice.";
  }
  const projectApache = project.includes("APACHE-2.0");
  const depGpl2 = dependency.includes("GPL-2.0-ONLY");
  if (projectApache && depGpl2) {
    return "Project terms include Apache-2.0. This dependency declares GPL-2.0-only. Review the combination before a combined distribution. Signal, not legal advice.";
  }
  return null;
}
