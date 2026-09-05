/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed renderer/main control records for one trailer-authenticated V14 carrier. */

import { nativeRgbaFramePackV1ByteLength } from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import type { NativeQueueInputFingerprintV1 } from '../src/common/editor/native-queue-record.ts';
import type { FramescaperNativeLiveRenderInputRoleV1 } from
	'../src/common/editor/framescaper-native-live-render-role-v1.ts';
import {
	nativeRenderInputClosedRecord,
	nativeRenderInputDigestValue,
	nativeRenderInputExactEnvelope,
	nativeRenderInputFingerprints,
	nativeRenderInputIdentifier,
	nativeRenderInputNonNegative,
	nativeRenderInputPositive,
	nativeRenderInputStageId,
	type FramescaperNativeRenderInputStageIdentity,
} from './native-services-render-input-contract.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
} from './helper-data-plane.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';

export const FRAMESCAPER_NATIVE_LIVE_RENDER_INPUT_VERSION = 1;

export interface FramescaperNativeLiveRenderInputBeginRequestV1 {
	readonly liveRenderVersion: typeof FRAMESCAPER_NATIVE_LIVE_RENDER_INPUT_VERSION;
	readonly schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly planVersion: 14;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly restartJobId: string | null;
	readonly carrierByteLength: number;
	readonly audio: Readonly<{
		readonly role: 'staged-audio-mix';
		readonly byteLength: number;
	}> | null;
}

export interface FramescaperNativeLiveRenderInputAdmissionV1 {
	readonly liveRenderVersion: typeof FRAMESCAPER_NATIVE_LIVE_RENDER_INPUT_VERSION;
	readonly stageId: string;
	readonly carrierByteLength: number;
	/** Exact main-owned durable bytes required for hardware-to-CPU replay. */
	readonly scratchByteLength: number;
	readonly streams: readonly Readonly<{
		readonly role: FramescaperNativeLiveRenderInputRoleV1;
		readonly byteLength: number;
	}>[];
}

export interface FramescaperNativeLiveRenderInputControl {
	readonly request: FramescaperNativeLiveRenderInputBeginRequestV1;
	readonly identity: FramescaperNativeRenderInputStageIdentity;
	readonly envelope: ReturnType<typeof nativeRenderInputExactEnvelope> & Readonly<{ planVersion: 14 }>;
}

export function framescaperNativeLiveRenderInputBeginRequest(
	value: unknown,
): FramescaperNativeLiveRenderInputControl {
	const projectIdentity = readProjectSchemaIdentity(value);
	if (projectIdentity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| projectIdentity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Live render-input staging requires the current Framescaper schema.');
	}
	const row = nativeRenderInputClosedRecord(value, [
		'liveRenderVersion', 'schemaFamily', 'schemaVersion', 'planVersion',
		'planFingerprint', 'planPayload', 'projectId',
		'projectRevision', 'inputFingerprints', 'restartJobId', 'carrierByteLength', 'audio',
	], 'live render-input begin request');
	if (row.liveRenderVersion !== 1 || row.planVersion !== 14 || typeof row.planPayload !== 'string') {
		throw new TypeError('Live render-input staging admits only exact selected V14 plans.');
	}
	const planFingerprint = nativeRenderInputDigestValue(row.planFingerprint, 'live plan');
	const envelope = nativeRenderInputExactEnvelope(row.planPayload, planFingerprint, 14);
	if (envelope.planVersion !== 14) throw new TypeError('A live render-input plan must be V14.');
	const expectedBytes = nativeRgbaFramePackV1ByteLength({
		width: envelope.summary.width,
		height: envelope.summary.height,
		frameCount: envelope.summary.outputFrameCount,
	});
	const carrierByteLength = nativeRenderInputPositive(row.carrierByteLength, 'live carrier byte length');
	if (carrierByteLength !== expectedBytes) {
		throw new Error('The live RGBA carrier length disagrees with its immutable V14 plan.');
	}
	const audio = audioDescriptor(row.audio);
	if ((audio !== null) !== envelope.summary.includesAudio) {
		throw new Error('The live V14 audio stage disagrees with its immutable plan.');
	}
	const identity = Object.freeze({
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		planFingerprint,
		projectId: nativeRenderInputIdentifier(row.projectId, 'project id'),
		projectRevision: nativeRenderInputNonNegative(row.projectRevision, 'project revision'),
		inputFingerprints: nativeRenderInputFingerprints(row.inputFingerprints),
	});
	const request = Object.freeze({
		liveRenderVersion: 1 as const, schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION, planVersion: 14 as const,
		planFingerprint, planPayload: row.planPayload,
		projectId: identity.projectId, projectRevision: identity.projectRevision,
		inputFingerprints: identity.inputFingerprints,
		restartJobId: row.restartJobId === null ? null : nativeRenderInputStageId(row.restartJobId),
		carrierByteLength, audio,
	});
	return Object.freeze({ request, identity, envelope });
}

