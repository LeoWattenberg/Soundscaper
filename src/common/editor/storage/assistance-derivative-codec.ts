/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import { compareCodeUnits } from '../code-unit-order.ts';
import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from '../project-schema-identity.ts';

export const ASSISTANCE_DERIVATIVE_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_DERIVATIVE_RECORD_VERSION = 1 as const;
export const ASSISTANCE_DERIVATIVE_KEY_PREFIX = 'assistance-derivative-v1:' as const;
export const ASSISTANCE_DERIVATIVE_INVENTORY_KEY = 'assistance-derivative-inventory-v1' as const;
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
	readonly derivativeVersion: typeof ASSISTANCE_DERIVATIVE_SCHEMA_VERSION;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
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

export interface AssistanceDerivativeBatchEntryV1 {
	readonly kind: AssistanceDerivativeKind;
	readonly payload: AssistanceDerivativePayloadV1;
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

export interface AssistanceDerivativeInventoryEntryV1 {
	readonly key: string;
	readonly kind: AssistanceDerivativeKind;
	readonly size: number;
	readonly committedAt: string;
}

export interface AssistanceDerivativeInventoryV1 {
	readonly inventoryVersion: 1;
	readonly entries: readonly AssistanceDerivativeInventoryEntryV1[];
}

const RECORD_FIELDS = new Set([
	'recordVersion', 'derivativeVersion', 'schemaFamily', 'schemaVersion',
	'key', 'projectScopeSha256', 'identitySha256',
	'projectId', 'kind', 'mediaType', 'size', 'payloadByteLength', 'payloadSha256',
	'bytes', 'committedAt',
]);
const INVENTORY_FIELDS = new Set(['inventoryVersion', 'entries']);
const INVENTORY_ENTRY_FIELDS = new Set(['key', 'kind', 'size', 'committedAt']);
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
	const kind = assistanceDerivativeKind(kindValue);
	const projectScopeSha256 = projectScope(workflow.fence.projectId);
	const descriptor = identityDescriptor(workflow, kind);
	const identitySha256 = digestBytes(UTF8.encode(JSON.stringify(descriptor)));
	return Object.freeze({
		derivativeVersion: ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
		schemaFamily: workflow.fence.schemaFamily,
		schemaVersion: workflow.fence.schemaVersion,
		key: `${ASSISTANCE_DERIVATIVE_KEY_PREFIX}${projectScopeSha256}:${identitySha256}`,
		projectScopeSha256,
		identitySha256,
		projectId: workflow.fence.projectId,
		kind,
	});
}

export function assistanceDerivativeBatchEntries(
	value: unknown,
): readonly AssistanceDerivativeBatchEntryV1[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > ASSISTANCE_DERIVATIVE_KINDS.length) {
		throw new RangeError('An assistance derivative batch has an invalid entry count.');
	}
	const kinds = new Set<AssistanceDerivativeKind>();
	return Object.freeze(value.map((candidate) => {
		const entry = closedRecord(candidate, new Set(['kind', 'payload']), 'assistance derivative batch entry');
		const kind = assistanceDerivativeKind(entry.kind);
		if (kinds.has(kind)) throw new TypeError('An assistance derivative batch repeats a kind.');
		kinds.add(kind);
		return Object.freeze({ kind, payload: entry.payload as AssistanceDerivativePayloadV1 });
	}));
}

