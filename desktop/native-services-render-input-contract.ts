/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed control records for authenticated renderer-evaluated media staging. */

import { createHash } from 'node:crypto';

import {
	canonicalizeNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	createNativeMediaPlanEnvelopeV1,
	type NativeMediaPlanEnvelopeV1,
} from '../src/common/editor/native-media-plan-envelope.ts';
import {
	createNativeMediaPlanEnvelopeV2,
	type NativeMediaPlanEnvelopeV2,
} from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { nativeMediaV14RequiresEvaluatedCarrier } from '../src/common/editor/native-media-v14-render-family.ts';
import type { NativeQueueInputFingerprintV1 } from '../src/common/editor/native-queue-record.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	type HelperDataPlaneBinding,
	validateHelperDataPlaneBinding,
} from './helper-data-plane.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_AUDIO_MAXIMUM_BYTES,
	type FramescaperNativeDerivedRenderInputRole,
	type FramescaperNativeRenderInputDescriptorV1,
} from './native-services-render-input-validation.ts';

export const FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_VERSION = 1;
export const FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_MAXIMUM_BYTES = 16 * 1_024 ** 3;
export const FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES = 8;
export const FRAMESCAPER_NATIVE_RENDER_INPUT_TOTAL_MAXIMUM_BYTES = 32 * 1_024 ** 3;
export const FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_EXPIRY_MS = 24 * 60 * 60 * 1_000;

const STAGE_ID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface FramescaperNativeRenderInputStageBeginRequestV1 {
	readonly stageVersion: typeof FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_VERSION;
	readonly planVersion: 7 | 8 | 14;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly derivedInputs: readonly FramescaperNativeRenderInputDescriptorV1[];
}

export type NativeRenderInputEnvelope =
	| (NativeMediaPlanEnvelopeV1 & Readonly<{ readonly planVersion: 7 | 8 }>)
	| (NativeMediaPlanEnvelopeV2 & Readonly<{ readonly planVersion: 14 }>);

export interface FramescaperNativeRenderInputStageAdmissionV1 {
	readonly stageVersion: typeof FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_VERSION;
	readonly stageId: string;
	readonly inputs: readonly Readonly<{
		readonly inputIndex: number;
		readonly role: FramescaperNativeDerivedRenderInputRole;
		readonly binding: HelperDataPlaneBinding;
	}>[];
}

export interface FramescaperNativeRenderInputStageIdentity {
	readonly planFingerprint: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
}

export function nativeRenderInputBeginRequest(
	value: unknown,
): FramescaperNativeRenderInputStageBeginRequestV1 {
	const row = nativeRenderInputClosedRecord(value, [
		'stageVersion', 'planVersion', 'planFingerprint', 'planPayload', 'projectId',
		'projectRevision', 'inputFingerprints', 'derivedInputs',
	], 'render-input stage begin request');
	if (row.stageVersion !== 1 || ![7, 8, 14].includes(row.planVersion as number)
		|| typeof row.planPayload !== 'string') {
		throw new TypeError('Native render-input staging admits only canonical selected V7/V8 or V14 plans.');
	}
	return Object.freeze({
		stageVersion: 1, planVersion: row.planVersion as 7 | 8 | 14,
		planFingerprint: nativeRenderInputDigestValue(row.planFingerprint, 'plan fingerprint'),
		planPayload: row.planPayload,
		projectId: nativeRenderInputIdentifier(row.projectId, 'project id'),
		projectRevision: nativeRenderInputNonNegative(row.projectRevision, 'project revision'),
		inputFingerprints: nativeRenderInputFingerprints(row.inputFingerprints),
		derivedInputs: nativeRenderInputDescriptors(row.derivedInputs),
	});
}

export function nativeRenderInputReceiveRequest(value: unknown) {
	const row = nativeRenderInputClosedRecord(
		value, ['stageId', 'inputIndex', 'binding'], 'render-input stream request',
	);
	return Object.freeze({
		stageId: nativeRenderInputStageId(row.stageId),
		inputIndex: nativeRenderInputNonNegative(row.inputIndex, 'input index'),
		binding: validateHelperDataPlaneBinding(row.binding),
	});
}

