/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What survives one plug-in instance losing its host: its bounded opaque
 * state, and the continuity the user is given while nothing is hosting it.
 *
 * A hosted plug-in's state is a byte blob whose meaning only the vendor's code
 * knows, so main never parses it: it bounds it, digests it, and keeps the last
 * admitted copy. The descriptor rides the same 64 KiB control envelope every
 * helper control message is bounded by; the bytes ride their own bounded
 * channel in chunks, because a 16 MiB state carried as a control result would
 * turn that control bound into a fiction.
 *
 * An oversize state is deliberately not a discard. The instance becomes
 * ineligible to host — the user is told its state is too large — while the last
 * state small enough to admit stays retained, so saving the project after the
 * refusal still round-trips what the plug-in last persisted. Losing the state
 * would be silent data loss disguised as a size check.
 */

import { createHash } from 'node:crypto';

import {
	classifyAudioTrackFreezeFreshnessV1,
	normalizeAudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import {
	HelperContractViolationError,
	MAXIMUM_HELPER_WIRE_MESSAGE_BYTES,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';

/** Per-instance ceiling for one opaque state blob. */
export const PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES = 16 * 1024 * 1024;

/** One bulk-channel chunk. Sixty-four of these cover the whole ceiling. */
export const PLUGIN_OPAQUE_STATE_CHUNK_BYTES = 256 * 1024;

export const PLUGIN_OPAQUE_STATE_MAXIMUM_CHUNKS =
	PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES / PLUGIN_OPAQUE_STATE_CHUNK_BYTES;

/** Descriptors are control messages and stay inside the shared control bound. */
export const PLUGIN_OPAQUE_STATE_CONTROL_ENVELOPE_BYTES: number = MAXIMUM_HELPER_WIRE_MESSAGE_BYTES;

/** Owner-supplied identifiers are opaque ids, never anything path-shaped. */
export const PLUGIN_INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export const PLUGIN_OPAQUE_STATE_MAXIMUM_GENERATION = 0xffff_ffff;

/**
 * How many instances one store retains for. Instance ids arrive from a helper
 * and each retained state may be 16 MiB, so an unbounded map is an unbounded
 * memory grant. At the ceiling a newcomer is refused rather than an older
 * instance evicted: evicting is the silent discard this module exists to
 * prevent, and an instance already retained can always update its own state.
 */
export const PLUGIN_OPAQUE_STATE_MAXIMUM_RETAINED_INSTANCES = 256;

/** An instance's lifecycle relative to a host process, never to its content. */
export const PLUGIN_INSTANCE_STATES = Object.freeze(['hosted', 'stopped', 'faulted', 'revoked'] as const);
export type PluginInstanceState = (typeof PLUGIN_INSTANCE_STATES)[number];

export interface PluginOpaqueStateDescriptor {
	readonly instanceId: string;
	readonly generation: number;
	readonly byteLength: number;
	readonly chunkCount: number;
	readonly sha256: string;
}

export interface PluginOpaqueStateChunk {
	readonly instanceId: string;
	readonly generation: number;
	readonly chunkIndex: number;
	readonly bytes: Uint8Array;
}

export interface PluginOpaqueStateTransfer {
	readonly descriptor: PluginOpaqueStateDescriptor;
	readonly chunks: readonly PluginOpaqueStateChunk[];
}

/** What a surface may know about a retained state: size and identity, never content. */
export interface PluginOpaqueStateSummary {
	readonly instanceId: string;
	readonly generation: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface PluginOpaqueStateRecord extends PluginOpaqueStateSummary {
	readonly bytes: Uint8Array;
}

export type PluginOpaqueStateRejectionCode =
	| 'oversize'
	| 'stale-generation'
	| 'malformed'
	| 'capacity';

export type PluginInstanceStateIneligibility = 'oversize-state';

export interface PluginInstanceStateSnapshot {
	readonly instanceId: string;
	readonly eligible: boolean;
	readonly ineligibleReason: PluginInstanceStateIneligibility | null;
	readonly retained: PluginOpaqueStateSummary | null;
}

export type PluginOpaqueStatePersistOutcome =
	| Readonly<{ status: 'persisted'; retained: PluginOpaqueStateSummary }>
	| Readonly<{
		status: 'rejected';
		code: PluginOpaqueStateRejectionCode;
		message: string;
		eligible: boolean;
		/** The state that survived the refusal, exactly as it was before it. */
		retained: PluginOpaqueStateSummary | null;
	}>;

export interface PluginOpaqueStatePersistRequest {
	readonly instanceId: string;
	readonly generation: number;
	readonly bytes: Uint8Array;
}

export interface PluginOpaqueStateOversizeReport {
	readonly instanceId: string;
	readonly generation: number;
	/** What the helper said its state weighs; the bytes were never transferred. */
	readonly declaredByteLength: number;
}

const DESCRIPTOR_KEYS = Object.freeze(['instanceId', 'generation', 'byteLength', 'chunkCount', 'sha256']);
const CHUNK_KEYS = Object.freeze(['instanceId', 'generation', 'chunkIndex', 'bytes']);
const SHA256 = /^[a-f0-9]{64}$/u;

export function assertPluginInstanceId(value: unknown): string {
	if (typeof value !== 'string' || !PLUGIN_INSTANCE_ID_PATTERN.test(value)) {
		throw new HelperContractViolationError('malformed',
			'A plug-in instance id must be a bounded opaque id with no path syntax.');
	}
	return value;
}

export function assertPluginStateGeneration(value: unknown): number {
	return boundedInteger(value, 0, PLUGIN_OPAQUE_STATE_MAXIMUM_GENERATION, 'plug-in state generation');
}

/**
 * Splits one instance's state into the control descriptor and the bulk chunks
 * that carry it. Oversize is refused here rather than after transfer, so a
 * 16 MiB-plus state never occupies a channel it is not allowed to fill.
 */
export function planPluginOpaqueStateTransfer(
	request: PluginOpaqueStatePersistRequest,
): PluginOpaqueStateTransfer {
	const instanceId = assertPluginInstanceId(request.instanceId);
	const generation = assertPluginStateGeneration(request.generation);
	const bytes = ordinaryBytes(request.bytes, PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES, 'A plug-in opaque state');
	const chunks: PluginOpaqueStateChunk[] = [];
	for (let offset = 0; offset < bytes.byteLength; offset += PLUGIN_OPAQUE_STATE_CHUNK_BYTES) {
		chunks.push(Object.freeze({
			instanceId,
			generation,
			chunkIndex: chunks.length,
			// A copy, not a subarray: a chunk that shared the whole state's
			// backing storage would smuggle 16 MiB behind a 256 KiB view.
			bytes: bytes.slice(offset, offset + PLUGIN_OPAQUE_STATE_CHUNK_BYTES),
		}));
	}
	return Object.freeze({
		descriptor: Object.freeze({
			instanceId,
			generation,
			byteLength: bytes.byteLength,
			chunkCount: chunks.length,
			sha256: digestOf(bytes),
		}),
		chunks: Object.freeze(chunks),
	});
}

export function validatePluginOpaqueStateDescriptor(value: unknown): PluginOpaqueStateDescriptor {
	assertHelperWireEnvelope(value);
	const record = plainRecord(value, 'A plug-in opaque state descriptor');
	exactKeys(record, DESCRIPTOR_KEYS, 'A plug-in opaque state descriptor');
	const byteLength = boundedInteger(record.byteLength, 0, PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES, 'opaque state byte length');
	const chunkCount = boundedInteger(record.chunkCount, 0, PLUGIN_OPAQUE_STATE_MAXIMUM_CHUNKS, 'opaque state chunk count');
	if (chunkCount !== Math.ceil(byteLength / PLUGIN_OPAQUE_STATE_CHUNK_BYTES)) {
		throw new HelperContractViolationError('malformed',
			'A plug-in opaque state descriptor must declare the exact chunk count its length implies.');
	}
	if (typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
		throw new HelperContractViolationError('malformed',
			'A plug-in opaque state descriptor must carry a lowercase SHA-256 of its bytes.');
	}
	return Object.freeze({
		instanceId: assertPluginInstanceId(record.instanceId),
		generation: assertPluginStateGeneration(record.generation),
		byteLength,
		chunkCount,
		sha256: record.sha256,
	});
}

/**
 * A chunk's head is a control envelope and is bounded as one; its payload is
 * bulk data on its own channel and is bounded separately. Measuring the two
 * together is exactly what would let a 256 KiB payload claim the 64 KiB
 * control bound, so they are never measured together.
 */
export function validatePluginOpaqueStateChunk(value: unknown): PluginOpaqueStateChunk {
	const record = plainRecord(value, 'A plug-in opaque state chunk');
	exactKeys(record, CHUNK_KEYS, 'A plug-in opaque state chunk');
	assertHelperWireEnvelope({
		instanceId: record.instanceId,
		generation: record.generation,
		chunkIndex: record.chunkIndex,
	});
	const bytes = ordinaryBytes(record.bytes, PLUGIN_OPAQUE_STATE_CHUNK_BYTES, 'A plug-in opaque state chunk');
	return Object.freeze({
		instanceId: assertPluginInstanceId(record.instanceId),
		generation: assertPluginStateGeneration(record.generation),
		chunkIndex: boundedInteger(record.chunkIndex, 0, PLUGIN_OPAQUE_STATE_MAXIMUM_CHUNKS - 1, 'opaque state chunk index'),
		bytes,
	});
}

/** Reassembles a transfer, proving order, coverage and the declared digest. */
export function assemblePluginOpaqueState(
	descriptorValue: unknown,
	chunkValues: Iterable<unknown>,
): PluginOpaqueStateRecord {
	const descriptor = validatePluginOpaqueStateDescriptor(descriptorValue);
	const bytes = new Uint8Array(descriptor.byteLength);
	let index = 0;
	let offset = 0;
	for (const candidate of chunkValues) {
		if (index >= descriptor.chunkCount) {
			throw new HelperContractViolationError('malformed',
				'A plug-in opaque state transfer carried more chunks than its descriptor declared.');
		}
		const chunk = validatePluginOpaqueStateChunk(candidate);
		if (chunk.instanceId !== descriptor.instanceId || chunk.generation !== descriptor.generation) {
			throw new HelperContractViolationError('malformed',
				'A plug-in opaque state chunk does not belong to the descriptor it arrived under.');
		}
		if (chunk.chunkIndex !== index) {
			throw new HelperContractViolationError('malformed',
				'A plug-in opaque state transfer must be contiguous and in order.');
		}
		const expected = Math.min(PLUGIN_OPAQUE_STATE_CHUNK_BYTES, descriptor.byteLength - offset);
		if (chunk.bytes.byteLength !== expected) {
			throw new HelperContractViolationError('malformed',
				'A plug-in opaque state chunk does not cover its declared share of the state.');
		}
		bytes.set(chunk.bytes, offset);
		offset += expected;
		index += 1;
	}
	if (index !== descriptor.chunkCount || offset !== descriptor.byteLength) {
		throw new HelperContractViolationError('malformed',
			'A plug-in opaque state transfer ended before its descriptor was covered.');
	}
	const sha256 = digestOf(bytes);
	if (sha256 !== descriptor.sha256) {
		throw new HelperContractViolationError('malformed',
			'A plug-in opaque state transfer does not match the digest its descriptor declared.');
	}
	return Object.freeze({
		instanceId: descriptor.instanceId,
		generation: descriptor.generation,
		byteLength: descriptor.byteLength,
		sha256,
		bytes,
	});
}

/**
 * Main's retention of the last admissible opaque state per instance, and the
 * eligibility that an oversize state costs. Nothing here reaches a renderer:
 * callers publish the summary, never the bytes and never the instance's host.
 */
export class PluginInstanceStateStore {
	readonly #retained = new Map<string, PluginOpaqueStateRecord>();
	readonly #ineligible = new Map<string, PluginInstanceStateIneligibility>();

	persist(request: PluginOpaqueStatePersistRequest): PluginOpaqueStatePersistOutcome {
		let instanceId: string;
		let generation: number;
		let admitted: Uint8Array;
		try {
			instanceId = assertPluginInstanceId(request.instanceId);
			generation = assertPluginStateGeneration(request.generation);
			admitted = ordinaryBytes(request.bytes, PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES, 'A plug-in opaque state');
		} catch (error) {
			const reported = typeof request.instanceId === 'string' ? request.instanceId : '';
			return this.#reject(reported, oversizeClaim(error) ? 'oversize' : 'malformed', describeError(error));
		}
		const previous = this.#retained.get(instanceId);
		if (previous && previous.generation > generation) {
			return this.#reject(instanceId, 'stale-generation',
				'A plug-in opaque state older than the retained one was refused.');
		}
		if (this.#atCapacity(instanceId)) {
			return this.#reject(instanceId, 'capacity',
				'This store already retains opaque state for its maximum number of instances.');
		}
		const bytes = new Uint8Array(admitted);
		const record: PluginOpaqueStateRecord = Object.freeze({
			instanceId,
			generation,
			byteLength: bytes.byteLength,
			sha256: digestOf(bytes),
			bytes,
		});
		this.#retained.set(instanceId, record);
		return Object.freeze({ status: 'persisted' as const, retained: summaryOf(record) });
	}

	/**
	 * The helper answered with a state larger than the ceiling, so its bytes
	 * were never transferred. The instance stops being eligible to host; the
	 * state it last persisted stays exactly where it was.
	 */
	declareOversizeState(report: PluginOpaqueStateOversizeReport): PluginOpaqueStatePersistOutcome {
		let instanceId: string;
		let declared: number;
		try {
			instanceId = assertPluginInstanceId(report.instanceId);
			assertPluginStateGeneration(report.generation);
			// The bytes never arrived, so this declaration is all main has. A
			// report that does not describe an oversize state is a malformed
			// report and not a verdict: taking it at its word would let a helper
			// cost an instance its eligibility with a size nothing measured.
			declared = boundedInteger(report.declaredByteLength, PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 1,
				Number.MAX_SAFE_INTEGER, 'declared plug-in opaque state length');
		} catch (error) {
			const reported = typeof report.instanceId === 'string' ? report.instanceId : '';
			return this.#reject(reported, 'malformed', describeError(error));
		}
		if (this.#atCapacity(instanceId)) {
			return this.#reject(instanceId, 'capacity',
				'This store already tracks its maximum number of instances.');
		}
		return this.#reject(instanceId, 'oversize',
			`A plug-in opaque state of ${String(declared)} bytes exceeds the `
			+ `${String(PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES)}-byte ceiling.`);
	}

	/** The retained bytes, copied, for persistence and project round trips. */
	read(instanceId: string): PluginOpaqueStateRecord | null {
		const record = this.#retained.get(instanceId);
		return record
			? Object.freeze({ ...record, bytes: new Uint8Array(record.bytes) })
			: null;
	}

	describe(instanceId: string): PluginInstanceStateSnapshot {
		const record = this.#retained.get(instanceId);
		const ineligibleReason = this.#ineligible.get(instanceId) ?? null;
		return Object.freeze({
			instanceId,
			eligible: ineligibleReason === null,
			ineligibleReason,
			retained: record ? summaryOf(record) : null,
		});
	}

	isEligible(instanceId: string): boolean {
		return !this.#ineligible.has(instanceId);
	}

	/** The instance left the project, so both its state and its verdict go. */
	forget(instanceId: string): void {
		this.#retained.delete(instanceId);
		this.#ineligible.delete(instanceId);
	}

	/** Both maps are bounded together, so no id churn can grow either one. */
	#atCapacity(instanceId: string): boolean {
		return !this.#retained.has(instanceId) && !this.#ineligible.has(instanceId)
			&& this.#retained.size + this.#ineligible.size >= PLUGIN_OPAQUE_STATE_MAXIMUM_RETAINED_INSTANCES;
	}

	#reject(
		instanceId: string,
		code: PluginOpaqueStateRejectionCode,
		message: string,
	): PluginOpaqueStatePersistOutcome {
		// Only an oversize state costs eligibility. A malformed or stale
		// transfer is a retry, not a verdict about the instance, and an
		// unattributable failure names no instance to hold a verdict against.
		if (code === 'oversize' && instanceId) this.#ineligible.set(instanceId, 'oversize-state');
		const retained = instanceId ? this.#retained.get(instanceId) : undefined;
		return Object.freeze({
			status: 'rejected' as const,
			code,
			message,
			eligible: instanceId ? !this.#ineligible.has(instanceId) : false,
			retained: retained ? summaryOf(retained) : null,
		});
	}
}

