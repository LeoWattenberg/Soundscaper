/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertProjectRevisionPublicationCapacity,
	estimateProjectRevisionPublication,
} from '../project-publication-admission.ts';
import { linkedVideoOriginalBindingKey } from './linked-video-original-schema.ts';

const MAXIMUM_PROTECTED_LINKED_VIDEO_SOURCE_IDS = 100_000;
const PROJECT_SAVE_OPTION_NAMES = new Set([
	'admitProjectPublication',
	'protectedLinkedVideoSourceIds',
]);

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
	const record = projectSaveOptionRecord(options);
	const admission = record.admitProjectPublication;
	if (admission === undefined) return null;
	if (typeof admission !== 'function') {
		throw new TypeError('Project publication admission must be a function.');
	}
	return admission as ProjectPublicationAdmission;
}

/** Snapshot the complete caller-owned roots that make source cleanup Undo-safe. */
export function projectProtectedLinkedVideoSourceIds(
	options: unknown,
): readonly string[] | null {
	const value = projectSaveOptionRecord(options).protectedLinkedVideoSourceIds;
	if (value === undefined) return null;
	if (!Array.isArray(value) || value.length > MAXIMUM_PROTECTED_LINKED_VIDEO_SOURCE_IDS) {
		throw new RangeError('Protected linked-video source IDs exceed their array limit.');
	}
	const sourceIds = value.map((sourceId) => {
		linkedVideoOriginalBindingKey('project-save-protection-validation', sourceId);
		return sourceId as string;
	});
	if (new Set(sourceIds).size !== sourceIds.length) {
		throw new Error('Protected linked-video source IDs contain duplicate identities.');
	}
	return Object.freeze(sourceIds);
}

function projectSaveOptionRecord(options: unknown): Record<string, unknown> {
	if (!options
		|| typeof options !== 'object'
		|| Array.isArray(options)
		|| Object.getPrototypeOf(options) !== Object.prototype) {
		throw new TypeError('Project save options must be a plain object.');
	}
	const record = options as Record<string, unknown>;
	for (const name of Object.keys(record)) {
		if (!PROJECT_SAVE_OPTION_NAMES.has(name)) {
			throw new TypeError(`Unsupported project save option: ${name}.`);
		}
	}
	return record;
}
