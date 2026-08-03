/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalKind } from './linked-original-binding.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';

export interface LinkedOriginalTransientBindingReference {
	readonly kind: LinkedOriginalKind;
	readonly sourceId: string;
	readonly bindingToken: string;
}

export interface LinkedOriginalBindingPublicationResult {
	readonly projectId: string;
	readonly sourceId: string;
	readonly bindingToken: string;
}

const REFERENCE_FIELDS = Object.freeze(['kind', 'sourceId', 'bindingToken'] as const);
const REFERENCE_FIELD_SET: ReadonlySet<string> = new Set(REFERENCE_FIELDS);
const BIND_RESULT_FIELDS = Object.freeze(['projectId', 'sourceId', 'bindingToken'] as const);
const OPAQUE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;

/** Admit one closed exact generation remembered only until successful durable maintenance. */
export function normalizeLinkedOriginalTransientBindingReference(
	value: unknown,
): LinkedOriginalTransientBindingReference {
	const record = closedReferenceRecord(value);
	const kind = linkedOriginalKind(record.kind);
	linkedOriginalBindingKey('transient-binding-project-validation', record.sourceId);
	return Object.freeze({
		kind,
		sourceId: record.sourceId as string,
		bindingToken: bindingToken(record.bindingToken),
	});
}

/** Extract exact ownership from a successful binding result without trusting accessors. */
export function linkedOriginalTransientBindingReferenceFromBindResult(
	projectId: string,
	sourceReference: Pick<LinkedOriginalTransientBindingReference, 'kind' | 'sourceId'>,
	result: unknown,
): LinkedOriginalTransientBindingReference {
	const expected = normalizeProjectSourceReference(projectId, sourceReference);
	const publication = bindResultDataFields(result);
	linkedOriginalBindingKey(publication.projectId, publication.sourceId);
	if (publication.projectId !== projectId) {
		throw new Error('Linked original bind result does not match its project identity.');
	}
	if (publication.sourceId !== expected.sourceId) {
		throw new Error('Linked original bind result does not match its source identity.');
	}
	return normalizeLinkedOriginalTransientBindingReference({
		kind: expected.kind,
		sourceId: expected.sourceId,
		bindingToken: publication.bindingToken,
	});
}

function normalizeProjectSourceReference(
	projectId: string,
	value: Pick<LinkedOriginalTransientBindingReference, 'kind' | 'sourceId'>,
): Readonly<Pick<LinkedOriginalTransientBindingReference, 'kind' | 'sourceId'>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked original bind source reference is required.');
	}
	const kind = linkedOriginalKind(value.kind);
	linkedOriginalBindingKey(projectId, value.sourceId);
	return Object.freeze({ kind, sourceId: value.sourceId });
}

function bindResultDataFields(value: unknown): Readonly<{
	projectId: unknown;
	sourceId: unknown;
	bindingToken: unknown;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A successful linked original bind result is required.');
	}
	const record = value as Record<string, unknown>;
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of BIND_RESULT_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(record, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked original bind result ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output as ReturnType<typeof bindResultDataFields>;
}

function closedReferenceRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked original transient binding reference is required.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A linked original transient binding reference must be a plain object.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== REFERENCE_FIELDS.length
		|| keys.some((key) => typeof key !== 'string' || !REFERENCE_FIELD_SET.has(key))) {
		throw new TypeError('A linked original transient binding reference contains an unsupported field.');
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of REFERENCE_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked original transient binding ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function linkedOriginalKind(value: unknown): LinkedOriginalKind {
	if (value !== 'audio' && value !== 'video') {
		throw new TypeError('Linked original transient binding kind must be audio or video.');
	}
	return value;
}

function bindingToken(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_TOKEN_PATTERN.test(value)) {
		throw new TypeError('A valid linked original transient binding token is required.');
	}
	return value;
}
