/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned V14 carrier spool: bounded durable write, exact replay, then cleanup. */

import { statfs, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import type { NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { assertNativeQueueRecordV3, type NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import {
	isFramescaperOpenFxLiveFrameTransformAudit,
	isFramescaperOpenFxLiveFrameTransformFactory,
	type FramescaperOpenFxLiveFrameTransformAudit,
	type FramescaperOpenFxLiveFrameTransformFactory,
	type FramescaperOpenFxLiveFrameTransformSession,
} from './framescaper-openfx-live-frame-transform.ts';
import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from './helper-data-plane.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import {
	framescaperNativeLiveRenderInputBeginRequest,
	framescaperNativeLiveRenderInputChunkRequest,
	framescaperNativeLiveRenderInputCompletionRequest,
	FRAMESCAPER_NATIVE_LIVE_RENDER_INPUT_VERSION,
	type FramescaperNativeLiveRenderInputBeginRequestV1,
	type FramescaperNativeLiveRenderInputAdmissionV1,
} from './native-services-live-render-input-contract.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES,
	nativeRenderInputClaimRequest,
	nativeRenderInputDigest,
	nativeRenderInputSafeSum,
	nativeRenderInputReceiveRequest,
	nativeRenderInputStageId,
	nativeRenderInputStageIdRequest,
	type FramescaperNativeRenderInputStageIdentity,
} from './native-services-render-input-contract.ts';
import {
	createNativeRenderInputOwnedStage,
	createNativeRenderInputStageOwnership,
	listNativeRenderInputOwnedStages,
	removeNativeRenderInputOwnedStage,
	type NativeRenderInputOwnedStage,
} from './native-services-render-input-durable-store.ts';
import { NativeLiveRenderReplaySpool } from './native-services-live-render-replay-spool.ts';
import type {
	FramescaperNativeDerivedRenderInputs,
	FramescaperNativeRenderInputReclamationResult,
} from './native-services-render-input-staging.ts';

type NativeRenderInputQueueRecord = NativeQueueRecordV2 | NativeQueueRecordV3;

/** Ownership sidecar, directory entries, claim marker, and filesystem allocation headroom. */
export const FRAMESCAPER_NATIVE_LIVE_RENDER_REPLAY_OVERHEAD_BYTES = 64 * 1_024;

export interface FramescaperNativeLiveRenderInputMessageChannel {
	readonly hostPort: unknown;
	readonly helperPort: unknown;
}

export interface FramescaperNativeLiveRenderInputStagingOptions {
	readonly root: string;
	readonly mintStageId: () => string;
	/** Compatibility-only registration hook; durable replay opens no helper port. */
	readonly createMessageChannel: () => FramescaperNativeLiveRenderInputMessageChannel;
	readonly openFxTransformFactory?: FramescaperOpenFxLiveFrameTransformFactory | null;
	readonly now?: () => number;
	readonly availableBytes?: (root: string) => Promise<number>;
	readonly maximumReplayBytes?: number;
	readonly storageAdmission?: (
		request: FramescaperNativeLiveRenderInputBeginRequestV1,
		replayScratchByteLength: number,
		outstandingReplayByteLength: number,
		availableBytes: number,
	) => Promise<void>;
}

interface PendingLiveStage {
	readonly owner: object;
	readonly owned: NativeRenderInputOwnedStage;
	readonly identity: FramescaperNativeRenderInputStageIdentity;
	readonly envelope: ReturnType<typeof framescaperNativeLiveRenderInputBeginRequest>['envelope'];
	readonly carrierByteLength: number;
	readonly abort: AbortController;
	readonly streams: ReadonlyMap<LiveInputRole, PendingLiveStream>;
	finalized: boolean;
	claimed: boolean;
	failed: boolean;
}

type LiveInputRole = 'evaluated-rgba-frame-pack' | 'staged-audio-mix';

interface PendingLiveStream {
	readonly role: LiveInputRole;
	readonly byteLength: number;
	readonly spool: NativeLiveRenderReplaySpool;
	openFxTransform: FramescaperOpenFxLiveFrameTransformSession | null;
	openFxAudit: FramescaperOpenFxLiveFrameTransformAudit | null;
	writing: boolean;
	completed: boolean;
	nextSequence: number;
	receivedBytes: number;
}

/** In-memory stream authority; restart deliberately invalidates and atomically restarts the job. */
export class FramescaperNativeLiveRenderInputStaging {
	readonly #root: string;
	readonly #mintStageId: () => string;
	#openFxTransformFactory: FramescaperOpenFxLiveFrameTransformFactory | null;
	readonly #now: () => number;
	readonly #availableBytes: (root: string) => Promise<number>;
	readonly #maximumReplayBytes: number;
	readonly #storageAdmission: FramescaperNativeLiveRenderInputStagingOptions['storageAdmission'];
	readonly #pending = new Map<string, PendingLiveStage>();
	readonly #revokedOwners = new WeakSet<object>();
	#mutations: Promise<void> = Promise.resolve();

	constructor(options: FramescaperNativeLiveRenderInputStagingOptions) {
		if (!options || typeof options !== 'object' || Array.isArray(options)
			|| typeof options.mintStageId !== 'function' || typeof options.createMessageChannel !== 'function'
			|| (options.openFxTransformFactory !== undefined && options.openFxTransformFactory !== null
				&& !isFramescaperOpenFxLiveFrameTransformFactory(options.openFxTransformFactory))
			|| (options.now !== undefined && typeof options.now !== 'function')
			|| (options.availableBytes !== undefined && typeof options.availableBytes !== 'function')
			|| (options.storageAdmission !== undefined && typeof options.storageAdmission !== 'function')
			|| (options.maximumReplayBytes !== undefined && (!Number.isSafeInteger(options.maximumReplayBytes)
				|| options.maximumReplayBytes < 1 || options.maximumReplayBytes > HELPER_DATA_PLANE_MAXIMUM_BYTES))) {
			throw new TypeError('Live V14 render-input staging requires exact main-owned ports.');
		}
		this.#root = absolutePath(options.root);
		this.#mintStageId = options.mintStageId;
		this.#openFxTransformFactory = options.openFxTransformFactory ?? null;
		this.#now = options.now ?? Date.now;
		this.#availableBytes = options.availableBytes ?? filesystemAvailableBytes;
		this.#maximumReplayBytes = options.maximumReplayBytes ?? HELPER_DATA_PLANE_MAXIMUM_BYTES;
		this.#storageAdmission = options.storageAdmission;
	}

	mountOpenFxTransformFactory(factory: FramescaperOpenFxLiveFrameTransformFactory): void {
		if (!isFramescaperOpenFxLiveFrameTransformFactory(factory)
			|| this.#openFxTransformFactory !== null || this.#pending.size !== 0) {
			throw new Error('The branded OpenFX live transformer must mount once before staging begins.');
		}
		this.#openFxTransformFactory = factory;
	}

	owns(stageId: string): boolean { return this.#pending.has(nativeRenderInputStageId(stageId)); }

	async beginLive(ownerValue: unknown, value: unknown): Promise<FramescaperNativeLiveRenderInputAdmissionV1> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const control = framescaperNativeLiveRenderInputBeginRequest(value);
		const streamRows: readonly Readonly<{ role: LiveInputRole; byteLength: number }>[] =
			Object.freeze([
				Object.freeze({
					role: 'evaluated-rgba-frame-pack' as const,
					byteLength: control.request.carrierByteLength,
				}),
				...(control.request.audio === null ? [] : [control.request.audio]),
			]);
		const streamByteLength = streamRows.reduce(
			(sum, row) => nativeRenderInputSafeSum(sum, row.byteLength), 0,
		);
		const scratchByteLength = nativeRenderInputSafeSum(
			streamByteLength, FRAMESCAPER_NATIVE_LIVE_RENDER_REPLAY_OVERHEAD_BYTES,
		);
		return this.#mutate(async () => {
			this.#activeOwner(owner);
			const inventory = await listNativeRenderInputOwnedStages(this.#root);
			if (inventory.length >= FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES) {
				throw new RangeError('Live V14 render-input staging reached its pending-stage ceiling.');
			}
			const durableBytes = inventory.reduce((sum, stage) => nativeRenderInputSafeSum(
				sum, stage.ownership.declaredByteLength,
			), 0);
			if (scratchByteLength > this.#maximumReplayBytes
				|| nativeRenderInputSafeSum(durableBytes, scratchByteLength) > this.#maximumReplayBytes) {
				throw new RangeError('Live V14 replay staging exceeds its configured durable-byte ceiling.');
			}
			const availableBytes = await this.#availableBytes(this.#root);
			if (!Number.isSafeInteger(availableBytes) || availableBytes < 0) {
				throw new TypeError('Live V14 replay staging returned no exact free-space authority.');
			}
			if (this.#storageAdmission) {
				await this.#storageAdmission(control.request, scratchByteLength, durableBytes, availableBytes);
			}
			else if (availableBytes < scratchByteLength) {
				throw new RangeError('Live V14 replay staging has insufficient sampled free space.');
			}
			const id = control.request.restartJobId ?? nativeRenderInputStageId(this.#mintStageId());
			if (this.#pending.has(id)) throw new Error('A live V14 stage identity was replayed.');
			const bindingDigest = nativeRenderInputDigest(JSON.stringify({
				identity: control.identity, carrierByteLength: control.request.carrierByteLength,
				audio: control.request.audio,
			}));
			const owned = await createNativeRenderInputOwnedStage(this.#root,
				createNativeRenderInputStageOwnership(
					id, this.#now(), scratchByteLength,
					nativeRenderInputDigest(JSON.stringify(control.identity)), bindingDigest,
				));
			const streams = new Map<LiveInputRole, PendingLiveStream>();
			try {
				for (const [index, row] of streamRows.entries()) streams.set(row.role, {
					role: row.role, byteLength: row.byteLength,
					spool: await NativeLiveRenderReplaySpool.create({
						path: liveReplayPath(owned.directory, row.role, index),
						role: row.role, byteLength: row.byteLength, envelope: control.envelope,
					}),
					openFxTransform: null, openFxAudit: null,
					writing: false, completed: false, nextSequence: 0, receivedBytes: 0,
				});
				const stage: PendingLiveStage = {
					owner, owned, identity: control.identity, envelope: control.envelope,
					carrierByteLength: control.request.carrierByteLength,
					abort: new AbortController(), streams: Object.freeze(streams),
					finalized: false, claimed: false, failed: false,
				};
				const video = liveStream(stage, 'evaluated-rgba-frame-pack');
				video.openFxTransform = openFxTransform(
					this.#openFxTransformFactory, control.envelope.plan, stage, video,
				);
				this.#pending.set(id, stage);
			} catch (error) {
				for (const stream of streams.values()) stream.spool.fail(error);
				await Promise.all([...streams.values()].map(({ spool }) => spool.dispose()));
				await removeNativeRenderInputOwnedStage(owned); throw error;
			}
			return Object.freeze({
				liveRenderVersion: FRAMESCAPER_NATIVE_LIVE_RENDER_INPUT_VERSION, stageId: id,
				carrierByteLength: control.request.carrierByteLength,
				scratchByteLength,
				streams: streamRows,
			});
		});
	}

	receive(_ownerValue: unknown, value: unknown, port: HelperDataPlaneIoPort): Promise<void> {
		port.close();
		const request = nativeRenderInputReceiveRequest(value);
		return Promise.reject(new Error(
			`Live V14 stage ${request.stageId} refuses pre-staged input ${String(request.inputIndex)}.`,
		));
	}

	async finalize(ownerValue: unknown, value: unknown): Promise<Readonly<{ stageId: string }>> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = nativeRenderInputStageIdRequest(value, 'live finalization');
		const stage = this.#owned(owner, request.stageId);
		if (stage.finalized || stage.failed) throw new Error('The live V14 stage cannot be finalized.');
		stage.finalized = true;
		return Object.freeze({ stageId: request.stageId });
	}

	async claim(ownerValue: unknown, value: unknown): Promise<void> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = nativeRenderInputClaimRequest(value);
		await this.#mutate(async () => {
			const stage = this.#owned(owner, request.derivedInputStageId);
			if (!stage.finalized || stage.failed || stage.claimed) {
				throw new Error('A live V14 stage must be finalized exactly once before enqueue.');
			}
			assertIdentity(stage.identity, request);
			await writeFile(join(stage.owned.directory, 'claimed.json'), JSON.stringify({
				stageVersion: 1, jobId: request.derivedInputStageId,
			}), { flag: 'wx', mode: 0o600 });
			stage.claimed = true;
		});
	}

	async rollbackClaim(ownerValue: unknown, value: unknown): Promise<void> {
		const owner = requiredOwner(ownerValue);
		const request = nativeRenderInputStageIdRequest(value, 'live claim rollback');
		const stage = this.#owned(owner, request.stageId);
		if ([...stage.streams.values()].some(({ writing, receivedBytes }) => writing || receivedBytes !== 0)) {
			throw new Error('A live V14 claim cannot roll back after carrier production began.');
		}
		await unlink(join(stage.owned.directory, 'claimed.json'));
		stage.claimed = false;
	}

	scratchReservation(ownerValue: unknown, value: unknown): number {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = nativeRenderInputClaimRequest(value);
		const stage = this.#owned(owner, request.derivedInputStageId);
		if (!stage.claimed || stage.failed) {
			throw new Error('A live V14 replay reservation requires one exact claimed stage.');
		}
		assertIdentity(stage.identity, request);
		return stage.owned.ownership.declaredByteLength;
	}

	async outstandingScratchByteLength(): Promise<number> {
		return this.#mutate(async () => (await listNativeRenderInputOwnedStages(this.#root)).reduce(
			(sum, stage) => nativeRenderInputSafeSum(sum, stage.ownership.declaredByteLength), 0,
		));
	}

	async writeLive(ownerValue: unknown, value: unknown): Promise<Readonly<{
		readonly sequence: number; readonly receivedBytes: number;
	}>> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = framescaperNativeLiveRenderInputChunkRequest(value);
		const stage = this.#owned(owner, request.stageId);
		const stream = liveStream(stage, request.role);
		if (!stage.claimed || stage.failed || stream.completed || stream.writing
			|| request.sequence !== stream.nextSequence || request.offset !== stream.receivedBytes) {
			throw new Error('A live V14 carrier chunk changed sequence, ownership, or lifecycle.');
		}
		stream.writing = true;
		try {
			if (stream.openFxTransform === null) await writeReplayBytes(stream, request.bytes);
			else await stream.openFxTransform.write(request.bytes);
			stream.nextSequence += 1;
			stream.receivedBytes += request.bytes.byteLength;
			return Object.freeze({ sequence: request.sequence, receivedBytes: stream.receivedBytes });
		} catch (error) { failLiveStage(stage, error); throw error; }
		finally { stream.writing = false; }
	}

	async completeLive(ownerValue: unknown, value: unknown): Promise<Readonly<{
		readonly byteLength: number; readonly sha256: string;
	}>> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = framescaperNativeLiveRenderInputCompletionRequest(value);
		const stage = this.#owned(owner, request.stageId);
		const stream = liveStream(stage, request.role);
		if (!stage.claimed || stream.writing || stage.failed || stream.completed) {
			throw new Error('The live V14 carrier cannot complete in its current lifecycle.');
		}
		try {
			let helperTrailer: Readonly<{ byteLength: number; sha256: string }> = request;
			if (stream.openFxTransform !== null) {
				const audit = await stream.openFxTransform.complete(Object.freeze({
					byteLength: request.byteLength, sha256: request.sha256,
				}));
				if (!isFramescaperOpenFxLiveFrameTransformAudit(audit)) {
					throw new Error('The OpenFX transformer returned no genuine audit.');
				}
				stream.openFxAudit = audit;
				helperTrailer = audit.transformedOutput;
			}
			await stream.spool.complete(helperTrailer);
			stream.completed = true;
			return Object.freeze({ byteLength: request.byteLength, sha256: request.sha256 });
		} catch (error) {
			failLiveStage(stage, error);
			throw error;
		}
	}

	openFxTransformAudit(stageId: string): FramescaperOpenFxLiveFrameTransformAudit | null {
		const stage = this.#pending.get(nativeRenderInputStageId(stageId));
		const audit = stage?.streams.get('evaluated-rgba-frame-pack')?.openFxAudit ?? null;
		return audit !== null && isFramescaperOpenFxLiveFrameTransformAudit(audit) ? audit : null;
	}

	async revalidate(record: NativeRenderInputQueueRecord): Promise<boolean> {
		const stage = this.#pending.get(record.jobId);
		if (!stage) return false;
		try { assertLiveRecord(stage, record); return !stage.failed; } catch { return false; }
	}

	async inspect(record: NativeRenderInputQueueRecord): Promise<FramescaperNativeDerivedRenderInputs> {
		const stage = this.#pending.get(record.jobId);
		if (!stage) throw new Error('The live V14 render-input stage is no longer resident.');
		assertLiveRecord(stage, record);
		const streams = [...stage.streams.values()];
		const byteLength = streams.reduce(
			(sum, stream) => nativeRenderInputSafeSum(sum, stream.byteLength), 0,
		);
		return Object.freeze({
			byteLength,
			scratchByteLength: stage.owned.ownership.declaredByteLength,
			materialize: async (directory: string, signal?: AbortSignal) => {
				absolutePath(directory);
				return Object.freeze(await Promise.all(streams.map(({ spool }) => spool.grant(signal))));
			},
		});
	}

	async settle(record: NativeRenderInputQueueRecord, _outcome: string): Promise<void> {
		await this.remove(record);
	}

	async remove(record: NativeRenderInputQueueRecord): Promise<void> {
		const stage = this.#pending.get(record.jobId);
		if (!stage) return;
		assertLiveRecord(stage, record);
		await this.#remove(stage);
	}

	async abandon(ownerValue: unknown, value: Readonly<{ stageId: string }>): Promise<void> {
		const owner = requiredOwner(ownerValue);
		const stage = this.#owned(owner, nativeRenderInputStageId(value?.stageId));
		if (stage.claimed) throw new Error('A claimed live V14 stage requires queue cancellation.');
		await this.#remove(stage);
	}

	async abandonOwner(ownerValue: unknown): Promise<number> {
		const owner = requiredOwner(ownerValue);
		this.#revokedOwners.add(owner);
		const stages = [...this.#pending.values()].filter((stage) => stage.owner === owner);
		for (const stage of stages) await this.#remove(stage);
		return stages.length;
	}

	async reclaim(liveRecords: readonly NativeRenderInputQueueRecord[]): Promise<FramescaperNativeRenderInputReclamationResult> {
		const records = new Map(liveRecords.map((record) => [record.jobId, record]));
		const inventory = await listNativeRenderInputOwnedStages(this.#root);
		let preservedStages = 0;
		let removedStages = 0;
		let reclaimedDeclaredBytes = 0;
		for (const owned of inventory) {
			const stage = this.#pending.get(owned.ownership.stageId);
			const record = records.get(owned.ownership.stageId);
			if (stage && record) {
				try { assertLiveRecord(stage, record); preservedStages += 1; continue; }
				catch { /* invalid live authority is removed below */ }
			}
			if (stage) await this.#remove(stage);
			else await removeNativeRenderInputOwnedStage(owned);
			removedStages += 1;
			reclaimedDeclaredBytes += owned.ownership.declaredByteLength;
		}
		return Object.freeze({
			scannedStages: inventory.length, preservedStages, removedStages, reclaimedDeclaredBytes,
		});
	}

	#owned(owner: object, stageId: string): PendingLiveStage {
		const stage = this.#pending.get(stageId);
		if (!stage || stage.owner !== owner) throw new Error('The live V14 stage has another owner.');
		return stage;
	}

	#activeOwner(owner: object): object {
		if (this.#revokedOwners.has(owner)) throw new Error('The live V14 stage owner was revoked.');
		return owner;
	}

	async #remove(stage: PendingLiveStage): Promise<void> {
		stage.failed = true;
		const reason = new Error('The live V14 render-input stage ended.');
		stage.abort.abort(reason);
		for (const stream of stage.streams.values()) {
			stream.openFxTransform?.abort(reason);
			stream.spool.fail(reason);
		}
		await Promise.all([...stage.streams.values()].map(({ spool }) => spool.dispose()));
		await this.#mutate(async () => {
			await removeNativeRenderInputOwnedStage(stage.owned);
			this.#pending.delete(stage.owned.ownership.stageId);
		});
	}

	async #mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
		const previous = this.#mutations;
		let release = (): void => undefined;
		this.#mutations = new Promise((resolve) => { release = resolve; });
		await previous;
		try { return await operation(); } finally { release(); }
	}
}