export function createAssistanceDerivativeRecord(
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
	const bytes = Uint8Array.from(requiredBytes(payloadValue.bytes));
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

export function normalizeAssistanceDerivativeRecordOrNull(
	value: unknown,
	expected?: AssistanceDerivativeIdentityV1,
): AssistanceDerivativeRecordV1 | null {
	try {
		const record = closedRecord(value, RECORD_FIELDS, 'assistance derivative record');
		if (record.recordVersion !== ASSISTANCE_DERIVATIVE_RECORD_VERSION
			|| record.derivativeVersion !== ASSISTANCE_DERIVATIVE_SCHEMA_VERSION) return null;
		const projectIdentity = readProjectSchemaIdentity(record);
		if (projectIdentity.schemaVersion !== PROJECT_SCHEMA_VERSION) return null;
		const key = typeof record.key === 'string' ? record.key : '';
		const match = KEY.exec(key);
		if (!match) return null;
		const projectId = domainId(record.projectId, 'assistance derivative project ID');
		const projectScopeSha256 = lowercaseSha256(record.projectScopeSha256);
		const identitySha256 = lowercaseSha256(record.identitySha256);
		if (match[1] !== projectScopeSha256 || match[2] !== identitySha256
			|| projectScope(projectId) !== projectScopeSha256) return null;
		const identity = Object.freeze({
			derivativeVersion: ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
			schemaFamily: projectIdentity.schemaFamily,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			key,
			projectScopeSha256,
			identitySha256,
			projectId,
			kind: assistanceDerivativeKind(record.kind),
		});
		if (expected && !sameIdentity(identity, expected)) return null;
		const bytes = requiredBytes(record.bytes);
		const size = nonNegativeInteger(record.size, 'assistance derivative size');
		const payloadByteLength = nonNegativeInteger(
			record.payloadByteLength,
			'assistance derivative payload byte length',
		);
		const payloadSha256 = lowercaseSha256(record.payloadSha256);
		if (size !== bytes.byteLength || payloadByteLength !== bytes.byteLength
			|| payloadSha256 !== digestBytes(bytes)) return null;
		const committedAt = canonicalTimestamp(record.committedAt);
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

export function assistanceDerivativeRecordView(
	record: AssistanceDerivativeRecordV1,
): AssistanceDerivativeRecordV1 {
	return Object.freeze({ ...record, bytes: Uint8Array.from(record.bytes) });
}

export function assistanceDerivativeProjectKeyPrefix(projectIdValue: unknown): string {
	const projectId = domainId(projectIdValue, 'assistance derivative project ID');
	return `${ASSISTANCE_DERIVATIVE_KEY_PREFIX}${projectScope(projectId)}:`;
}

export function assistanceDerivativeKind(value: unknown): AssistanceDerivativeKind {
	if (!ASSISTANCE_DERIVATIVE_KINDS.includes(value as AssistanceDerivativeKind)) {
		throw new TypeError('The assistance derivative kind is unsupported.');
	}
	return value as AssistanceDerivativeKind;
}

export function assistanceDerivativeKinds(value: unknown): ReadonlySet<AssistanceDerivativeKind> {
	if (!Array.isArray(value) || value.length > ASSISTANCE_DERIVATIVE_KINDS.length) {
		throw new RangeError('The assistance derivative kind filter is invalid.');
	}
	const result = new Set<AssistanceDerivativeKind>();
	for (const candidate of value) {
		const kind = assistanceDerivativeKind(candidate);
		if (result.has(kind)) throw new TypeError('The assistance derivative kind filter repeats a kind.');
		result.add(kind);
	}
	return result;
}

export function assistanceDerivativeInventoryEntry(
	record: AssistanceDerivativeRecordV1,
): AssistanceDerivativeInventoryEntryV1 {
	return Object.freeze({
		key: record.key,
		kind: record.kind,
		size: record.size,
		committedAt: record.committedAt,
	});
}

export function emptyAssistanceDerivativeInventory(): AssistanceDerivativeInventoryV1 {
	return assistanceDerivativeInventory([]);
}

export function assistanceDerivativeInventory(
	entriesValue: readonly AssistanceDerivativeInventoryEntryV1[],
): AssistanceDerivativeInventoryV1 {
	if (entriesValue.length > ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES) {
		throw new RangeError('The assistance derivative inventory exceeds its entry bound.');
	}
	const entries = [...entriesValue].sort((left, right) => compareCodeUnits(left.key, right.key));
	if (new Set(entries.map(({ key }) => key)).size !== entries.length) {
		throw new TypeError('The assistance derivative inventory repeats a key.');
	}
	return Object.freeze({
		inventoryVersion: 1,
		entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
	});
}

export function normalizeAssistanceDerivativeInventoryOrNull(
	value: unknown,
): AssistanceDerivativeInventoryV1 | null {
	try {
		const inventory = closedRecord(value, INVENTORY_FIELDS, 'assistance derivative inventory');
		if (inventory.inventoryVersion !== 1 || !Array.isArray(inventory.entries)
			|| inventory.entries.length > ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES) return null;
		const entries = inventory.entries.map((candidate) => {
			const entry = closedRecord(
				candidate, INVENTORY_ENTRY_FIELDS, 'assistance derivative inventory entry',
			);
			const key = typeof entry.key === 'string' ? entry.key : '';
			if (!KEY.test(key)) throw new TypeError('An assistance derivative inventory key is invalid.');
			return Object.freeze({
				key,
				kind: assistanceDerivativeKind(entry.kind),
				size: nonNegativeInteger(entry.size, 'assistance derivative inventory size'),
				committedAt: canonicalTimestamp(entry.committedAt),
			});
		});
		return assistanceDerivativeInventory(entries);
	} catch {
		return null;
	}
}

export function assistanceDerivativeInventoryWithEntry(
	inventory: AssistanceDerivativeInventoryV1,
	entry: AssistanceDerivativeInventoryEntryV1,
): AssistanceDerivativeInventoryV1 {
	return assistanceDerivativeInventory([
		...inventory.entries.filter(({ key }) => key !== entry.key),
		entry,
	]);
}

export function assistanceDerivativeInventoryEntriesWith(
	inventory: AssistanceDerivativeInventoryV1,
	entries: readonly AssistanceDerivativeInventoryEntryV1[],
): readonly AssistanceDerivativeInventoryEntryV1[] {
	const keys = new Set(entries.map(({ key }) => key));
	return Object.freeze([...inventory.entries.filter(({ key }) => !keys.has(key)), ...entries]);
}

export function assistanceDerivativeInventoryWithoutKey(
	inventory: AssistanceDerivativeInventoryV1,
	key: string,
): AssistanceDerivativeInventoryV1 {
	return assistanceDerivativeInventory(inventory.entries.filter((entry) => entry.key !== key));
}

export function sameAssistanceDerivativeInventoryEntry(
	left: AssistanceDerivativeInventoryEntryV1,
	right: AssistanceDerivativeInventoryEntryV1,
): boolean {
	return left.key === right.key && left.kind === right.kind && left.size === right.size
		&& left.committedAt === right.committedAt;
}

export function sameAssistanceDerivativePayload(
	left: AssistanceDerivativeRecordV1,
	right: AssistanceDerivativeRecordV1,
): boolean {
	return left.mediaType === right.mediaType && left.payloadByteLength === right.payloadByteLength
		&& left.payloadSha256 === right.payloadSha256;
}

export function assistanceDerivativeEvictionRecord(
	record: AssistanceDerivativeInventoryEntryV1,
): Readonly<{ key: string; size: number; committedAt: string }> {
	return Object.freeze({ key: record.key, size: record.size, committedAt: record.committedAt });
}

export function assistanceDerivativeTimestamp(value: unknown): number {
	const timestamp = Number(value);
	if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAXIMUM_TIMESTAMP) {
		throw new RangeError('The assistance derivative timestamp is outside the supported Date range.');
	}
	return timestamp;
}

function identityDescriptor(workflow: AssistanceWorkflowV1, kind: AssistanceDerivativeKind): unknown {
	const fence = workflow.fence;
	return {
		derivativeVersion: ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
		schemaFamily: fence.schemaFamily,
		schemaVersion: fence.schemaVersion,
		projectId: fence.projectId,
		...(kind === 'reframe-path' ? { projectRevision: fence.revision } : {}),
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
		models: [...workflow.models].sort((left, right) => compareCodeUnits(left.stageId, right.stageId)
			|| compareCodeUnits(left.slotId, right.slotId)),
	};
}

function projectScope(projectId: string): string {
	return digestBytes(UTF8.encode(JSON.stringify({ schemaVersion: 1, projectId })));
}

function normalizedMediaType(value: unknown): string {
	if (typeof value !== 'string' || !MEDIA_TYPE.test(value)) {
		throw new TypeError('The assistance derivative media type is invalid.');
	}
	return value;
}

function requiredBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array)) {
		throw new TypeError('The assistance derivative payload must be a Uint8Array.');
	}
	return value;
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

function canonicalTimestamp(value: unknown): string {
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
		&& left.schemaFamily === right.schemaFamily && left.schemaVersion === right.schemaVersion
		&& left.kind === right.kind;
}