/** A reference to a freeze the project already holds. Never one made here. */
export interface PluginAuthoredFreezeReference {
	readonly provenance: 'project-authored';
	readonly derivedSourceId: string;
	readonly freshnessDigestSha256: string;
}

export interface PluginContinuityRequest {
	readonly instanceId: string;
	readonly state: PluginInstanceState;
	/**
	 * The owning track's authored V21 freeze and the digests it is compared
	 * against. Absent when the track was never frozen — the ordinary case, and
	 * the one that must produce bypass rather than a fabrication.
	 */
	readonly freeze?: Readonly<{ authored?: unknown; currentDigests: unknown }>;
	readonly retainedOpaqueState?: PluginOpaqueStateSummary | null;
}

export interface PluginContinuityDecision {
	readonly instanceId: string;
	readonly mode: 'bypass' | 'frozen-playback';
	readonly cause: PluginInstanceState;
	/** Typed as the literal: a decision cannot claim parameters were lost. */
	readonly parametersIntact: true;
	readonly opaqueState: PluginOpaqueStateSummary | null;
	readonly freeze: PluginAuthoredFreezeReference | null;
	readonly detail: string;
}

/**
 * What the user gets while an instance has no host. Bypass is the answer
 * unless the project already authored a freeze that is still fresh, in which
 * case that freeze plays. There is no third answer, because the only other
 * candidate would be a render made after the failure — which is exactly what
 * 5A refuses to call an authored freeze. Nothing here renders anything.
 */
