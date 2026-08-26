/* SPDX-License-Identifier: AGPL-3.0-only */

/** Project-isolated, disposable storage for reproducible Milestone 7 assistance outputs. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import {
	DEFAULT_DERIVATIVE_CACHE_LIMITS,
	normalizeDerivativeCacheLimits,
	planDerivativeCacheEviction,
	type DerivativeCacheLimits,
	type NormalizedDerivativeCacheLimits,
} from './derivative-cache-policy.ts';
import { KeyValueRepository, type KeyValuePrefixRecord } from './key-value-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export const ASSISTANCE_DERIVATIVE_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_DERIVATIVE_RECORD_VERSION = 1 as const;
export const ASSISTANCE_DERIVATIVE_KEY_PREFIX = 'assistance-derivative-v1:' as const;
export const ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES = 4_095;

export const ASSISTANCE_DERIVATIVE_KINDS = Object.freeze([
	'embeddings',
	'recognized-text',
	'visual-index',
	'audio-tags',
	'shot-table',
	'saliency-map',
	'subject-tracks',
	'tracker-state',
	'reframe-path',
	'ranking-checkpoint',
] as const);

export type AssistanceDerivativeKind = (typeof ASSISTANCE_DERIVATIVE_KINDS)[number];

export interface AssistanceDerivativeIdentityV1 {
	readonly schemaVersion: typeof ASSISTANCE_DERIVATIVE_SCHEMA_VERSION;
	readonly key: string;
	readonly projectScopeSha256: string;
	readonly identitySha256: string;
	readonly projectId: string;
	readonly kind: AssistanceDerivativeKind;
}

export interface AssistanceDerivativePayloadV1 {
	readonly mediaType: string;
	readonly bytes: Uint8Array;
}

export interface AssistanceDerivativeRecordV1 extends AssistanceDerivativeIdentityV1 {
	readonly recordVersion: typeof ASSISTANCE_DERIVATIVE_RECORD_VERSION;
	readonly mediaType: string;
	readonly size: number;
	readonly payloadByteLength: number;
	readonly payloadSha256: string;
	readonly bytes: Uint8Array;
	readonly committedAt: string;
}

export interface AssistanceDerivativeRepositoryOptions {
	readonly limits?: Readonly<Pick<
		DerivativeCacheLimits,
		'maximumBytes' | 'maximumEntries' | 'maximumAgeMs'
	>>;
	readonly now?: () => number;
}

export interface AssistanceDerivativeKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	delete(key: string): PromiseLike<unknown> | unknown;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
	listByPrefix(prefix: string): PromiseLike<readonly Readonly<KeyValuePrefixRecord>[]>
		| readonly Readonly<KeyValuePrefixRecord>[];
}

const DEFAULT_LIMITS: NormalizedDerivativeCacheLimits = Object.freeze({
	...DEFAULT_DERIVATIVE_CACHE_LIMITS,
	maximumEntries: ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES,
});
const RECORD_FIELDS = new Set([
	'recordVersion', 'schemaVersion', 'key', 'projectScopeSha256', 'identitySha256',
	'projectId', 'kind', 'mediaType', 'size', 'payloadByteLength', 'payloadSha256',
	'bytes', 'committedAt',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const KEY = /^assistance-derivative-v1:([a-f\d]{64}):([a-f\d]{64})$/u;
const DOMAIN_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const MEDIA_TYPE = /^[a-z\d][a-z\d!#$&^_.+-]{0,126}\/[a-z\d][a-z\d!#$&^_.+-]{0,126}$/u;
const MAXIMUM_TIMESTAMP = 8_640_000_000_000_000;
const UTF8 = new TextEncoder();

/**
 * Derive a reusable cache identity. Transport/job IDs and project revision are
 * excluded; exact source/timing/settings/recipe/model authority remains bound.
 * Accepted Reframe paths additionally bind their publication-base revision so
 * distinct reviewed user crop edits never collide under one immutable key.
 */
