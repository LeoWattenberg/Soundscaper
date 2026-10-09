/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAdmProjectMetadata, type AdmProjectMetadata } from '../adm-project-metadata.ts';

/** Retire only signal references whose owning tracks are removed by this edit. */
export function removeAdmTrackReferences(
	metadata: AdmProjectMetadata | null | undefined,
	removedTrackIds: ReadonlySet<string>,
): AdmProjectMetadata | null | undefined {
	if (metadata?.mode !== 'authored') return metadata;
	const survives = (reference: Readonly<{ stripKind: string; stripId: string }>) => (
		reference.stripKind !== 'track' || !removedTrackIds.has(reference.stripId)
	);
	const assignments = metadata.bed.assignments.filter(survives);
	const objects = (metadata.objects ?? []).filter(survives);
	if (assignments.length === metadata.bed.assignments.length
		&& objects.length === (metadata.objects?.length ?? 0)) return metadata;
	return normalizeAdmProjectMetadata({
		...metadata,
		bed: { ...metadata.bed, assignments },
		objects,
	});
}
