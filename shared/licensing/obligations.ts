// What a licence requires, per SPDX family.
//
// This is a small cited table, not a legal engine. It says what a licence text
// asks for, in the words of that text, and it stops there. It does not decide
// whether an obligation applies to how you ship, it does not model linking,
// aggregation, or the patent position, and it does not model the distribution
// channel. Three of those four inputs are facts about what you did, not about
// the licence, so any table of ids alone is incomplete and says so.
//
// Every row carries the clause it came from. A row with no citation is a row
// nobody checked, so there are no uncited rows.

import { UNKNOWN_LICENSE } from "./spdx.ts";

/**
 * Stated once, and kept in the artifact this table produces, so a reader never
 * has to guess what kind of thing they are looking at.
 */
export const OBLIGATION_TABLE_NOTE =
  "This table says what a licence text asks for. It is not legal advice and it is not a " +
  "compatibility answer. Whether an obligation applies to how you ship it is a question for a person.";

export type LicenseFamily =
  | "permissive"
  | "file-copyleft"
  | "library-copyleft"
  | "strong-copyleft"
  | "source-available"
  | "public-domain"
  | "proprietary"
  | "unknown";

export interface LicenseObligation {
  /** The id this row is written for. */
  id: string;
  family: LicenseFamily;
  /** Ship a copy of the licence text. */
  requiresLicenseText: boolean;
  /** Keep the copyright notice with every copy. */
  requiresCopyrightNotice: boolean;
  /** Ship a NOTICE file, where the licence has that concept. */
  requiresNoticeFile: boolean;
  /** Say that you changed the files. */
  requiresStateOfChanges: boolean;
  /** Source disclosure for the covered code. */
  requiresSourceDisclosure: boolean;
  /** Whether this licence's terms collide with a strong copyleft work. */
  requiresDistributionReview: boolean;
  /** What to do, in plain words. */
  notices: string[];
  /** The clause the row came from. */
  cite: string;
}

function row(entry: LicenseObligation): LicenseObligation {
  return entry;
}