export function createAssistanceDerivativeIdentityV1(
	workflowValue: unknown,
	kindValue: unknown,
): AssistanceDerivativeIdentityV1 {
	const workflow = validateAssistanceWorkflow(workflowValue);
	const kind = derivativeKind(kindValue);
	const projectScopeSha256 = projectScope(workflow.fence.projectId);
	const descriptor = identityDescriptor(workflow, kind);
	const identitySha256 = digestBytes(UTF8.encode(JSON.stringify(descriptor)));
	return Object.freeze({
		schemaVersion: ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
		key: `${ASSISTANCE_DERIVATIVE_KEY_PREFIX}${projectScopeSha256}:${identitySha256}`,
		projectScopeSha256,
		identitySha256,
		projectId: workflow.fence.projectId,
		kind,
	});
}

export class AssistanceDerivativeRepository {
	readonly #values: AssistanceDerivativeKeyValuePort;
	readonly #limits: NormalizedDerivativeCacheLimits;
	readonly #now: () => number;
	#operations: Promise<unknown> = Promise.resolve();

	constructor(
		portOrValues: StorageRepositoryPort | AssistanceDerivativeKeyValuePort,
		options: Readonly<AssistanceDerivativeRepositoryOptions> = {},
	) {
		this.#values = isKeyValuePort(portOrValues)
			? portOrValues
			: new KeyValueRepository(portOrValues, 'analysis');
		this.#limits = normalizeDerivativeCacheLimits(options.limits ?? DEFAULT_LIMITS);
		if (this.#limits.maximumEntries > ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES) {
			throw new RangeError(
				`Assistance derivative maximumEntries cannot exceed ${String(ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES)}.`,
			);
		}
		this.#now = options.now ?? Date.now;
	}

	save(
		workflowValue: unknown,
		kindValue: unknown,
		payloadValue: AssistanceDerivativePayloadV1,
	): Promise<AssistanceDerivativeRecordV1> {
		return this.#serialize(() => this.#save(workflowValue, kindValue, payloadValue));
	}

	load(
		workflowValue: unknown,
		kindValue: unknown,
	): Promise<AssistanceDerivativeRecordV1 | null> {
		return this.#serialize(() => this.#load(workflowValue, kindValue));
	}

	listProject(
		projectIdValue: string,
		kindsValue: readonly AssistanceDerivativeKind[] = ASSISTANCE_DERIVATIVE_KINDS,
	): Promise<readonly AssistanceDerivativeRecordV1[]> {
		return this.#serialize(() => this.#listProject(projectIdValue, kindsValue));
	}

	purgeProject(projectIdValue: string): Promise<number> {
		const prefix = projectKeyPrefix(projectIdValue);
		return this.#serialize(() => this.#deleteRows(prefix));
	}

	purge(): Promise<number> {
		return this.#serialize(() => this.#deleteRows(ASSISTANCE_DERIVATIVE_KEY_PREFIX));
	}

