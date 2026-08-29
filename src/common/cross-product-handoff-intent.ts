/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_SCHEMA_VERSION,
	isProjectSchemaFamily,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from './editor/project-schema-identity.ts';

export const CROSS_PRODUCT_HANDOFF_INTENT_KIND = 'cross-product-editable-copy' as const;
export const CROSS_PRODUCT_HANDOFF_INTENT_VERSION = 1 as const;
export const CROSS_PRODUCT_HANDOFF_QUERY_PARAMETER = 'handoff' as const;

const INTENT_FIELDS = Object.freeze([
	'kind', 'version', 'invocationId', 'sourceRevision', 'source', 'destination',
] as const);
const REF_FIELDS = Object.freeze(['schemaFamily', 'schemaVersion', 'projectId'] as const);
const MAXIMUM_ID_LENGTH = 256;
const MAXIMUM_HANDOFF_QUERY_LENGTH = 16 * 1024;
const MAXIMUM_HANDOFF_VALUE_LENGTH = 4 * 1024;

export interface CrossProductHandoffProjectRef {
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly projectId: string;
}

export interface CrossProductHandoffLaunchIntentV1 {
	readonly kind: typeof CROSS_PRODUCT_HANDOFF_INTENT_KIND;
	readonly version: typeof CROSS_PRODUCT_HANDOFF_INTENT_VERSION;
	readonly invocationId: string;
	readonly sourceRevision: number;
	readonly source: Readonly<CrossProductHandoffProjectRef>;
	readonly destination: Readonly<CrossProductHandoffProjectRef>;
}

export interface CreateCrossProductHandoffLaunchIntentOptions {
	readonly sourceProject: unknown;
	readonly destinationFamily: ProjectSchemaFamily;
	/** Injected by tests and retry restorers; a new menu invocation normally mints it. */
	readonly invocationId?: string;
	/** Injected by tests and retry restorers; a new menu invocation normally mints it. */
	readonly destinationProjectId?: string;
}

/** Mint one immutable invocation. Reusing its serialized value is the retry contract. */
export function createCrossProductHandoffLaunchIntent(
	options: CreateCrossProductHandoffLaunchIntentOptions,
): Readonly<CrossProductHandoffLaunchIntentV1> {
	if (!options || typeof options !== 'object') {
		throw new TypeError('Cross-product handoff intent options must be a record.');
	}
	const sourceIdentity = readProjectSchemaIdentity(options.sourceProject);
	if (sourceIdentity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Cross-product editable copies require an exact family-v1 source.');
	}
	if (!isProjectSchemaFamily(options.destinationFamily)) {
		throw new RangeError('Cross-product handoff destination schemaFamily is unsupported.');
	}
	if (sourceIdentity.schemaFamily === options.destinationFamily) {
		throw new RangeError('A cross-product handoff must target a different product family.');
	}
	const sourceProject = record(options.sourceProject, 'Cross-product handoff source project');
	const sourceRevision = admittedRevision(sourceProject.revision, 'source project revision');
	return admitCrossProductHandoffLaunchIntent({
		kind: CROSS_PRODUCT_HANDOFF_INTENT_KIND,
		version: CROSS_PRODUCT_HANDOFF_INTENT_VERSION,
		invocationId: options.invocationId ?? createIntentId('handoff'),
		sourceRevision,
		source: {
			schemaFamily: sourceIdentity.schemaFamily,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			projectId: sourceProject.id,
		},
		destination: {
			schemaFamily: options.destinationFamily,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			projectId: options.destinationProjectId ?? createIntentId(`${options.destinationFamily}-copy`),
		},
	});
}

