/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalJsonRootSha256, canonicalJsonSha256 } from '../canonical-json-sha256.ts';
import { readCrossProductHandoffProvenance } from
	'../transfer/cross-product-handoff-provenance.ts';

/** Optional exact evidence used only by sidecar-bound transfer admission. */
export function inspectScapeCanonicalEvidence(
	project: unknown | null,
	existing: unknown | null,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		projectCanonicalSha256: project === null ? null : canonicalJsonSha256(project),
		existingProjectCanonicalSha256: existing === null ? null : canonicalJsonSha256(existing),
		projectCanonicalRootSha256: project === null ? null : canonicalJsonRootSha256(project),
		projectCrossProductHandoffProvenance: project === null
			? null : readCrossProductHandoffProvenance(project),
		existingProjectCrossProductHandoffProvenance: existing === null
			? null : readCrossProductHandoffProvenance(existing),
	});
}
