/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NativeQueueInputFingerprintV1, NativeQueueRecoveryClass,
	NativeQueueReservationsV1, NativeQueueTaskKind } from '../src/common/editor/native-queue-record.ts';
import type { NativeImageSequenceCheckpointFrameV1 } from './native-services-publication.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_MESSAGE_MAXIMUM_BYTES = 64 * 1024;
const TEXT_ENCODER = new TextEncoder();

export interface FramescaperNativeWatchCreateRequest {
	readonly grantId: string;
	readonly projectId: string;
	readonly binId: string | null;
	readonly extensions: readonly string[];
	readonly importMode: 'link' | 'copy';
	readonly generateProxies: boolean;
}

export interface FramescaperNativeWatchEnabledRequest {
	readonly ruleId: string;
	readonly enabled: boolean;
}

export interface FramescaperNativeQueueEnqueueRequest {
	readonly taskKind: NativeQueueTaskKind;
	readonly planVersion: 7 | 8 | 9 | 10 | 11 | 12;
	readonly derivedInputStageId: string | null;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly reservations: NativeQueueReservationsV1;
	readonly recoveryClass: NativeQueueRecoveryClass;
}

export interface FramescaperNativePublicationLifecycleRequest {
	readonly jobId: string;
	readonly currentPlanFingerprint: string;
	readonly finalized: boolean;
	readonly declaredByteLength: number;
	readonly declaredSha256: string;
}

export interface FramescaperNativeCheckpointLifecycleRequest {
	readonly jobId: string;
	readonly sourceInventoryDigest: string;
	readonly plannedFrameCount: number;
	readonly manifest: readonly NativeImageSequenceCheckpointFrameV1[];
}

export function framescaperNativeWatchCreateRequest(value: unknown): FramescaperNativeWatchCreateRequest {
	const request = closedRecord(value, [
		'grantId', 'projectId', 'binId', 'extensions', 'importMode', 'generateProxies',
	], 'watch create request');
	const extensions = denseStrings(request.extensions, 32, 'watch extensions');
	if (extensions.length === 0) throw new TypeError('A watch create request requires extensions.');
	if (request.importMode !== 'link' && request.importMode !== 'copy') {
		throw new TypeError('A watch create request has an unsupported import mode.');
	}
	if (typeof request.generateProxies !== 'boolean') {
		throw new TypeError('A watch create request must state proxy generation.');
	}
	return Object.freeze({
		grantId: opaqueId(request.grantId, 'watch grant id'),
		projectId: boundedText(request.projectId, 'watch project id'),
		binId: request.binId === null ? null : boundedText(request.binId, 'watch bin id'),
		extensions,
		importMode: request.importMode,
		generateProxies: request.generateProxies,
	});
}

export function framescaperNativeQueueEnqueueRequest(
	value: unknown,
): FramescaperNativeQueueEnqueueRequest {
	const request = closedRecord(value, [
		'taskKind', 'planVersion', 'derivedInputStageId', 'planFingerprint', 'planPayload', 'projectId',
		'projectRevision', 'inputFingerprints', 'rootGrantId', 'relativeDestination',
		'reservations', 'recoveryClass',
	], 'queue enqueue request');
	if (!['encoded-export', 'image-sequence-export', 'proxy-generation'].includes(request.taskKind as string)
		|| ![7, 8, 9, 10, 11, 12].includes(request.planVersion as number)
		|| typeof request.planPayload !== 'string' || request.planPayload.length === 0
		|| TEXT_ENCODER.encode(request.planPayload).byteLength > CONTROL_MESSAGE_MAXIMUM_BYTES) {
		throw new TypeError('A native-services enqueue request has an unsupported plan or task.');
	}
	if ([9, 10, 11, 12].includes(request.planVersion as number)) {
		throw new TypeError(
			`Unified V${String(request.planVersion)} native renders have no durable evaluated RGBA carrier.`,
		);
	}
	if (![7, 8].includes(request.planVersion as number)
		|| request.derivedInputStageId === null) {
		throw new TypeError('Selected-V20 V7/V8 native renders require one durable derived-input stage.');
	}
	return Object.freeze({
		taskKind: request.taskKind as NativeQueueTaskKind,
		planVersion: request.planVersion as FramescaperNativeQueueEnqueueRequest['planVersion'],
		derivedInputStageId: request.derivedInputStageId === null ? null : jobId(request.derivedInputStageId),
		planFingerprint: digest(request.planFingerprint, 'enqueue plan'),
		planPayload: request.planPayload,
		projectId: request.projectId as string,
		projectRevision: request.projectRevision as number,
		inputFingerprints: request.inputFingerprints as readonly NativeQueueInputFingerprintV1[],
		rootGrantId: opaqueId(request.rootGrantId, 'enqueue root grant id'),
		relativeDestination: request.relativeDestination as string,
		reservations: request.reservations as NativeQueueReservationsV1,
		recoveryClass: request.recoveryClass as NativeQueueRecoveryClass,
	});
}

