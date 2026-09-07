/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedOriginalBinding,
	type LinkedOriginalBinding,
	type LinkedOriginalKind,
} from './linked-original-binding.ts';

export interface ProjectOriginalSource {
	readonly kind: LinkedOriginalKind;
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly sourceShape: LinkedOriginalBinding['sourceShape'];
}

/**
 * Reachable project sources split by whether they can carry a linked original at all. An imported
 * source keeps the container's declared sample format and media type, which the binding invariants
 * deliberately refuse; such a source is simply not aliasable, and only becomes an error when a
 * binding for it actually exists.
 */
export interface ProjectOriginalSources {
	readonly sources: ReadonlyMap<string, ProjectOriginalSource>;
	readonly unbindable: ReadonlySet<string>;
}

interface ProjectSourceIdentity {
	readonly record: Record<string, unknown>;
	readonly kind: LinkedOriginalKind;
	readonly id: unknown;
	readonly storageKey: unknown;
	readonly mimeType: unknown;
}

const AUDIO_SOURCE_SHAPE_FIELDS = Object.freeze([
	'frameCount',
	'channelCount',
	'sampleRate',
	'originalSampleRate',
	'sampleFormat',
	'chunkFrames',
] as const);
const VALIDATION_LOCATOR_ID = 'locator_validation_token';
const VALIDATION_LOCATOR_REVISION = 'snapshot_validation_token';
const VALIDATION_BINDING_TOKEN = 'binding_validation_token';
const VALIDATION_DIGEST = '0'.repeat(64);
const VALIDATION_INSTANT = '1970-01-01T00:00:00.000Z';

export function projectOriginalSources(
	value: unknown,
	projectId: string,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
	maximumSources: number,
): ProjectOriginalSources {
	if (!Array.isArray(value)) throw new TypeError('Linked original project sources must be an array.');
	if (value.length > maximumSources) {
		throw new RangeError('Linked original project sources exceed the record limit.');
	}
	const sources = new Map<string, ProjectOriginalSource>();
	const unbindable = new Set<string>();
	for (const candidate of value) {
		const identity = projectSourceIdentity(candidate, managedKindsValue);
		const source = bindableProjectSource(identity, projectId);
		const id = source ? source.id : sourceIdentifier(identity);
		if (sources.has(id) || unbindable.has(id)) {
			throw new Error('Linked original project sources contain a duplicate source identity.');
		}
		if (source) sources.set(id, source);
		else unbindable.add(id);
	}
	return Object.freeze({ sources, unbindable });
}

function projectSourceIdentity(
	value: unknown,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
): ProjectSourceIdentity {
	const record = plainRecord(value, 'project source');
	const id = dataField(record, 'id');
	const kind = dataField(record, 'kind');
	const storageKey = dataField(record, 'storageKey');
	const mimeType = dataField(record, 'mimeType');
	if ((kind !== 'audio' && kind !== 'video') || !managedKindsValue.has(kind)) {
		throw new TypeError('A linked original project source kind is not managed by this repository.');
	}
	return Object.freeze({ record, kind, id, storageKey, mimeType });
}

/** Null when the source's own declared shape cannot satisfy the linked original invariants. */
function bindableProjectSource(
	identity: ProjectSourceIdentity,
	projectId: string,
): ProjectOriginalSource | null {
	try {
		return projectSource(identity, projectId);
	} catch (error) {
		if (typeof identity.id !== 'string' || identity.id.length === 0) throw error;
		return null;
	}
}

function sourceIdentifier(identity: ProjectSourceIdentity): string {
	if (typeof identity.id !== 'string' || identity.id.length === 0) {
		throw new TypeError('A linked original project source id must be a non-empty string.');
	}
	return identity.id;
}

function projectSource(identity: ProjectSourceIdentity, projectId: string): ProjectOriginalSource {
	const sourceShape = identity.kind === 'audio'
		? Object.fromEntries(AUDIO_SOURCE_SHAPE_FIELDS.map(
			(field) => [field, dataField(identity.record, field)],
		))
		: projectVideoSourceShape(identity.record);
	const binding = normalizeLinkedOriginalBinding({
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: identity.kind,
		projectId,
		sourceId: identity.id,
		storageKey: identity.storageKey,
		locatorId: VALIDATION_LOCATOR_ID,
		locatorRevision: VALIDATION_LOCATOR_REVISION,
		mimeType: identity.mimeType,
		byteLength: 1,
		sha256: VALIDATION_DIGEST,
		sourceShape,
		bindingToken: VALIDATION_BINDING_TOKEN,
		boundAt: VALIDATION_INSTANT,
	});
	return Object.freeze({
		kind: binding.kind,
		id: binding.sourceId,
		storageKey: binding.storageKey,
		mimeType: binding.mimeType,
		sourceShape: binding.sourceShape,
	});
}

function projectVideoSourceShape(source: Record<string, unknown>): Readonly<Record<string, unknown>> {
	const rate = dataField(source, 'frameRate');
	const sampleFrameCount = optionalDataField(source, 'sampleFrameCount');
	const frameCount = sampleFrameCount === undefined
		? dataField(source, 'frameCount')
		: sampleFrameCount;
	const frameRate = typeof rate === 'number'
		? rate
		: rationalFrameRate(rate);
	return Object.freeze({
		frameCount,
		sampleRate: dataField(source, 'sampleRate'),
		width: dataField(source, 'width'),
		height: dataField(source, 'height'),
		frameRate,
		videoCodec: dataField(source, 'videoCodec'),
		audioCodec: dataField(source, 'audioCodec'),
		hasAudio: dataField(source, 'hasAudio'),
	});
}

function rationalFrameRate(value: unknown): number {
	const rational = plainRecord(value, 'video source frame rate');
	return Number(dataField(rational, 'num')) / Number(dataField(rational, 'den'));
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`A linked original ${label} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`A linked original ${label} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function dataField(record: Record<string, unknown>, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Linked original project source ${field} must be an enumerable data field.`);
	}
	return descriptor.value;
}

function optionalDataField(record: Record<string, unknown>, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Linked original project source ${field} must be an enumerable data field.`);
	}
	return descriptor.value;
}