	async #save(
		workflowValue: unknown,
		kindValue: unknown,
		payloadValue: AssistanceDerivativePayloadV1,
	): Promise<AssistanceDerivativeRecordV1> {
		const identity = createAssistanceDerivativeIdentityV1(workflowValue, kindValue);
		const record = createRecord(identity, payloadValue, this.#timestamp());
		assertFits(record.payloadByteLength, this.#limits);
		const existingValue = await this.#values.get(identity.key);
		if (existingValue !== undefined) {
			const existing = normalizeRecordOrNull(existingValue, identity);
			if (existing) {
				if (samePayload(existing, record)) return recordView(existing);
				throw new Error('A deterministic assistance derivative cache identity disagrees with its payload.');
			}
			if (!await this.#values.deleteIfCurrent(identity.key, existingValue)) {
				throw new Error('The corrupt assistance derivative changed during repair.');
			}
		}
		if (!await this.#values.putIfAbsent(identity.key, record)) {
			const raced = normalizeRecordOrNull(await this.#values.get(identity.key), identity);
			if (raced && samePayload(raced, record)) return recordView(raced);
			throw new Error('An assistance derivative cache publication collided with another payload.');
		}
		try {
			if (!await this.#maintain(identity.key)) {
				throw new RangeError('The assistance derivative cannot fit within its configured limits.');
			}
		} catch (error) {
			await Promise.resolve(this.#values.deleteIfCurrent(identity.key, record)).catch(() => false);
			throw error;
		}
		return recordView(record);
	}

	async #load(
		workflowValue: unknown,
		kindValue: unknown,
	): Promise<AssistanceDerivativeRecordV1 | null> {
		const identity = createAssistanceDerivativeIdentityV1(workflowValue, kindValue);
		const value = await this.#values.get(identity.key);
		if (value === undefined) return null;
		const record = normalizeRecordOrNull(value, identity);
		if (!record) {
			await this.#values.deleteIfCurrent(identity.key, value);
			return null;
		}
		const plan = planDerivativeCacheEviction([evictionRecord(record)], {
			...this.#limits,
			now: this.#timestamp(),
		});
		if (plan.removals.length > 0) {
			await this.#values.deleteIfCurrent(identity.key, value);
			return null;
		}
		await this.#maintain();
		return recordView(record);
	}

	async #listProject(
		projectIdValue: string,
		kindsValue: readonly AssistanceDerivativeKind[],
	): Promise<readonly AssistanceDerivativeRecordV1[]> {
		const prefix = projectKeyPrefix(projectIdValue);
		const kinds = derivativeKinds(kindsValue);
		const rows = await this.#values.listByPrefix(prefix);
		const records: AssistanceDerivativeRecordV1[] = [];
		for (const row of rows) {
			const record = normalizeRecordOrNull(row.value);
			if (!record || record.key !== row.key) {
				await this.#values.deleteIfCurrent(row.key, row.value);
			} else if (kinds.has(record.kind)) {
				records.push(record);
			}
		}
		await this.#maintain();
		const current = new Set((await this.#values.listByPrefix(prefix)).map(({ key }) => key));
		records.sort((left, right) => ASSISTANCE_DERIVATIVE_KINDS.indexOf(left.kind)
			- ASSISTANCE_DERIVATIVE_KINDS.indexOf(right.kind)
			|| left.identitySha256.localeCompare(right.identitySha256));
		return Object.freeze(records.filter(({ key }) => current.has(key)).map(recordView));
	}

	async #maintain(incomingKey?: string): Promise<boolean> {
		const rows = await this.#values.listByPrefix(ASSISTANCE_DERIVATIVE_KEY_PREFIX);
		const valid: Readonly<{ row: Readonly<KeyValuePrefixRecord>; record: AssistanceDerivativeRecordV1 }>[] = [];
		const discard: Readonly<KeyValuePrefixRecord>[] = [];
		for (const row of rows) {
			const record = normalizeRecordOrNull(row.value);
			if (!record || record.key !== row.key) discard.push(row);
			else valid.push(Object.freeze({ row, record }));
		}
		const plan = planDerivativeCacheEviction(
			valid.map(({ record }) => evictionRecord(record)),
			{ ...this.#limits, now: this.#timestamp() },
		);
		const removalKeys = new Set(plan.removals.map(({ key }) => String(key)));
		for (const row of discard) await this.#values.deleteIfCurrent(row.key, row.value);
		for (const { row } of valid) {
			if (removalKeys.has(row.key)) await this.#values.deleteIfCurrent(row.key, row.value);
		}
		return incomingKey === undefined || !removalKeys.has(incomingKey);
	}

	async #deleteRows(prefix: string): Promise<number> {
		const rows = await this.#values.listByPrefix(prefix);
		let deleted = 0;
		for (const row of rows) {
			if (await this.#values.deleteIfCurrent(row.key, row.value)) deleted += 1;
		}
		return deleted;
	}

	#timestamp(): number {
		const value = Number(this.#now());
		if (!Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_TIMESTAMP) {
			throw new RangeError('The assistance derivative timestamp is outside the supported Date range.');
		}
		return value;
	}

	#serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
		const result = this.#operations.then(operation, operation);
		this.#operations = result.catch(() => undefined);
		return result;
	}
}

function evictionRecord(record: AssistanceDerivativeRecordV1): Readonly<{
	key: string; size: number; committedAt: string;
}> {
	return Object.freeze({ key: record.key, size: record.size, committedAt: record.committedAt });
}

function identityDescriptor(workflow: AssistanceWorkflowV1, kind: AssistanceDerivativeKind): unknown {
	const fence = workflow.fence;
	return {
		schemaVersion: ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
		projectId: fence.projectId,
		...(kind === 'reframe-path' ? { projectRevision: fence.revision } : {}),
		projectSchemaVersion: fence.schemaVersion,
		sequenceId: fence.sequenceId,
		workflowId: workflow.workflowId,
		kind,
		sourceRanges: fence.sourceRanges,
		transcriptBodySha256: fence.transcriptBodySha256,
		recipeVersion: workflow.recipeVersion,
		settingsVersion: workflow.settingsVersion,
		recipeSha256: fence.recipeSha256,
		settingsSha256: fence.settingsSha256,
		modelBindingsSha256: fence.modelBindingsSha256,
		models: [...workflow.models].sort((left, right) => left.stageId.localeCompare(right.stageId)
			|| left.slotId.localeCompare(right.slotId)),
	};
}

function createRecord(
	identity: AssistanceDerivativeIdentityV1,
	payloadValue: AssistanceDerivativePayloadV1,
	now: number,
): AssistanceDerivativeRecordV1 {
	if (!payloadValue || typeof payloadValue !== 'object' || Array.isArray(payloadValue)
		|| Object.keys(payloadValue).length !== 2
		|| !Object.hasOwn(payloadValue, 'mediaType') || !Object.hasOwn(payloadValue, 'bytes')) {
		throw new TypeError('An assistance derivative payload must use its exact schema.');
	}
	const mediaType = normalizedMediaType(payloadValue.mediaType);
	const bytes = normalizedBytes(payloadValue.bytes);
	const payloadSha256 = digestBytes(bytes);
	return Object.freeze({
		recordVersion: ASSISTANCE_DERIVATIVE_RECORD_VERSION,
		...identity,
		mediaType,
		size: bytes.byteLength,
		payloadByteLength: bytes.byteLength,
		payloadSha256,
		bytes,
		committedAt: new Date(now).toISOString(),
	});
}

function normalizeRecordOrNull(
	value: unknown,
	expected?: AssistanceDerivativeIdentityV1,
): AssistanceDerivativeRecordV1 | null {
	try {
		const record = closedRecord(value, RECORD_FIELDS, 'assistance derivative record');
		if (record.recordVersion !== ASSISTANCE_DERIVATIVE_RECORD_VERSION
			|| record.schemaVersion !== ASSISTANCE_DERIVATIVE_SCHEMA_VERSION) return null;
		const key = typeof record.key === 'string' ? record.key : '';
		const match = KEY.exec(key);
		if (!match) return null;
		const projectId = domainId(record.projectId, 'assistance derivative project ID');
		const projectScopeSha256 = lowercaseSha256(record.projectScopeSha256);
		const identitySha256 = lowercaseSha256(record.identitySha256);
		if (match[1] !== projectScopeSha256 || match[2] !== identitySha256
			|| projectScope(projectId) !== projectScopeSha256) return null;
		const identity = Object.freeze({
			schemaVersion: ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
			key,
			projectScopeSha256,
			identitySha256,
			projectId,
			kind: derivativeKind(record.kind),
		});
		if (expected && !sameIdentity(identity, expected)) return null;
		const bytes = normalizedBytes(record.bytes);
		const size = nonNegativeInteger(record.size, 'assistance derivative size');
		const payloadByteLength = nonNegativeInteger(
			record.payloadByteLength,
			'assistance derivative payload byte length',
		);
		const payloadSha256 = lowercaseSha256(record.payloadSha256);
		if (size !== bytes.byteLength || payloadByteLength !== bytes.byteLength
			|| payloadSha256 !== digestBytes(bytes)) return null;
		const committedAt = timestamp(record.committedAt);
		return Object.freeze({
			recordVersion: ASSISTANCE_DERIVATIVE_RECORD_VERSION,
			...identity,
			mediaType: normalizedMediaType(record.mediaType),
			size,
			payloadByteLength,
			payloadSha256,
			bytes,
			committedAt,
		});
	} catch {
		return null;
	}
}

function recordView(record: AssistanceDerivativeRecordV1): AssistanceDerivativeRecordV1 {
	return Object.freeze({ ...record, bytes: Uint8Array.from(record.bytes) });
}

function projectKeyPrefix(projectIdValue: unknown): string {
	const projectId = domainId(projectIdValue, 'assistance derivative project ID');
	return `${ASSISTANCE_DERIVATIVE_KEY_PREFIX}${projectScope(projectId)}:`;
}

function projectScope(projectId: string): string {
	return digestBytes(UTF8.encode(JSON.stringify({ schemaVersion: 1, projectId })));
}

function derivativeKind(value: unknown): AssistanceDerivativeKind {
	if (!ASSISTANCE_DERIVATIVE_KINDS.includes(value as AssistanceDerivativeKind)) {
		throw new TypeError('The assistance derivative kind is unsupported.');
	}
	return value as AssistanceDerivativeKind;
}

function derivativeKinds(value: unknown): ReadonlySet<AssistanceDerivativeKind> {
	if (!Array.isArray(value) || value.length > ASSISTANCE_DERIVATIVE_KINDS.length) {
		throw new RangeError('The assistance derivative kind filter is invalid.');
	}
	const result = new Set<AssistanceDerivativeKind>();
	for (const candidate of value) {
		const kind = derivativeKind(candidate);
		if (result.has(kind)) throw new TypeError('The assistance derivative kind filter repeats a kind.');
		result.add(kind);
	}
	return result;
}

function normalizedMediaType(value: unknown): string {
	if (typeof value !== 'string' || !MEDIA_TYPE.test(value)) {
		throw new TypeError('The assistance derivative media type is invalid.');
	}
	return value;
}

function normalizedBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array)) {
		throw new TypeError('The assistance derivative payload must be a Uint8Array.');
	}
	return Uint8Array.from(value);
}

