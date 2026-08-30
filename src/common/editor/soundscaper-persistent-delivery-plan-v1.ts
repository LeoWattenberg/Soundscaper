/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintSoundscaperDeliveryPlanV1 } from './soundscaper-delivery-contract-v1.ts';
import {
	DELIVERY_BATCH_TARGET_KINDS,
	type DeliveryBatchMember,
	type DeliveryBatchTarget,
} from './delivery-batch.ts';

export interface SoundscaperPersistentDeliveryBatchAuthorityV1 {
	readonly batchId: string;
	readonly memberId: string;
	readonly presetId: string;
	readonly target: DeliveryBatchTarget;
	readonly mode: 'mix' | 'stems';
}

export interface SoundscaperPersistentAudioDeliveryPlanV1 {
	readonly kind: 'soundscaper-persistent-audio-delivery-plan';
	readonly version: 1;
	readonly executor: 'ordinary-audio-export-v1';
	readonly settings: Readonly<Record<string, unknown>>;
	/** The normalized project-bound plan consumed by the ordinary export executor. */
	readonly exportPlan: Readonly<Record<string, unknown>>;
	readonly batch: SoundscaperPersistentDeliveryBatchAuthorityV1 | null;
}

export function createSoundscaperPersistentAudioDeliveryPlanV1(input: Readonly<{
	settings: Readonly<Record<string, unknown>>;
	exportPlan: Readonly<Record<string, unknown>>;
	batch?: SoundscaperPersistentDeliveryBatchAuthorityV1 | null;
}>): SoundscaperPersistentAudioDeliveryPlanV1 {
	return validateSoundscaperPersistentAudioDeliveryPlanV1({
		kind: 'soundscaper-persistent-audio-delivery-plan',
		version: 1,
		executor: 'ordinary-audio-export-v1',
		settings: input?.settings,
		exportPlan: input?.exportPlan,
		batch: input?.batch ?? null,
	});
}

export function validateSoundscaperPersistentAudioDeliveryPlanV1(
	value: unknown,
): SoundscaperPersistentAudioDeliveryPlanV1 {
	const row = closedRecord(
		value,
		['kind', 'version', 'executor', 'settings', 'exportPlan', 'batch'] as const,
		'persistent audio delivery plan',
	);
	if (row.kind !== 'soundscaper-persistent-audio-delivery-plan' || row.version !== 1
		|| row.executor !== 'ordinary-audio-export-v1') {
		throw new TypeError('The persistent audio delivery plan version or executor is unsupported.');
	}
	const fingerprint = fingerprintSoundscaperDeliveryPlanV1(row);
	const snapshot = JSON.parse(fingerprint.canonical) as SoundscaperPersistentAudioDeliveryPlanV1;
	closedRecord(snapshot.settings, Reflect.ownKeys(snapshot.settings) as string[], 'delivery settings');
	closedRecord(snapshot.exportPlan, Reflect.ownKeys(snapshot.exportPlan) as string[], 'exact export plan');
	return deepFreeze({
		...snapshot,
		batch: snapshot.batch === null ? null : validateBatch(snapshot.batch),
	}) as SoundscaperPersistentAudioDeliveryPlanV1;
}

/** Clone, close, bound and canonicalize the exact member persisted beside a plan. */
export function validateSoundscaperPersistentDeliveryBatchMemberV1(
	value: unknown,
): DeliveryBatchMember {
	const row = closedRecord(
		value,
		['memberId', 'label', 'presetId', 'target', 'mode', 'settings'] as const,
		'persistent delivery batch member',
	);
	const candidate = {
		memberId: boundedText(row.memberId, 'memberId'),
		label: boundedText(row.label, 'label'),
		presetId: boundedText(row.presetId, 'presetId'),
		target: validateTarget(row.target),
		mode: batchMode(row.mode),
		settings: canonicalRecord(row.settings, 'batch member settings'),
	};
	return deepFreeze(canonicalValue(candidate, 'batch member')) as DeliveryBatchMember;
}

function validateBatch(value: unknown): SoundscaperPersistentDeliveryBatchAuthorityV1 {
	const row = closedRecord(
		value,
		['batchId', 'memberId', 'presetId', 'target', 'mode'] as const,
		'persistent delivery batch authority',
	);
	for (const field of ['batchId', 'memberId', 'presetId'] as const) boundedText(row[field], field);
	return Object.freeze({
		batchId: row.batchId,
		memberId: row.memberId,
		presetId: row.presetId,
		target: validateTarget(row.target),
		mode: batchMode(row.mode),
	}) as SoundscaperPersistentDeliveryBatchAuthorityV1;
}

function validateTarget(value: unknown): DeliveryBatchTarget {
	const candidate = closedRecord(
		value,
		Object.hasOwn((value ?? {}) as object, 'id') ? ['kind', 'id'] as const : ['kind'] as const,
		'persistent delivery batch target',
	);
	if (typeof candidate.kind !== 'string'
		|| !(DELIVERY_BATCH_TARGET_KINDS as readonly string[]).includes(candidate.kind)) {
		throw new TypeError('The persistent delivery batch target kind is invalid.');
	}
	const needsId = candidate.kind === 'region' || candidate.kind === 'mastering-sequence';
	if (needsId !== Object.hasOwn(candidate, 'id')) {
		throw new TypeError('The persistent delivery batch target id contract is invalid.');
	}
	return Object.freeze({
		kind: candidate.kind,
		...(needsId ? { id: boundedText(candidate.id, 'target id') } : {}),
	}) as DeliveryBatchTarget;
}

function batchMode(value: unknown): 'mix' | 'stems' {
	if (value !== 'mix' && value !== 'stems') {
		throw new TypeError('The persistent delivery batch mode is invalid.');
	}
	return value;
}

function canonicalRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	const canonical = canonicalValue(value, label);
	closedRecord(canonical, Reflect.ownKeys(canonical as object) as string[], label);
	return canonical as Readonly<Record<string, unknown>>;
}

function canonicalValue(value: unknown, label: string): unknown {
	try {
		return JSON.parse(fingerprintSoundscaperDeliveryPlanV1(value).canonical) as unknown;
	} catch (error) {
		throw new TypeError(`The persistent delivery ${label} is not bounded canonical JSON.`, { cause: error });
	}
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}

function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || /[\0-\x1f]/u.test(value)
		|| new TextEncoder().encode(value).byteLength > 1_024) {
		throw new TypeError(`The persistent delivery ${label} is invalid.`);
	}
	return value;
}

function deepFreeze(value: unknown): unknown {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
	return Object.freeze(value);
}
