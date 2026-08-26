/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated renderer-to-controller custody for reviewed enhancement and TIGER WAVs. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { AssistanceSelectionFence } from '../assistance/proposal-session.ts';
import { validateAssistanceSelectionFence } from '../assistance/proposal-session.ts';
import { inspectWavBlobPcm } from '../wav-import.js';
import { localAssistanceCanonicalWaveByteLength } from
	'./local-assistance-audio-geometry.ts';

export type LocalAssistanceAudioOperation = 'speech-enhancement' | 'source-separation';
export type LocalAssistanceAudioOutputSlot = 'enhanced-audio' | 'dialogue' | 'music' | 'effects';

export interface LocalAssistanceAudioModelBinding {
	readonly modelId: 'deepfilternet3' | 'tiger-dnr';
	readonly version: '3.0.0' | '1.0.0';
	readonly task: LocalAssistanceAudioOperation;
	readonly artifactSha256s: readonly string[];
}

export interface LocalAssistanceAudioOutputClaim {
	readonly claimVersion: 1;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: 'enhanced-audio' | 'separated-audio';
	readonly mediaType: 'audio/wav';
	readonly byteLength: number;
	readonly sha256: string;
}

export interface LocalAssistanceAudioWaveReview {
	readonly kind: 'audio-wave';
	readonly role: 'enhanced-audio' | 'separated-audio';
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly sampleFormat: 'float32';
}

export interface LocalAssistanceAudioReviewedOutput {
	readonly slotId: LocalAssistanceAudioOutputSlot;
	readonly claim: LocalAssistanceAudioOutputClaim;
	readonly review: LocalAssistanceAudioWaveReview;
	readonly bytes: Blob;
}

export interface LocalAssistanceAudioResultRequest {
	readonly sourceId: string;
	readonly operation: LocalAssistanceAudioOperation;
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly [LocalAssistanceAudioModelBinding];
	readonly outputs: readonly LocalAssistanceAudioReviewedOutput[];
}

export interface NormalizedLocalAssistanceAudioResult extends LocalAssistanceAudioResultRequest {
	readonly fingerprint: string;
}

interface RequestDescriptor extends LocalAssistanceAudioResultRequest {
	readonly fingerprint: string;
}

const REQUEST_FIELDS = Object.freeze([
	'sourceId', 'operation', 'selectionFence', 'models', 'outputs',
]);
const OUTPUT_FIELDS = Object.freeze(['slotId', 'claim', 'review', 'bytes']);
const MODEL_FIELDS = Object.freeze(['modelId', 'version', 'task', 'artifactSha256s']);
const CLAIM_FIELDS = Object.freeze([
	'claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256',
]);
const REVIEW_FIELDS = Object.freeze([
	'kind', 'role', 'sampleRate', 'channelCount', 'frameCount', 'sampleFormat',
]);
const OUTPUT_PROFILES = Object.freeze({
	'speech-enhancement': Object.freeze({
		modelId: 'deepfilternet3', version: '3.0.0', role: 'enhanced-audio',
		sampleRate: 48_000, slots: Object.freeze(['enhanced-audio']),
	}),
	'source-separation': Object.freeze({
		modelId: 'tiger-dnr', version: '1.0.0', role: 'separated-audio',
		sampleRate: 44_100, slots: Object.freeze(['dialogue', 'music', 'effects']),
	}),
} as const);
const SLOT_ORDER = new Map<LocalAssistanceAudioOutputSlot, number>([
	['enhanced-audio', 0], ['dialogue', 0], ['music', 1], ['effects', 2],
]);
const OPAQUE_ID = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;

/** Re-review immutable Blobs and bind each one to its exact claim, geometry, model, and stem slot. */
export async function normalizeLocalAssistanceAudioResult(
	value: unknown,
): Promise<NormalizedLocalAssistanceAudioResult> {
	const descriptor = normalizeDescriptor(value);
	await Promise.all(descriptor.outputs.map(authenticateOutput));
	return Object.freeze({ ...descriptor });
}

/** Refuse renderer-side mutation while asynchronous capacity and source publication are in flight. */
export function assertLocalAssistanceAudioResultCurrent(
	value: unknown,
	expected: NormalizedLocalAssistanceAudioResult,
): void {
	const current = normalizeDescriptor(value);
	if (current.fingerprint !== expected.fingerprint
		|| current.outputs.some((output, index) => output.bytes !== expected.outputs[index]!.bytes)) {
		throw new Error('The reviewed assistance audio result changed before publication.');
	}
}