function closedRecord(value: unknown, fields: ReadonlySet<string>, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.size || keys.some((key) => typeof key !== 'string' || !fields.has(key))) {
		throw new TypeError(`The ${label} has unsupported fields.`);
	}
	return value as Record<string, unknown>;
}

function domainId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DOMAIN_ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function lowercaseSha256(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('An assistance derivative needs a lowercase SHA-256 digest.');
	}
	return value;
}

function timestamp(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('An assistance derivative timestamp is required.');
	const milliseconds = Date.parse(value);
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > MAXIMUM_TIMESTAMP
		|| new Date(milliseconds).toISOString() !== value) {
		throw new RangeError('The assistance derivative timestamp is not canonical.');
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`The ${label} is invalid.`);
	return Number(value);
}

function digestBytes(value: Uint8Array): string {
	return bytesToHex(sha256(value));
}

function sameIdentity(left: AssistanceDerivativeIdentityV1, right: AssistanceDerivativeIdentityV1): boolean {
	return left.key === right.key && left.projectScopeSha256 === right.projectScopeSha256
		&& left.identitySha256 === right.identitySha256 && left.projectId === right.projectId
		&& left.kind === right.kind;
}

function samePayload(left: AssistanceDerivativeRecordV1, right: AssistanceDerivativeRecordV1): boolean {
	return left.mediaType === right.mediaType && left.payloadByteLength === right.payloadByteLength
		&& left.payloadSha256 === right.payloadSha256;
}

function assertFits(size: number, limits: NormalizedDerivativeCacheLimits): void {
	if (limits.maximumEntries === 0 || size > limits.maximumBytes || limits.maximumAgeMs === 0) {
		throw new RangeError('The assistance derivative cannot fit within its configured limits.');
	}
}

function isKeyValuePort(
	value: StorageRepositoryPort | AssistanceDerivativeKeyValuePort,
): value is AssistanceDerivativeKeyValuePort {
	return typeof (value as Partial<AssistanceDerivativeKeyValuePort>).listByPrefix === 'function'
		&& typeof (value as Partial<AssistanceDerivativeKeyValuePort>).putIfAbsent === 'function';
}