const TABLE: LicenseObligation[] = [
  row({
    id: "MIT",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: [
      "Ship the copyright line and the permission notice with every copy or substantial portion.",
    ],
    cite: "MIT text: 'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.'",
  }),
  row({
    id: "ISC",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: [
      "Ship the copyright notice and the permission notice in every copy.",
    ],
    cite: "ISC text: 'Provided that the above copyright notice and this permission notice appear in all copies.'",
  }),
  row({
    id: "BSD-2-Clause",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: [
      "Reproduce the copyright notice, the conditions and the disclaimer, in the docs or other materials you ship.",
    ],
    cite: "BSD-2-Clause clause 2: binary redistributions must 'reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.'",
  }),
  row({
    id: "BSD-3-Clause",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: [
      "Reproduce the copyright notice, the conditions and the disclaimer, in the docs or other materials you ship.",
      "Do not use the copyright holder's or a contributor's name to endorse or promote a product without written permission.",
    ],
    cite: "BSD-3-Clause clauses 2 and 3. Clause 3: 'Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.'",
  }),
  row({
    id: "Apache-2.0",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: true,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: false,
    requiresDistributionReview: true,
    notices: [
      "Give every recipient a copy of the licence (section 4a).",
      "Retain the copyright, patent, trademark and attribution notices from the source form (section 4c).",
      "If the upstream project ships a NOTICE file, the attribution notices inside it must travel into your distribution (section 4d).",
      "Mark every file you changed, with prominent notices that you changed it (section 4b).",
    ],
    cite:
      "Apache License 2.0 sections 4a, 4b, 4c and 4d. Section 4d: 'If the Work includes a \"NOTICE\" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file.'",
  }),
  row({
    id: "MPL-2.0",
    family: "file-copyleft",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: true,
    requiresDistributionReview: false,
    notices: [
      "Keep the covered files under MPL-2.0, and tell recipients the source form is governed by it and how to get it (section 3.1).",
      "You may not remove or alter the substance of any licence or copyright notice in the covered files (section 3.4).",
      "The copyleft is per file, not per project. Files with no MPL code in them are not Modifications.",
    ],
    cite:
      "MPL 2.0 sections 1.10, 3.1, 3.2 and 3.4, and the MPL 2.0 FAQ on file-level copyleft: 'new files containing no MPL-licensed code are not Modifications'.",
  }),
  row({
    id: "LGPL-2.1",
    family: "library-copyleft",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: true,
    requiresDistributionReview: false,
    notices: [
      "Say prominently that the library is used and covered by this licence, and ship a copy of it (section 6).",
      "Let the recipient modify and relink: ship relinkable object code, use a shared library mechanism, or make the written offer in section 6c.",
    ],
    cite:
      "LGPL-2.1 section 6, and the GNU GPL FAQ on static linking: 'you must also provide your application in an object (not necessarily source) format, so that a user has the opportunity to modify the library and relink the application.'",
  }),
  row({
    id: "LGPL-3.0",
    family: "library-copyleft",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: true,
    requiresDistributionReview: false,
    notices: [
      "Say prominently that the library is used and covered by this licence, and ship copies of GPL-3.0 and LGPL-3.0 (section 4).",
      "Either ship the Minimal Corresponding Source so the user can recombine or relink, or use a suitable shared library mechanism (section 4d).",
    ],
    cite:
      "LGPL-3.0 sections 3 and 4, which add Installation Information through LGPL-3.0 section 4(e) and GPL-3.0 section 6.",
  }),
  row({
    id: "GPL-2.0",
    family: "strong-copyleft",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: true,
    requiresDistributionReview: true,
    notices: [
      "Keep the licence and the copyright notice with every verbatim copy, and say that you changed the files and when (sections 2 and 3).",
      "License the whole work, as a whole, under this licence, to anyone who receives a copy (section 3).",
      "Ship or offer the complete corresponding source for the object code you distribute (section 3).",
    ],
    cite:
      "GPL-2.0 sections 2 and 3. GPL-2.0 is incompatible with Apache-2.0, because Apache-2.0's patent termination and NOTICE terms are requirements GPL-2.0 does not permit.",
  }),
  row({
    id: "GPL-3.0",
    family: "strong-copyleft",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: true,
    requiresDistributionReview: true,
    notices: [
      "Keep the licence and the copyright notice with every verbatim copy, and say that you changed it and give a date (section 5).",
      "License the whole work, as a whole, under this licence, to anyone who receives a copy (section 5c).",
      "Ship or offer the corresponding source for the object code you distribute (section 6).",
      "Interactive user interfaces must display appropriate legal notices (section 5d).",
    ],
    cite:
      "GPL-3.0 sections 5, 6 and 11. Section 5c: 'You must license the entire work, as a whole, under this License to anyone who comes into possession of a copy.'",
  }),
  row({
    id: "AGPL-3.0",
    family: "strong-copyleft",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: true,
    requiresDistributionReview: true,
    notices: [
      "Everything GPL-3.0 asks for, because AGPL-3.0 is GPL-3.0 plus section 13.",
      "If you modify it and users reach it over a network, offer those users the corresponding source at no charge (section 13).",
    ],
    cite:
      "AGPL-3.0 section 13: 'if you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network an opportunity to receive the Corresponding Source of your version.'",
  }),
  row({
    id: "SSPL-1.0",
    family: "source-available",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: true,
    requiresDistributionReview: true,
    notices: [
      "If you make the functionality available to third parties as a service, publish the service source code at no charge under this licence (section 13).",
      "The disclosure scope is the whole service stack, including management software, user interfaces, storage and hosting software (section 13).",
      "No modification is required for the trigger. Running it as a service is the trigger.",
    ],
    cite:
      "SSPL 1.0 section 13, 'Offering the Program as a Service', and the definition of 'Service Source Code'. SSPL-1.0 is not OSI approved.",
  }),
  row({
    id: "BUSL-1.1",
    family: "source-available",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: false,
    requiresDistributionReview: true,
    notices: [
      "Display the licence conspicuously on each original or modified copy.",
      "Read the Change Date and the Additional Use Grant in the package's own parameters. BUSL-1.1 alone is not a usable record.",
      "The terms change on the Change Date, so a version that is restrictive today can become GPL later.",
    ],
    cite:
      "BUSL 1.1, Additional Use Grant and Change Licence provisions, and 'If your use of the Licensed Work does not comply ... you must purchase a commercial license from the Licensor, or you must refrain from using the Licensed Work.'",
  }),
  row({
    id: "Elastic-2.0",
    family: "source-available",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: true,
    requiresSourceDisclosure: false,
    requiresDistributionReview: true,
    notices: [
      "Anyone who gets any part of the software from you must also get a copy of these terms.",
      "Do not offer it as a hosted or managed service where users reach a substantial set of its features.",
      "Do not remove, disable or circumvent the licence key, and mark any modified copy.",
    ],
    cite:
      "Elastic License 2.0: 'You may not provide the software to third parties as a hosted or managed service, where the service provides users with access to any substantial set of the features or functionality of the software.'",
  }),
  row({
    id: "Commons-Clause",
    family: "source-available",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: true,
    notices: [
      "The base licence still applies in full, and the Commons Clause notice must appear alongside the base licence notice.",
      "You may not sell the software. 'Sell' is defined to include hosting fees and consulting or support fees.",
    ],
    cite:
      "commonsclause.com: 'the License does not grant to you, the right to Sell the Software', and 'Any license notice or attribution required by the License must also include this Commons Clause License Condition notice.' There is no SPDX id for Commons Clause on its own; it rides on the base licence.",
  }),
  row({
    id: "0BSD",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: false,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: [
      "No attribution is required. Read the text: the clause the author cared about is the one that disclaims warranties.",
    ],
    cite: "0BSD text: the licence is a modified BSD licence with the endorsement clause and the advertising clause removed, and no attribution clause.",
  }),
  row({
    id: "Python-2.0",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: ["Ship the licence and the copyright notice with every copy."],
    cite: "Python License 2.0, which is the permissive BSD licence with a contributor agreement attached.",
  }),
  row({
    id: "BlueOak-1.0.0",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: false,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: ["No attribution is required."],
    cite: "Blue Oak Model License 1.0.0.",
  }),
  row({
    id: "CC-BY-4.0",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: [
      "Give credit, link to the licence, and say whether you changed it.",
      "This is a content licence, not a software licence. Whether it is the right licence for a dependency is a question for a person.",
    ],
    cite: "Creative Commons Attribution 4.0, section 3 (licence grant) and section 4 (attribution).",
  }),
  row({
    id: "Zlib",
    family: "permissive",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: ["Ship the licence and the copyright notice. Altered versions must not use the original name."],
    cite: "zlib licence, third clause on altered versions.",
  }),
  row({
    id: "Unlicense",
    family: "public-domain",
    requiresLicenseText: false,
    requiresCopyrightNotice: false,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: ["Nothing is required. It is a dedication to the public domain, not a licence with conditions."],
    cite: "unlicense.org: 'Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software.'",
  }),
  row({
    id: "CC0-1.0",
    family: "public-domain",
    requiresLicenseText: false,
    requiresCopyrightNotice: false,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: false,
    notices: [
      "Nothing is required for copyright. No trademark or patent rights are waived, so there is no patent grant here either.",
    ],
    cite: "CC0 1.0 section 4(a): 'No trademark or patent rights held by Affirmer are waived, abandoned, surrendered, licensed or otherwise affected by this document.'",
  }),
  row({
    id: "LicenseRef-Proprietary-UNLICENSED",
    family: "proprietary",
    requiresLicenseText: true,
    requiresCopyrightNotice: true,
    requiresNoticeFile: false,
    requiresStateOfChanges: false,
    requiresSourceDisclosure: false,
    requiresDistributionReview: true,
    notices: [
      "This package is marked UNLICENSED, which means the author grants nothing. It is not Unlicense and it is not Unknown.",
      "There is no third-party grant to rely on. Obtain one, replace the package, or write down why you decided to carry it.",
    ],
    cite:
      "npm package.json docs: '\"license\": \"UNLICENSED\"' is what you set if you do not wish to grant others the right to use a private or unpublished package under any terms.",
  }),
];