export function choosePluginInstanceContinuity(request: PluginContinuityRequest): PluginContinuityDecision {
	if (request.state === 'hosted') {
		throw new RangeError('A hosted plug-in instance does not need a continuity decision.');
	}
	const opaqueState = request.retainedOpaqueState ?? null;
	const authored = request.freeze?.authored;
	if (!request.freeze || authored === undefined) {
		return continuity(request, 'bypass', opaqueState, null,
			'No authored freeze exists for this track, so the instance is bypassed.');
	}
	const freshness = freezeFreshness(authored, request.freeze.currentDigests);
	if (freshness !== 'fresh') {
		return continuity(request, 'bypass', opaqueState, null,
			`The authored freeze is ${freshness}, so the instance is bypassed.`);
	}
	const freeze = normalizeAudioTrackFreezeV1(authored);
	return continuity(request, 'frozen-playback', opaqueState, Object.freeze({
		provenance: 'project-authored' as const,
		derivedSourceId: freeze.derivedSourceId,
		freshnessDigestSha256: freeze.freshnessDigestSha256,
	}), 'A fresh authored V21 freeze already exists, so its render plays.');
}

/**
 * The freshness model rejects project data it cannot normalize by throwing, and
 * only a freeze main verified may be played. A recovery answer that threw would
 * leave the user with no answer at all, so an unverifiable record is reported
 * as its own freshness word and bypassed like any other non-fresh freeze.
 */