export function nativeRenderInputClaimRequest(value: unknown) {
	const row = nativeRenderInputClosedRecord(value, [
		'derivedInputStageId', 'planVersion', 'planFingerprint', 'planPayload',
		'projectId', 'projectRevision', 'inputFingerprints',
	], 'render-input claim request');
	if (![7, 8, 14].includes(row.planVersion as number) || typeof row.planPayload !== 'string') {
		throw new TypeError('A native render-input claim must name its selected V7/V8 or V14 plan.');
	}
	const envelope = nativeRenderInputExactEnvelope(
		row.planPayload,
		nativeRenderInputDigestValue(row.planFingerprint, 'plan fingerprint'),
		row.planVersion as 7 | 8 | 14,
	);
	return Object.freeze({
		derivedInputStageId: nativeRenderInputStageId(row.derivedInputStageId),
		planVersion: envelope.planVersion,
		planFingerprint: envelope.fingerprint,
		planPayload: row.planPayload,
		projectId: nativeRenderInputIdentifier(row.projectId, 'project id'),
		projectRevision: nativeRenderInputNonNegative(row.projectRevision, 'project revision'),
		inputFingerprints: nativeRenderInputFingerprints(row.inputFingerprints),
	});
}

export function nativeRenderInputDescriptorsForPlan(
	value: readonly FramescaperNativeRenderInputDescriptorV1[],
	envelope: NativeRenderInputEnvelope,
): readonly FramescaperNativeRenderInputDescriptorV1[] {
	if (!nativeRenderInputStageRequired(envelope)) {
		throw new TypeError('A silent selected-V20 V8 plan has no derived-input stage.');
	}
	const expected = envelope.planVersion === 7 || envelope.planVersion === 14
		? ['evaluated-rgba-frame-pack', ...(envelope.summary.includesAudio ? ['staged-audio-mix'] : [])]
		: ['staged-audio-mix'];
	if (value.length !== expected.length || value.some(({ role }, index) => role !== expected[index])) {
		throw new TypeError('Selected-V20 derived inputs do not match the canonical plan audio contract.');
	}
	const total = nativeRenderInputDeclaredBytes(value);
	if (total > FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_MAXIMUM_BYTES) {
		throw new RangeError('Selected-V20 derived render inputs exceed their aggregate staging ceiling.');
	}
	return value;
}

export function nativeRenderInputStageRequired(envelope: NativeRenderInputEnvelope): boolean {
	return envelope.planVersion === 14
		? nativeMediaV14RequiresEvaluatedCarrier(envelope.plan)
		: envelope.planVersion === 7 || envelope.summary.includesAudio;
}

export function nativeRenderInputExactEnvelope(
	payload: string,
	fingerprint: string,
	expectedVersion?: 7 | 8 | 14,
): NativeRenderInputEnvelope {
	let plan: unknown;
	try { plan = JSON.parse(payload) as unknown; }
	catch { throw new TypeError('A native render-input plan payload must be JSON.'); }
	const version = (plan as Readonly<{ readonly version?: unknown }> | null)?.version;
	const envelope = version === 14
		? createNativeMediaPlanEnvelopeV2(plan)
		: createNativeMediaPlanEnvelopeV1(plan);
	if ((envelope.planVersion !== 7 && envelope.planVersion !== 8 && envelope.planVersion !== 14)
		|| (expectedVersion !== undefined && envelope.planVersion !== expectedVersion)
		|| canonicalizeNativeMediaPlan(plan) !== payload
		|| envelope.fingerprint !== fingerprint) {
		throw new TypeError('The native render-input plan identity is not exact canonical selected V7/V8/V14.');
	}
	return envelope as NativeRenderInputEnvelope;
}

export function nativeRenderInputExactV20Envelope(
	payload: string,
	fingerprint: string,
	expectedVersion?: 7 | 8,
) {
	const envelope = nativeRenderInputExactEnvelope(payload, fingerprint, expectedVersion);
	if (envelope.planVersion !== 7 && envelope.planVersion !== 8) {
		throw new TypeError('The native render-input plan identity is not exact canonical selected-V20 V7/V8.');
	}
	return envelope;
}

export function nativeRenderInputDataBinding(
	id: string,
	index: number,
	descriptor: FramescaperNativeRenderInputDescriptorV1,
): HelperDataPlaneBinding {
	return Object.freeze({
		dataPlaneVersion: 1,
		transport: 'message-port',
		streamId: nativeRenderInputDigest(
			`${id}:${String(index)}:${descriptor.role}:${descriptor.sha256}`,
		).slice(0, 40),
		direction: 'host-to-helper',
		byteLength: descriptor.byteLength,
		sha256: descriptor.sha256,
		maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES,
		maximumInFlightChunks: 1,
	});
}