function createIntentId(prefix: string): string {
	const randomUuid = globalThis.crypto?.randomUUID?.();
	if (randomUuid) return `${prefix}-${randomUuid}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Serialize as one bounded query value; the object inside remains a closed versioned record. */
export function serializeCrossProductHandoffLaunchIntent(
	value: unknown,
): string {
	const intent = admitCrossProductHandoffLaunchIntent(value);
	const parameters = new URLSearchParams();
	parameters.set(CROSS_PRODUCT_HANDOFF_QUERY_PARAMETER, JSON.stringify(intent));
	const serialized = parameters.toString();
	if (serialized.length > MAXIMUM_HANDOFF_QUERY_LENGTH) {
		throw new RangeError('The cross-product handoff intent exceeds its URL budget.');
	}
	return serialized;
}

/** Parse an optional launch intent. A present intent is always admitted fail-closed. */
export function parseCrossProductHandoffLaunchIntent(
	value: string | URLSearchParams,
): Readonly<CrossProductHandoffLaunchIntentV1> | null {
	const raw = value instanceof URLSearchParams ? value.toString() : String(value).replace(/^\?/u, '');
	if (raw.length > MAXIMUM_HANDOFF_QUERY_LENGTH) {
		throw new RangeError('The cross-product handoff query exceeds its URL budget.');
	}
	const parameters = new URLSearchParams(raw);
	const entries = [...parameters.entries()];
	const handoffs = entries.filter(([key]) => key === CROSS_PRODUCT_HANDOFF_QUERY_PARAMETER);
	if (handoffs.length === 0) return null;
	if (handoffs.length !== 1 || entries.length !== 1) {
		throw new TypeError('A cross-product handoff URL must carry exactly one handoff parameter.');
	}
	if (handoffs[0]![1].length > MAXIMUM_HANDOFF_VALUE_LENGTH) {
		throw new RangeError('The cross-product handoff value exceeds its JSON budget.');
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(handoffs[0]![1]);
	} catch (error) {
		throw new SyntaxError('The cross-product handoff intent is not valid JSON.', { cause: error });
	}
	return admitCrossProductHandoffLaunchIntent(decoded);
}

/** Closed-record admission shared by the URL parser and domain conversion boundary. */
export function admitCrossProductHandoffLaunchIntent(
	value: unknown,
): Readonly<CrossProductHandoffLaunchIntentV1> {
	const intent = exactRecord(value, INTENT_FIELDS, 'Cross-product handoff intent');
	if (intent.kind !== CROSS_PRODUCT_HANDOFF_INTENT_KIND) {
		throw new RangeError(`Unsupported cross-product handoff kind: ${String(intent.kind)}.`);
	}
	if (intent.version !== CROSS_PRODUCT_HANDOFF_INTENT_VERSION) {
		throw new RangeError(`Unsupported cross-product handoff version: ${String(intent.version)}.`);
	}
	const source = projectRef(intent.source, 'source');
	const destination = projectRef(intent.destination, 'destination');
	if (source.schemaFamily === destination.schemaFamily) {
		throw new RangeError('A cross-product handoff must target a different product family.');
	}
	if (source.projectId === destination.projectId) {
		throw new RangeError('A cross-product handoff must use a separately identified destination project id.');
	}
	return Object.freeze({
		kind: CROSS_PRODUCT_HANDOFF_INTENT_KIND,
		version: CROSS_PRODUCT_HANDOFF_INTENT_VERSION,
		invocationId: boundedId(intent.invocationId, 'invocationId'),
		sourceRevision: admittedRevision(intent.sourceRevision, 'sourceRevision'),
		source,
		destination,
	});
}

function admittedRevision(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`Cross-product handoff ${label} must be a non-negative safe integer.`);
	}
	return value;
}

function projectRef(value: unknown, label: string): Readonly<CrossProductHandoffProjectRef> {
	const ref = exactRecord(value, REF_FIELDS, `Cross-product handoff ${label} project ref`);
	if (!isProjectSchemaFamily(ref.schemaFamily)) {
		throw new RangeError(`Cross-product handoff ${label} schemaFamily is unsupported.`);
	}
	if (ref.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError(`Cross-product handoff ${label} schemaVersion must be family v1.`);
	}
	return Object.freeze({
		schemaFamily: ref.schemaFamily,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId: boundedId(ref.projectId, `${label}.projectId`),
	});
}

function boundedId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.length || value.length > MAXIMUM_ID_LENGTH
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`Cross-product handoff ${label} must be a non-empty bounded string.`);
	}
	return value;
}

function exactRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	label: string,
): Record<Fields[number], unknown> {
	const candidate = record(value, label);
	const expected = new Set<string>(fields);
	const keys = Reflect.ownKeys(candidate);
	const unsupported = keys.find((key) => typeof key !== 'string' || !expected.has(key));
	if (unsupported !== undefined || keys.length !== fields.length) {
		throw new TypeError(`${label} contains an unsupported field ${String(unsupported ?? '(missing)')}.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property.`);
		}
	}
	return candidate as Record<Fields[number], unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