function freezeFreshness(authored: unknown, currentDigests: unknown): string {
	try {
		return classifyAudioTrackFreezeFreshnessV1(authored, currentDigests).status;
	} catch (_error) {
		return 'unverifiable';
	}
}

function continuity(
	request: PluginContinuityRequest,
	mode: PluginContinuityDecision['mode'],
	opaqueState: PluginOpaqueStateSummary | null,
	freeze: PluginAuthoredFreezeReference | null,
	detail: string,
): PluginContinuityDecision {
	return Object.freeze({
		instanceId: request.instanceId, mode, cause: request.state,
		parametersIntact: true as const, opaqueState, freeze, detail,
	});
}

function summaryOf(record: PluginOpaqueStateRecord): PluginOpaqueStateSummary {
	return Object.freeze({
		instanceId: record.instanceId,
		generation: record.generation,
		byteLength: record.byteLength,
		sha256: record.sha256,
	});
}

function digestOf(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function ordinaryBytes(value: unknown, maximumBytes: number, label: string): Uint8Array {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
		throw new HelperContractViolationError('malformed', `${label} must be an ordinary Uint8Array.`);
	}
	if (typeof SharedArrayBuffer === 'function' && value.buffer instanceof SharedArrayBuffer) {
		throw new HelperContractViolationError('malformed', `${label} must not use shared backing memory.`);
	}
	if (value.byteOffset !== 0 || value.buffer.byteLength !== value.byteLength) {
		throw new HelperContractViolationError('malformed', `${label} must tightly cover its backing storage.`);
	}
	if (value.byteLength > maximumBytes) {
		throw new HelperContractViolationError('oversized',
			`${label} exceeds its ${String(maximumBytes)}-byte bound.`);
	}
	return value;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new HelperContractViolationError('malformed', `${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new HelperContractViolationError('malformed', `${label} must carry exactly its schema keys.`);
	}
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new HelperContractViolationError('malformed', `A ${label} is outside its admitted bounds.`);
	}
	return value as number;
}

function oversizeClaim(error: unknown): boolean {
	return error instanceof HelperContractViolationError && error.code === 'oversized';
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