function openFxTransform(
	factory: FramescaperOpenFxLiveFrameTransformFactory | null,
	plan: PendingLiveStage['envelope']['plan'],
	stage: PendingLiveStage,
	stream: PendingLiveStream,
): FramescaperOpenFxLiveFrameTransformSession | null {
	const includesOpenFx = plan.nodes.some(({ kind }) => kind === 'openfx');
	if (factory === null) return null;
	const transform = factory(Object.freeze({
		plan, signal: stage.abort.signal,
		sink: Object.freeze({ write: (bytes: Uint8Array<ArrayBuffer>) => writeReplayBytes(stream, bytes) }),
	}));
	if (includesOpenFx && transform === null) {
		throw new Error('The branded OpenFX transformer refused an authored OpenFX plan.');
	}
	return transform;
}

async function writeReplayBytes(stream: PendingLiveStream, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
	await stream.spool.write(bytes);
}

function liveStream(stage: PendingLiveStage, role: LiveInputRole): PendingLiveStream {
	const stream = stage.streams.get(role);
	if (!stream) throw new Error(`The live V14 stage did not reserve ${role}.`);
	return stream;
}

function failLiveStage(stage: PendingLiveStage, reason: unknown): void {
	if (stage.failed) return;
	stage.failed = true;
	stage.abort.abort(reason);
	for (const stream of stage.streams.values()) {
		stream.openFxTransform?.abort(reason);
		stream.spool.fail(reason);
	}
}

