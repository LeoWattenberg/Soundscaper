/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertProjectRevisionPublicationCapacity,
	estimateProjectRevisionPublication,
} from '../project-publication-admission.ts';
import type { LinkedOriginalKind } from './linked-original-binding.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';

const MAXIMUM_PROTECTED_LINKED_ORIGINAL_SOURCE_REFERENCES = 100_000;
const MAXIMUM_PROTECTED_LINKED_VIDEO_SOURCE_IDS = 100_000;
const PROJECT_SAVE_OPTION_NAMES = new Set([
	'admitProjectPublication',
	'protectedLinkedOriginalSourceReferences',
	'protectedLinkedVideoSourceIds',
]);
const PROJECT_LINKED_ORIGINAL_SOURCE_REFERENCE_FIELDS = new Set(['kind', 'sourceId']);

export type ProjectPublicationAdmission = (
	bytes: number,
) => PromiseLike<unknown> | unknown;

export interface ProjectPublicationStore {
	readonly backend: unknown;
	readonly maximumProjectDocumentBytes?: number;
	ready(): PromiseLike<unknown>;
	estimateStorage(): PromiseLike<unknown>;
}

export interface ProjectLinkedOriginalSourceReference {
	readonly kind: LinkedOriginalKind;
	readonly sourceId: string;
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

/** Snapshot the complete kindful caller-owned roots that make source cleanup Undo-safe. */
export function projectProtectedLinkedOriginalSourceReferences(
	options: unknown,
): readonly ProjectLinkedOriginalSourceReference[] | null {
	const record = projectSaveOptionRecord(options);
	const value = record.protectedLinkedOriginalSourceReferences;
	const legacyValue = record.protectedLinkedVideoSourceIds;
	if (value === undefined && legacyValue === undefined) return null;
	if (value !== undefined && (!Array.isArray(value)
		|| value.length > MAXIMUM_PROTECTED_LINKED_ORIGINAL_SOURCE_REFERENCES)) {
		throw new RangeError('Protected linked-original source references exceed their array limit.');
	}
	const references = new Map<string, ProjectLinkedOriginalSourceReference>();
	for (const candidate of (value as readonly unknown[] | undefined) ?? []) {
		const reference = projectLinkedOriginalSourceReference(candidate);
		references.set(projectLinkedOriginalSourceReferenceKey(reference), reference);
	}
	for (const sourceId of protectedLinkedVideoSourceIds(legacyValue) ?? []) {
		const reference = Object.freeze({ kind: 'video' as const, sourceId });
		references.set(projectLinkedOriginalSourceReferenceKey(reference), reference);
	}
	if (references.size > MAXIMUM_PROTECTED_LINKED_ORIGINAL_SOURCE_REFERENCES) {
		throw new RangeError('Protected linked-original source references exceed their aggregate limit.');
	}
	return Object.freeze([...references.values()].sort((left, right) => (
		left.kind.localeCompare(right.kind) || left.sourceId.localeCompare(right.sourceId)
	)));
}

/** Snapshot the complete caller-owned roots that make source cleanup Undo-safe. */
export function projectProtectedLinkedVideoSourceIds(
	options: unknown,
): readonly string[] | null {
	return protectedLinkedVideoSourceIds(
		projectSaveOptionRecord(options).protectedLinkedVideoSourceIds,
	);
}

function protectedLinkedVideoSourceIds(value: unknown): readonly string[] | null {
	if (value === undefined) return null;
	if (!Array.isArray(value) || value.length > MAXIMUM_PROTECTED_LINKED_VIDEO_SOURCE_IDS) {
		throw new RangeError('Protected linked-video source IDs exceed their array limit.');
	}
	const sourceIds = value.map((sourceId) => {
		linkedOriginalBindingKey('project-save-protection-validation', sourceId);
		return sourceId as string;
	});
	if (new Set(sourceIds).size !== sourceIds.length) {
		throw new Error('Protected linked-video source IDs contain duplicate identities.');
	}
	return Object.freeze(sourceIds);
}

function projectLinkedOriginalSourceReference(
	value: unknown,
): ProjectLinkedOriginalSourceReference {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A protected linked-original source reference is required.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	const keys = Reflect.ownKeys(value);
	if ((prototype !== Object.prototype && prototype !== null)
		|| keys.length !== PROJECT_LINKED_ORIGINAL_SOURCE_REFERENCE_FIELDS.size
		|| keys.some((key) => (
			typeof key !== 'string' || !PROJECT_LINKED_ORIGINAL_SOURCE_REFERENCE_FIELDS.has(key)
		))) {
		throw new TypeError('A protected linked-original source reference contains an unsupported field.');
	}
	const kind = enumerableDataField(value, 'kind');
	const sourceId = enumerableDataField(value, 'sourceId');
	if (kind !== 'audio' && kind !== 'video') {
		throw new TypeError('Protected linked-original source kind must be audio or video.');
	}
	linkedOriginalBindingKey('project-save-protection-validation', sourceId);
	return Object.freeze({ kind, sourceId: sourceId as string });
}

function enumerableDataField(value: object, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Protected linked-original source ${field} must be an enumerable data field.`);
	}
	return descriptor.value;
}

function projectLinkedOriginalSourceReferenceKey(
	reference: ProjectLinkedOriginalSourceReference,
): string {
	return JSON.stringify([reference.kind, reference.sourceId]);
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