async function authenticateOutput(output: LocalAssistanceAudioReviewedOutput): Promise<void> {
	const digest = await digestBlob(output.bytes);
	if (digest !== output.claim.sha256) {
		throw new Error('The reviewed assistance audio Blob digest disagrees with its authenticated claim.');
	}
	await assertCanonicalFloat32Wave(output.bytes, output.review);
	await assertFiniteFloat32Body(output.bytes);
}

async function assertCanonicalFloat32Wave(
	body: Blob,
	review: LocalAssistanceAudioWaveReview,
): Promise<void> {
	const descriptor = await inspectWavBlobPcm(body) as Readonly<{
		container: string; encoding: string; sampleFormat: string;
		formatTag: number; subFormatTag: number; sampleRate: number; channelCount: number;
		frameCount: number; bitDepth: number; validBitsPerSample: number; bytesPerSample: number;
		dataOffset: number; dataByteLength: number; riffByteLength: number; sourceByteLength: number;
	}>;
	if (descriptor.container !== 'wav' || descriptor.encoding !== 'ieee-float'
		|| descriptor.sampleFormat !== 'float32' || descriptor.formatTag !== 3
		|| descriptor.subFormatTag !== 3 || descriptor.bitDepth !== 32
		|| descriptor.validBitsPerSample !== 32 || descriptor.bytesPerSample !== 4) {
		throw new TypeError('The assistance audio result must be a Float32 WAV.');
	}
	if (descriptor.sampleRate !== review.sampleRate || descriptor.channelCount !== review.channelCount
		|| descriptor.frameCount !== review.frameCount) {
		throw new RangeError('The assistance audio Blob no longer matches its reviewed geometry.');
	}
	const dataBytes = review.frameCount * review.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(dataBytes) || descriptor.dataOffset !== 44
		|| descriptor.dataByteLength !== dataBytes || descriptor.dataOffset + dataBytes !== body.size
		|| descriptor.riffByteLength !== body.size || descriptor.sourceByteLength !== body.size) {
		throw new RangeError('The assistance audio result is not a canonical geometry-exact WAV.');
	}
}

async function assertFiniteFloat32Body(body: Blob): Promise<void> {
	const maximumChunkBytes = 65_536 * Float32Array.BYTES_PER_ELEMENT;
	for (let start = 44; start < body.size; start += maximumChunkBytes) {
		const end = Math.min(body.size, start + maximumChunkBytes);
		const bytes = await body.slice(start, end).arrayBuffer();
		const view = new DataView(bytes);
		for (let offset = 0; offset < view.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
			if (!Number.isFinite(view.getFloat32(offset, true))) {
				throw new RangeError('The assistance audio result must contain only finite samples.');
			}
		}
	}
}

function normalizeDescriptor(value: unknown): RequestDescriptor {
	const request = exactRecord(value, REQUEST_FIELDS, 'assistance audio publication request');
	const operation = audioOperation(request.operation);
	const profile = OUTPUT_PROFILES[operation];
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	const sourceId = stableText(request.sourceId, 'assistance audio source ID');
	if (sourceId !== fence.sourceId) {
		throw new Error('The reviewed assistance audio source disagrees with its selection fence.');
	}
	const model = normalizeModel(request.models, operation);
	if (!Array.isArray(request.outputs) || request.outputs.length !== profile.slots.length) {
		throw new RangeError('Assistance audio publication requires every exact output slot once.');
	}
	const outputs = request.outputs.map((candidate, index) => normalizeOutput(
		candidate, operation, `assistance audio output ${String(index)}`,
	)).sort((left, right) => SLOT_ORDER.get(left.slotId)! - SLOT_ORDER.get(right.slotId)!);
	if (outputs.some((output, index) => output.slotId !== profile.slots[index])) {
		throw new RangeError('Assistance audio output slots must cover their closed recipe exactly once.');
	}
	if (new Set(outputs.map(({ claim }) => claim.claimId)).size !== outputs.length
		|| new Set(outputs.map(({ claim }) => claim.jobId)).size !== 1) {
		throw new TypeError('Assistance audio output claims must be unique and bind one exact job.');
	}
	const fingerprint = JSON.stringify({
		sourceId, operation, selectionFence: fence, models: [model],
		outputs: outputs.map(({ slotId, claim, review }) => ({ slotId, claim, review })),
	});
	return Object.freeze({ sourceId, operation, selectionFence: fence,
		models: Object.freeze([model]) as readonly [LocalAssistanceAudioModelBinding],
		outputs: Object.freeze(outputs), fingerprint });
}