function assertIdentity(
	identity: FramescaperNativeRenderInputStageIdentity,
	request: ReturnType<typeof nativeRenderInputClaimRequest>,
): void {
	if (identity.planFingerprint !== request.planFingerprint || identity.projectId !== request.projectId
		|| identity.schemaFamily !== request.schemaFamily
		|| identity.schemaVersion !== request.schemaVersion
		|| identity.projectRevision !== request.projectRevision
		|| JSON.stringify(identity.inputFingerprints) !== JSON.stringify(request.inputFingerprints)) {
		throw new Error('The live V14 claim substituted its plan, project, or originals.');
	}
}

function assertLiveRecord(stage: PendingLiveStage, record: NativeRenderInputQueueRecord): void {
	if (record.recordVersion !== 3) throw new Error('Live V14 staging requires queue schema V3.');
	assertNativeQueueRecordV3(record);
	if (!stage.claimed || record.jobId !== stage.owned.ownership.stageId || record.planVersion !== 14
		|| (record.taskKind !== 'encoded-export' && record.taskKind !== 'image-sequence-export')
		|| record.planFingerprint !== stage.identity.planFingerprint
		|| record.schemaFamily !== stage.identity.schemaFamily
		|| record.schemaVersion !== stage.identity.schemaVersion
		|| record.projectId !== stage.identity.projectId
		|| record.projectRevision !== stage.identity.projectRevision
		|| JSON.stringify(record.inputFingerprints) !== JSON.stringify(stage.identity.inputFingerprints)) {
		throw new Error('The live V14 stage disagrees with its exact queue record.');
	}
}

function requiredOwner(value: unknown): object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('Live V14 staging requires its authenticated renderer owner.');
	}
	return value as object;
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || value.includes('\0')) {
		throw new TypeError('The live V14 staging path must be absolute normalized text.');
	}
	return value;
}

function liveReplayPath(directory: string, role: LiveInputRole, index: number): string {
	return join(directory, `input-${String(index).padStart(2, '0')}${
		role === 'staged-audio-mix' ? '.wav' : '.frames'}`);
}

async function filesystemAvailableBytes(root: string): Promise<number> {
	const details = await statfs(root, { bigint: true });
	const available = details.bavail * details.bsize;
	return available > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(available);
}