export function framescaperNativeWatchEnabledRequest(value: unknown): FramescaperNativeWatchEnabledRequest {
	const request = closedRecord(value, ['ruleId', 'enabled'], 'watch enabled request');
	if (typeof request.enabled !== 'boolean') throw new TypeError('A watch enabled request must be boolean.');
	return Object.freeze({ ruleId: opaqueId(request.ruleId, 'watch rule id'), enabled: request.enabled });
}

export function framescaperNativePublicationLifecycleRequest(
	value: unknown,
): FramescaperNativePublicationLifecycleRequest {
	const request = closedRecord(value, [
		'jobId', 'currentPlanFingerprint', 'finalized', 'declaredByteLength', 'declaredSha256',
	], 'publication request');
	if (typeof request.finalized !== 'boolean') throw new TypeError('A publication request must state finalization.');
	return Object.freeze({
		jobId: jobId(request.jobId),
		currentPlanFingerprint: digest(request.currentPlanFingerprint, 'current plan'),
		finalized: request.finalized,
		declaredByteLength: nonNegative(request.declaredByteLength, 'declared byte length'),
		declaredSha256: digest(request.declaredSha256, 'declared output'),
	});
}

export function framescaperNativeCheckpointLifecycleRequest(
	value: unknown,
): FramescaperNativeCheckpointLifecycleRequest {
	const request = closedRecord(value, [
		'jobId', 'sourceInventoryDigest', 'plannedFrameCount', 'manifest',
	], 'checkpoint request');
	if (!Array.isArray(request.manifest) || request.manifest.length > 2_000_000) {
		throw new TypeError('A checkpoint request requires a bounded manifest.');
	}
	if (request.manifest.length > CONTROL_MESSAGE_MAXIMUM_BYTES / 4
		|| controlEnvelopeByteLength(request) > CONTROL_MESSAGE_MAXIMUM_BYTES) {
		throw new RangeError('A checkpoint control envelope exceeds 64 KiB.');
	}
	return Object.freeze({
		jobId: jobId(request.jobId),
		sourceInventoryDigest: digest(request.sourceInventoryDigest, 'source inventory'),
		plannedFrameCount: nonNegative(request.plannedFrameCount, 'planned frame count'),
		manifest: Object.freeze([...request.manifest]) as readonly NativeImageSequenceCheckpointFrameV1[],
	});
}

export function framescaperNativeLifecycleIdRequest<
	const Field extends 'grantId' | 'ruleId' | 'jobId'
>(value: unknown, field: Field): Readonly<Record<Field, string>> {
	const request = closedRecord(value, [field], `${field} request`);
	const id = field === 'jobId' ? jobId(request[field]) : opaqueId(request[field], field);
	return Object.freeze({ [field]: id }) as Readonly<Record<Field, string>>;
}

export function framescaperNativeExternalDisplayRequest(
	value: unknown,
): Readonly<{ displayId: string | null }> {
	const request = closedRecord(value, ['displayId'], 'external display request');
	return Object.freeze({
		displayId: request.displayId === null ? null : boundedText(request.displayId, 'display id', 128),
	});
}

export function boundedLifecycleText(value: unknown, label: string, maximum = 128): string {
	return boundedText(value, label, maximum);
}

export function nonNegativeLifecycleInteger(value: unknown, label: string): number {
	return nonNegative(value, label);
}

export function nativeLifecycleOpaqueId(value: unknown, label: string): string {
	return opaqueId(value, label);
}

export function nativeLifecycleJobId(value: unknown): string { return jobId(value); }

function controlEnvelopeByteLength(value: unknown): number {
	let serialized: string | undefined;
	try { serialized = JSON.stringify(value); } catch {
		throw new TypeError('A native-services control envelope must be serializable.');
	}
	if (serialized === undefined) {
		throw new TypeError('A native-services control envelope must be serializable.');
	}
	return TEXT_ENCODER.encode(serialized).byteLength;
}

function closedRecord<const Field extends string>(
	value: unknown, fields: readonly Field[], label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`A native-services ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`A native-services ${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}

function denseStrings(value: unknown, maximum: number, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`A native-services ${label} must be a bounded dense array.`);
	}
	return Object.freeze(value.map((entry) => boundedText(entry, label, 32)));
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError(`A native-services ${label} must be an opaque id.`);
	}
	return value;
}

function jobId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError('A native-services job id is invalid.');
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`A native-services ${label} digest is invalid.`);
	}
	return value;
}

function boundedText(value: unknown, label: string, maximum = 128): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`A native-services ${label} is invalid.`);
	}
	return value;
}

function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`A native-services ${label} is invalid.`);
	}
	return value as number;
}