const BY_ID = new Map(TABLE.map((entry) => [entry.id.toLowerCase(), entry]));

const UNKNOWN_ROW: LicenseObligation = {
  id: UNKNOWN_LICENSE,
  family: "unknown",
  requiresLicenseText: false,
  requiresCopyrightNotice: false,
  requiresNoticeFile: false,
  requiresStateOfChanges: false,
  requiresSourceDisclosure: false,
  requiresDistributionReview: false,
  notices: [
    "Nothing is asserted, because nothing was read. An unknown licence is not a permissive licence and it is not a licence to copy.",
  ],
  cite: "No licence text was read for this component, so there is no clause to cite.",
};

/** Ids that carry a `-only` or `-or-later` suffix are the same licence row. */
function baseId(id: string): string {
  if (/^LicenseRef-/i.test(id)) return id;
  return id.replace(/-(only|or-later)$/i, "");
}

/**
 * The obligations for one id, or the Unknown row when this product has none.
 *
 * `-only` and `-or-later` resolve to the same row, because the row describes
 * what the licence text asks for, and both forms are the same text. The
 * or-later flag is not dropped: the caller keeps the declared string and the
 * reader is told the choice is theirs.
 */
export function licenseObligation(id: string): LicenseObligation {
  const raw = id.trim();
  const direct = BY_ID.get(raw.toLowerCase());
  if (direct !== undefined) return direct;
  const base = BY_ID.get(baseId(raw).toLowerCase());
  if (base !== undefined) return base;
  return UNKNOWN_ROW;
}

/** Every id the table can name obligations for. */
export function knownObligationIds(): string[] {
  return TABLE.map((entry) => entry.id);
}

export { UNKNOWN_ROW as UNKNOWN_OBLIGATION };