export function framescaperNativeLiveRenderInputChunkRequest(value: unknown): Readonly<{
	readonly stageId: string;
	readonly role: FramescaperNativeLiveRenderInputRoleV1;
	readonly sequence: number;
	readonly offset: number;
	readonly bytes: Uint8Array<ArrayBuffer>;
}> {
	const row = nativeRenderInputClosedRecord(
		value, ['stageId', 'role', 'sequence', 'offset', 'bytes'], 'live render-input chunk request',
	);
	if (!liveRole(row.role) || !(row.bytes instanceof Uint8Array) || row.bytes.byteLength < 1) {
		throw new TypeError('A live render-input chunk must carry bytes.');
	}
	if (row.bytes.byteLength > HELPER_DATA_CHUNK_MAXIMUM_BYTES) {
		throw new RangeError('A live render-input chunk exceeds the 16 MiB data-plane limit.');
	}
	return Object.freeze({
		stageId: nativeRenderInputStageId(row.stageId),
		role: row.role,
		sequence: nativeRenderInputNonNegative(row.sequence, 'live chunk sequence'),
		offset: nativeRenderInputNonNegative(row.offset, 'live chunk offset'),
		bytes: new Uint8Array(row.bytes),
	});
}

export function framescaperNativeLiveRenderInputCompletionRequest(value: unknown): Readonly<{
	readonly stageId: string;
	readonly role: FramescaperNativeLiveRenderInputRoleV1;
	readonly byteLength: number;
	readonly sha256: string;
}> {
	const row = nativeRenderInputClosedRecord(
		value, ['stageId', 'role', 'byteLength', 'sha256'], 'live render-input completion request',
	);
	if (!liveRole(row.role)) throw new TypeError('A live completion must name an exact input role.');
	return Object.freeze({
		stageId: nativeRenderInputStageId(row.stageId),
		role: row.role,
		byteLength: nativeRenderInputPositive(row.byteLength, 'live carrier completion length'),
		sha256: nativeRenderInputDigestValue(row.sha256, 'live carrier completion'),
	});
}

function liveRole(value: unknown): value is FramescaperNativeLiveRenderInputRoleV1 {
	return value === 'evaluated-rgba-frame-pack' || value === 'staged-audio-mix';
}

function audioDescriptor(value: unknown): Readonly<{
	readonly role: 'staged-audio-mix';
	readonly byteLength: number;
}> | null {
	if (value === null) return null;
	const row = nativeRenderInputClosedRecord(
		value, ['role', 'byteLength'], 'live staged-audio reservation',
	);
	const byteLength = nativeRenderInputPositive(row.byteLength, 'live audio byte length');
	if (row.role !== 'staged-audio-mix' || byteLength > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
		throw new RangeError('A live render stage admits only one trailer-authenticated audio reservation.');
	}
	return Object.freeze({ role: 'staged-audio-mix', byteLength });
}
