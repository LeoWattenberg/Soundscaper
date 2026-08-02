/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertProjectRevisionPublicationCapacity,
	estimateProjectRevisionPublication,
} from '../project-publication-admission.ts';

export type ProjectPublicationAdmission = (
	bytes: number,
) => PromiseLike<unknown> | unknown;

export interface ProjectPublicationStore {
	readonly backend: unknown;
	readonly maximumProjectDocumentBytes?: number;
	ready(): PromiseLike<unknown>;
	estimateStorage(): PromiseLike<unknown>;
}

/** Apply the same bounded publication preflight to saves and create-only copies. */
export async function admitProjectPublication(
	store: ProjectPublicationStore,
	project: unknown,
	options: unknown = {},
): Promise<void> {
	const admission = projectPublicationAdmission(options);
	const publication = estimateProjectRevisionPublication(project, {
		maximumDocumentBytes: store.maximumProjectDocumentBytes,
	});
	await store.ready();
	if (admission) await admission(publication.currentAndRevision.bytes);
	else if (store.backend === 'indexeddb') {
		assertProjectRevisionPublicationCapacity(
			publication.currentAndRevision.bytes,
			await store.estimateStorage(),
		);
	}
}

/** Validate the closed optional admission hook accepted by project saves. */
export function projectPublicationAdmission(options: unknown): ProjectPublicationAdmission | null {
	if (!options
		|| typeof options !== 'object'
		|| Array.isArray(options)
		|| Object.getPrototypeOf(options) !== Object.prototype) {
		throw new TypeError('Project save options must be a plain object.');
	}
	const record = options as Record<string, unknown>;
	for (const name of Object.keys(record)) {
		if (name !== 'admitProjectPublication') {
			throw new TypeError(`Unsupported project save option: ${name}.`);
		}
	}
	const admission = record.admitProjectPublication;
	if (admission === undefined) return null;
	if (typeof admission !== 'function') {
		throw new TypeError('Project publication admission must be a function.');
	}
	return admission as ProjectPublicationAdmission;
}