export function nativeRenderInputStageBindingDigest(
	identity: FramescaperNativeRenderInputStageIdentity,
	descriptors: readonly FramescaperNativeRenderInputDescriptorV1[],
): string {
	return nativeRenderInputDigest(JSON.stringify({ ...identity, descriptors }));
}

export function nativeRenderInputStageIdentityDigest(
	identity: FramescaperNativeRenderInputStageIdentity,
): string {
	return nativeRenderInputDigest(JSON.stringify(identity));
}

export function nativeRenderInputDeclaredBytes(
	descriptors: readonly FramescaperNativeRenderInputDescriptorV1[],
): number {
	return descriptors.reduce(
		(sum, descriptor) => nativeRenderInputSafeSum(sum, descriptor.byteLength), 0,
	);
}

export function nativeRenderInputStageIdRequest(
	value: unknown,
	label: string,
): Readonly<{ stageId: string }> {
	const row = nativeRenderInputClosedRecord(value, ['stageId'], `render-input ${label}`);
	return Object.freeze({ stageId: nativeRenderInputStageId(row.stageId) });
}

export function nativeRenderInputFingerprints(
	value: unknown,
): readonly NativeQueueInputFingerprintV1[] {
	if (!Array.isArray(value) || value.length > 4_096
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Native render-input original fingerprints must be a bounded dense array.');
	}
	const ids = new Set<string>();
	return Object.freeze(value.map((entry) => {
		const row = nativeRenderInputClosedRecord(
			entry, ['sourceId', 'sha256'], 'original input fingerprint',
		);
		const sourceId = nativeRenderInputIdentifier(row.sourceId, 'source id');
		if (ids.has(sourceId)) throw new Error('A native render-input source identity is duplicated.');
		ids.add(sourceId);
		return Object.freeze({
			sourceId,
			sha256: nativeRenderInputDigestValue(row.sha256, 'original input'),
		});
	}));
}

export function nativeRenderInputStageId(value: unknown): string {
	if (typeof value !== 'string' || !STAGE_ID.test(value)) {
		throw new TypeError('A native render-input stage id is invalid.');
	}
	return value;
}

export function nativeRenderInputDigestValue(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`A native ${label} digest is invalid.`);
	}
	return value;
}

export function nativeRenderInputIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) {
		throw new TypeError(`A native ${label} is invalid.`);
	}
	return value;
}

export function nativeRenderInputNonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`A native ${label} is invalid.`);
	}
	return Number(value);
}

export function nativeRenderInputPositive(value: unknown, label: string): number {
	const result = nativeRenderInputNonNegative(value, label);
	if (result === 0) throw new RangeError(`A native ${label} must be positive.`);
	return result;
}

export function nativeRenderInputSafeSum(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('Native render-input bytes overflowed.');
	}
	return left + right;
}

export function nativeRenderInputClosedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`A native ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`A native ${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

export function nativeRenderInputDigest(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function nativeRenderInputDescriptors(
	value: unknown,
): readonly FramescaperNativeRenderInputDescriptorV1[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 2
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('A selected-V20 render-input stage requires one or two exact derived inputs.');
	}
	return Object.freeze(value.map((entry) => {
		const row = nativeRenderInputClosedRecord(
			entry, ['role', 'byteLength', 'sha256'], 'derived input descriptor',
		);
		if (row.role !== 'evaluated-rgba-frame-pack' && row.role !== 'staged-audio-mix') {
			throw new TypeError('A native render-input descriptor has an unsupported role.');
		}
		const byteLength = nativeRenderInputPositive(row.byteLength, 'derived input byte length');
		if (row.role === 'staged-audio-mix'
			&& byteLength > FRAMESCAPER_NATIVE_RENDER_AUDIO_MAXIMUM_BYTES) {
			throw new RangeError('A staged audio mix exceeds its hard byte ceiling.');
		}
		return Object.freeze({
			role: row.role,
			byteLength,
			sha256: nativeRenderInputDigestValue(row.sha256, 'input'),
		});
	}));
}