function normalizeModel(
	value: unknown,
	operation: LocalAssistanceAudioOperation,
): LocalAssistanceAudioModelBinding {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new RangeError('Assistance audio publication requires one exact model binding.');
	}
	const record = exactRecord(value[0], MODEL_FIELDS, 'assistance audio model binding');
	const profile = OUTPUT_PROFILES[operation];
	if (record.modelId !== profile.modelId || record.version !== profile.version
		|| record.task !== operation) {
		throw new TypeError('Assistance audio publication has the wrong exact model binding.');
	}
	const artifacts = record.artifactSha256s;
	if (!Array.isArray(artifacts) || artifacts.length < 1 || artifacts.length > 64
		|| artifacts.some((digest, index) => typeof digest !== 'string'
			|| !SHA256.test(digest) || (index > 0 && digest <= String(artifacts[index - 1])))) {
		throw new TypeError('Assistance audio model artifact digests must be nonempty, sorted, and unique.');
	}
	return Object.freeze({
		modelId: profile.modelId, version: profile.version, task: operation,
		artifactSha256s: Object.freeze([...artifacts] as string[]),
	});
}

function normalizeOutput(
	value: unknown,
	operation: LocalAssistanceAudioOperation,
	label: string,
): LocalAssistanceAudioReviewedOutput {
	const record = exactRecord(value, OUTPUT_FIELDS, label);
	const profile = OUTPUT_PROFILES[operation];
	if (!profile.slots.includes(record.slotId as never)) {
		throw new TypeError(`${label} has an invalid slotted stem identity.`);
	}
	const slotId = record.slotId as LocalAssistanceAudioOutputSlot;
	const claimRecord = exactRecord(record.claim, CLAIM_FIELDS, `${label} claim`);
	if (claimRecord.claimVersion !== 1 || !OPAQUE_ID.test(String(claimRecord.claimId))
		|| !OPAQUE_ID.test(String(claimRecord.jobId)) || claimRecord.role !== profile.role
		|| claimRecord.mediaType !== 'audio/wav'
		|| !Number.isSafeInteger(claimRecord.byteLength) || Number(claimRecord.byteLength) < 45
		|| !SHA256.test(String(claimRecord.sha256))) {
		throw new TypeError(`${label} has an invalid authenticated WAV claim.`);
	}
	if (!(record.bytes instanceof Blob) || record.bytes.size !== claimRecord.byteLength) {
		throw new RangeError(`${label} Blob custody disagrees with its exact byte claim.`);
	}
	const claim = Object.freeze({
		claimVersion: 1 as const, claimId: String(claimRecord.claimId), jobId: String(claimRecord.jobId),
		role: profile.role, mediaType: 'audio/wav', byteLength: Number(claimRecord.byteLength),
		sha256: String(claimRecord.sha256),
	}) as LocalAssistanceAudioOutputClaim;
	const reviewRecord = exactRecord(record.review, REVIEW_FIELDS, `${label} review`);
	if (reviewRecord.kind !== 'audio-wave' || reviewRecord.role !== profile.role
		|| reviewRecord.sampleRate !== profile.sampleRate || reviewRecord.sampleFormat !== 'float32'
		|| !Number.isSafeInteger(reviewRecord.channelCount) || Number(reviewRecord.channelCount) < 1
		|| Number(reviewRecord.channelCount) > 64 || !Number.isSafeInteger(reviewRecord.frameCount)
		|| Number(reviewRecord.frameCount) < 1) {
		throw new TypeError(`${label} has invalid reviewed Float32 WAV geometry.`);
	}
	const review = Object.freeze({
		kind: 'audio-wave' as const, role: profile.role,
		sampleRate: profile.sampleRate, channelCount: Number(reviewRecord.channelCount),
		frameCount: Number(reviewRecord.frameCount), sampleFormat: 'float32' as const,
	});
	if (claim.byteLength !== localAssistanceCanonicalWaveByteLength(
		review.sampleRate, review.channelCount, review.frameCount,
	)) {
		throw new RangeError(`${label} claim disagrees with its exact WAV geometry.`);
	}
	return Object.freeze({ slotId, claim, review, bytes: record.bytes });
}

async function digestBlob(body: Blob): Promise<string> {
	const digest = sha256.create();
	const reader = body.stream().getReader();
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			digest.update(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return bytesToHex(digest.digest());
}

function audioOperation(value: unknown): LocalAssistanceAudioOperation {
	if (value !== 'speech-enhancement' && value !== 'source-separation') {
		throw new RangeError('This result is not an assistance audio publication operation.');
	}
	return value;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The ${label} must carry exactly its schema fields.`);
	}
	return record;
}

function stableText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}
