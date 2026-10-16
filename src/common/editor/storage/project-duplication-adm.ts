/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectDocument } from './project-repository.ts';

/** Carry an ADM eligibility fence into a copy's independent revision history. */
export function duplicatedAdmRevision(source: ProjectDocument): Readonly<{ revision: number; metadata?: unknown }> {
	const metadata = record(source.metadata);
	const adm = record(metadata?.adm);
	const revision = source.revision;
	const pristineRevision = adm?.pristineRevision;
	if (adm?.mode !== 'passthrough' || typeof revision !== 'number'
		|| !Number.isSafeInteger(revision) || revision < 0
		|| typeof pristineRevision !== 'number' || !Number.isSafeInteger(pristineRevision) || pristineRevision < 0) {
		return { revision: 0 };
	}
	if (revision === pristineRevision) return {
		revision: 0, metadata: { ...metadata, adm: { ...adm, pristineRevision: 0 } },
	};
	// A stale fence must stay behind the copy's current generation, including
	// when that source was itself copied by an older version. Its next edit
	// must not accidentally return the document to the old pristine revision.
	return { revision: Math.max(revision, pristineRevision < Number.MAX_SAFE_INTEGER ? pristineRevision + 1 : revision) };
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
