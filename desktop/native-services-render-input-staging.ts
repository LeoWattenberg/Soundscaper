/* SPDX-License-Identifier: AGPL-3.0-only */

/** Durable, main-owned admission for renderer-evaluated selected-V20 V7 inputs. */

import { constants as fsConstants } from 'node:fs';
import {
	copyFile, unlink, writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import type { NativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import {
	assertNativeQueueRecordV2,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import type { HelperDataPlaneBinding } from './helper-data-plane.ts';
import {
	receiveHelperDataPlaneFile,
	type HelperDataPlaneIoPort,
} from './helper-data-plane-io.ts';
import type { HelperFileInputGrant } from './helper-native-job-contract.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES,
	FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_VERSION,
	FRAMESCAPER_NATIVE_RENDER_INPUT_TOTAL_MAXIMUM_BYTES,
	nativeRenderInputBeginRequest,
	nativeRenderInputClaimRequest,
	nativeRenderInputDataBinding,
	nativeRenderInputDeclaredBytes,
	nativeRenderInputDescriptorsForPlan,
	nativeRenderInputDigest,
	nativeRenderInputExactV7Envelope,
	nativeRenderInputFingerprints,
	nativeRenderInputIdentifier,
	nativeRenderInputNonNegative,
	nativeRenderInputReceiveRequest,
	nativeRenderInputSafeSum,
	nativeRenderInputStageBindingDigest,
	nativeRenderInputStageIdentityDigest,
	nativeRenderInputStageId,
	nativeRenderInputStageIdRequest,
	type FramescaperNativeRenderInputStageAdmissionV1,
	type FramescaperNativeRenderInputStageIdentity,
} from './native-services-render-input-contract.ts';
import {
	createNativeRenderInputOwnedStage,
	createNativeRenderInputStageOwnership,
	listNativeRenderInputOwnedStages,
	readNativeRenderInputOwnedStage,
	removeNativeRenderInputOwnedStage,
	requireNativeRenderInputRoot,
	type NativeRenderInputOwnedStage,
} from './native-services-render-input-durable-store.ts';
import {
	assertNativeRenderInputLiveOwnedStage,
	nativeRenderInputManifestFileName,
	type NativeRenderInputStagedFile,
	type NativeRenderInputStageManifest,
} from './native-services-render-input-manifest.ts';
import {
	inspectExactNativeRenderInputFile,
	inspectNativeRenderDerivedFile,
	nativeRenderInputFileIdentity,
	sameNativeRenderInputFileIdentity,
	type FramescaperNativeRenderInputDescriptorV1,
} from './native-services-render-input-validation.ts';

export {
	FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES,
	FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_EXPIRY_MS,
	FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_MAXIMUM_BYTES,
	FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_VERSION,
	FRAMESCAPER_NATIVE_RENDER_INPUT_TOTAL_MAXIMUM_BYTES,
} from './native-services-render-input-contract.ts';
export type {
	FramescaperNativeRenderInputStageAdmissionV1,
	FramescaperNativeRenderInputStageBeginRequestV1,
} from './native-services-render-input-contract.ts';
export type {
	FramescaperNativeDerivedRenderInputRole,
	FramescaperNativeRenderInputDescriptorV1,
} from './native-services-render-input-validation.ts';

export interface FramescaperNativeDerivedRenderInputs {
	readonly byteLength: number;
	readonly materialize: (directory: string) => Promise<readonly HelperFileInputGrant[]>;
}

export interface FramescaperNativeRenderInputStagingOptions {
	readonly root: string;
	readonly mintStageId: () => string;
	readonly now?: () => number;
}

export interface FramescaperNativeRenderInputReclamationResult {
	readonly scannedStages: number;
	readonly preservedStages: number;
	readonly removedStages: number;
	readonly reclaimedDeclaredBytes: number;
}

/** Queue-owned hooks; callers never receive a staging path or filesystem capability. */
export interface FramescaperNativeRenderInputSettlementPort {
	readonly revalidate: (record: NativeQueueRecordV2) => Promise<boolean>;
	readonly inspect: (record: NativeQueueRecordV2) => Promise<FramescaperNativeDerivedRenderInputs>;
	readonly settle: (
		record: NativeQueueRecordV2,
		outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed',
	) => Promise<void>;
	readonly remove: (record: NativeQueueRecordV2) => Promise<void>;
}

/** Main lifecycle hooks for renderer loss, explicit action failure, and startup recovery. */
export interface FramescaperNativeRenderInputLifecyclePort {
	readonly abandon: (owner: object, value: Readonly<{ stageId: string }>) => Promise<void>;
	readonly abandonOwner: (owner: object) => Promise<number>;
	readonly reclaim: (
		liveRecords: readonly NativeQueueRecordV2[],
	) => Promise<FramescaperNativeRenderInputReclamationResult>;
}

interface PendingStage {
	readonly owner: object;
	readonly owned: NativeRenderInputOwnedStage;
	readonly envelope: NativeMediaPlanEnvelopeV1 & Readonly<{ planVersion: 7 }>;
	readonly identity: FramescaperNativeRenderInputStageIdentity;
	readonly descriptors: readonly FramescaperNativeRenderInputDescriptorV1[];
	readonly bindings: readonly HelperDataPlaneBinding[];
	readonly states: Array<'waiting' | 'receiving' | 'received'>;
	readonly transfers: Array<Promise<void> | null>;
	readonly abort: AbortController;
	finalized: boolean;
	claimed: boolean;
}

export class FramescaperNativeRenderInputStaging
	implements FramescaperNativeRenderInputSettlementPort, FramescaperNativeRenderInputLifecyclePort {
	readonly #root: string;
	readonly #mintStageId: () => string;
	readonly #now: () => number;
	readonly #pending = new Map<string, PendingStage>();
	readonly #revokedOwners = new WeakSet<object>();
	#mutations: Promise<void> = Promise.resolve();

	constructor(options: FramescaperNativeRenderInputStagingOptions) {
		if (!options || typeof options !== 'object' || Array.isArray(options)
			|| typeof options.mintStageId !== 'function'
			|| (options.now !== undefined && typeof options.now !== 'function')
			|| Reflect.ownKeys(options).some((key) => (
				typeof key !== 'string' || !['root', 'mintStageId', 'now'].includes(key)
			))) {
			throw new TypeError('Native render-input staging requires exact main-owned options.');
		}
		this.#root = absolutePath(options.root);
		this.#mintStageId = options.mintStageId;
		this.#now = options.now ?? Date.now;
	}

	async begin(ownerValue: unknown, value: unknown): Promise<FramescaperNativeRenderInputStageAdmissionV1> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = nativeRenderInputBeginRequest(value);
		const envelope = nativeRenderInputExactV7Envelope(request.planPayload, request.planFingerprint);
		const descriptors = nativeRenderInputDescriptorsForPlan(request.derivedInputs, envelope);
		const identity = Object.freeze({
			planFingerprint: envelope.fingerprint,
			projectId: nativeRenderInputIdentifier(request.projectId, 'project id'),
			projectRevision: nativeRenderInputNonNegative(request.projectRevision, 'project revision'),
			inputFingerprints: nativeRenderInputFingerprints(request.inputFingerprints),
		});
		const declaredByteLength = nativeRenderInputDeclaredBytes(descriptors);
		return this.#mutate(async () => {
			this.#activeOwner(owner);
			const inventory = await listNativeRenderInputOwnedStages(this.#root);
			if (inventory.filter(({ claimedMarkerPresent }) => !claimedMarkerPresent).length
				>= FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES) {
				throw new RangeError('Native render-input staging reached its pending-stage ceiling.');
			}
			const durableBytes = inventory.reduce(
				(sum, stage) => nativeRenderInputSafeSum(sum, stage.ownership.declaredByteLength), 0,
			);
			if (nativeRenderInputSafeSum(durableBytes, declaredByteLength)
				> FRAMESCAPER_NATIVE_RENDER_INPUT_TOTAL_MAXIMUM_BYTES) {
				throw new RangeError('Native render-input staging reached its aggregate durable-byte ceiling.');
			}
			const id = nativeRenderInputStageId(this.#mintStageId());
			if (this.#pending.has(id)) throw new Error('A native render-input stage identity was replayed.');
			const ownership = createNativeRenderInputStageOwnership(
				id,
				this.#now(),
				declaredByteLength,
				nativeRenderInputStageIdentityDigest(identity),
				nativeRenderInputStageBindingDigest(identity, descriptors),
			);
			const owned = await createNativeRenderInputOwnedStage(this.#root, ownership);
			if (this.#revokedOwners.has(owner)) {
				await removeNativeRenderInputOwnedStage(owned);
				throw new Error('The native render-input owner was revoked during stage admission.');
			}
			const bindings = Object.freeze(descriptors.map((descriptor, index) => (
				nativeRenderInputDataBinding(id, index, descriptor)
			)));
			this.#pending.set(id, {
				owner, owned, envelope, identity, descriptors, bindings,
				states: descriptors.map(() => 'waiting'),
				transfers: descriptors.map(() => null),
				abort: new AbortController(), finalized: false, claimed: false,
			});
			return Object.freeze({
				stageVersion: FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_VERSION,
				stageId: id,
				inputs: Object.freeze(descriptors.map((descriptor, inputIndex) => Object.freeze({
					inputIndex, role: descriptor.role, binding: bindings[inputIndex]!,
				}))),
			});
		});
	}

	async receive(ownerValue: unknown, value: unknown, port: HelperDataPlaneIoPort): Promise<void> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = nativeRenderInputReceiveRequest(value);
		const stage = this.#ownedPending(owner, request.stageId);
		if (stage.finalized) throw new Error('The native render-input stage is already finalized.');
		stage.abort.signal.throwIfAborted();
		const expected = stage.bindings[request.inputIndex];
		if (!expected || JSON.stringify(expected) !== JSON.stringify(request.binding)) {
			throw new Error('A native render-input stream changed its exact binding.');
		}
		if (stage.states[request.inputIndex] !== 'waiting') {
			throw new Error('A native render-input stream was already received or replayed.');
		}
		stage.states[request.inputIndex] = 'receiving';
		const transfer = receiveHelperDataPlaneFile({
			binding: expected, port,
			path: join(stage.owned.directory, nativeRenderInputManifestFileName(
				request.inputIndex, stage.descriptors[request.inputIndex]!.role,
			)),
			signal: stage.abort.signal,
			localCancelReason: 'host-abort',
		}).then(() => {
			stage.states[request.inputIndex] = 'received';
		}, (error: unknown) => {
			stage.states[request.inputIndex] = 'waiting';
			throw error;
		});
		stage.transfers[request.inputIndex] = transfer;
		await transfer;
	}

	async finalize(ownerValue: unknown, value: unknown): Promise<Readonly<{ stageId: string }>> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = nativeRenderInputStageIdRequest(value, 'finalization');
		const stage = this.#ownedPending(owner, request.stageId);
		if (stage.finalized) throw new Error('The native render-input stage is already finalized.');
		await Promise.all(stage.transfers.filter((transfer): transfer is Promise<void> => transfer !== null));
		stage.abort.signal.throwIfAborted();
		if (stage.states.some((state) => state !== 'received')) {
			throw new Error('Every exact native render input must arrive before finalization.');
		}
		const files: NativeRenderInputStagedFile[] = [];
		for (const [index, descriptor] of stage.descriptors.entries()) {
			const path = join(stage.owned.directory,
				nativeRenderInputManifestFileName(index, descriptor.role));
			await inspectNativeRenderDerivedFile(path, descriptor, stage.envelope);
			files.push(Object.freeze({
				...descriptor, name: nativeRenderInputManifestFileName(index, descriptor.role),
				identity: await nativeRenderInputFileIdentity(path),
			}));
		}
		const manifest: NativeRenderInputStageManifest = Object.freeze({
			stageVersion: 1, stageId: request.stageId, planVersion: 7,
			...stage.identity, files: Object.freeze(files),
		});
		const payload = JSON.stringify(manifest);
		await writeFile(join(stage.owned.directory, 'manifest.json'), payload, { flag: 'wx', mode: 0o600 });
		await writeFile(join(stage.owned.directory, 'manifest.sha256'),
			`${nativeRenderInputDigest(payload)}\n`, { flag: 'wx', mode: 0o600 });
		stage.finalized = true;
		return Object.freeze({ stageId: request.stageId });
	}

	async claim(ownerValue: unknown, value: unknown): Promise<void> {
		const owner = this.#activeOwner(requiredOwner(ownerValue));
		const request = nativeRenderInputClaimRequest(value);
		await this.#mutate(async () => {
			this.#activeOwner(owner);
			const stage = this.#ownedPending(owner, request.derivedInputStageId);
			if (!stage.finalized) throw new Error('A native render-input stage must be finalized before enqueue.');
			assertClaimIdentity(stage.identity, request);
			await writeFile(join(stage.owned.directory, 'claimed.json'), JSON.stringify({
				stageVersion: 1, jobId: request.derivedInputStageId,
			}), { flag: 'wx', mode: 0o600 }).catch((error: unknown) => {
				if (hasCode(error, 'EEXIST')) throw new Error('The native render-input stage is already claimed.');
				throw error;
			});
			stage.claimed = true;
		});
	}

	async rollbackClaim(ownerValue: unknown, value: unknown): Promise<void> {
		const owner = requiredOwner(ownerValue);
		const request = nativeRenderInputStageIdRequest(value, 'claim rollback');
		await this.#mutate(async () => {
			const stage = this.#ownedPending(owner, request.stageId);
			await unlink(join(stage.owned.directory, 'claimed.json')).catch((error: unknown) => {
				if (!hasCode(error, 'ENOENT')) throw error;
			});
			if (this.#revokedOwners.has(owner)) {
				await removeNativeRenderInputOwnedStage(stage.owned);
				this.#pending.delete(request.stageId);
			} else stage.claimed = false;
		});
	}

	async abandon(ownerValue: unknown, value: Readonly<{ stageId: string }>): Promise<void> {
		const owner = requiredOwner(ownerValue);
		const request = nativeRenderInputStageIdRequest(value, 'abandonment');
		const stage = this.#ownedPending(owner, request.stageId);
		if (stage.claimed) throw new Error('A claimed native render-input stage requires queue-owned removal.');
		stage.abort.abort();
		await Promise.allSettled(stage.transfers.filter(
			(transfer): transfer is Promise<void> => transfer !== null,
		));
		await this.#mutate(async () => {
			const current = this.#ownedPending(owner, request.stageId);
			if (current.claimed) throw new Error('A claimed native render-input stage requires queue-owned removal.');
			await removeNativeRenderInputOwnedStage(current.owned);
			this.#pending.delete(request.stageId);
		});
	}

	async abandonOwner(ownerValue: unknown): Promise<number> {
		const owner = requiredOwner(ownerValue);
		this.#revokedOwners.add(owner);
		const transfers: Promise<void>[] = [];
		for (const stage of this.#pending.values()) {
			if (stage.owner !== owner || stage.claimed) continue;
			stage.abort.abort();
			transfers.push(...stage.transfers.filter(
				(transfer): transfer is Promise<void> => transfer !== null,
			));
		}
		await Promise.allSettled(transfers);
		return this.#mutate(async () => {
			let removed = 0;
			const failures: unknown[] = [];
			for (const [stageId, stage] of this.#pending) {
				if (stage.owner !== owner || stage.claimed) continue;
				try {
					await removeNativeRenderInputOwnedStage(stage.owned);
					this.#pending.delete(stageId);
					removed += 1;
				} catch (error) { failures.push(error); }
			}
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) {
				throw new AggregateError(failures, 'Native render-input owner cleanup failed.');
			}
			return removed;
		});
	}

	async reclaim(
		liveRecords: readonly NativeQueueRecordV2[],
	): Promise<FramescaperNativeRenderInputReclamationResult> {
		const live = exactLiveRecords(liveRecords);
		return this.#mutate(async () => {
			const inventory = await listNativeRenderInputOwnedStages(this.#root);
			let preservedStages = 0;
			let removedStages = 0;
			let reclaimedDeclaredBytes = 0;
			for (const owned of inventory) {
				const id = owned.ownership.stageId;
				const record = live.get(id);
				const pending = this.#pending.get(id);
				if (record) {
					await assertNativeRenderInputLiveOwnedStage(owned, record);
					preservedStages += 1;
					continue;
				}
				if (pending && !pending.claimed && this.#now() < owned.ownership.expiresAtMs) {
					preservedStages += 1;
					continue;
				}
				pending?.abort.abort();
				if (pending) await Promise.allSettled(pending.transfers.filter(
					(transfer): transfer is Promise<void> => transfer !== null,
				));
				await removeNativeRenderInputOwnedStage(owned);
				this.#pending.delete(id);
				removedStages += 1;
				reclaimedDeclaredBytes = nativeRenderInputSafeSum(
					reclaimedDeclaredBytes, owned.ownership.declaredByteLength,
				);
			}
			return Object.freeze({
				scannedStages: inventory.length, preservedStages, removedStages,
				reclaimedDeclaredBytes,
			});
		});
	}

	async revalidate(record: NativeQueueRecordV2): Promise<boolean> {
		if (record.planVersion !== 7) return true;
		try { await this.inspect(record); return true; } catch { return false; }
	}

	async inspect(recordValue: NativeQueueRecordV2): Promise<FramescaperNativeDerivedRenderInputs> {
		assertNativeQueueRecordV2(recordValue);
		if (recordValue.planVersion !== 7) {
			return Object.freeze({ byteLength: 0, materialize: async () => Object.freeze([]) });
		}
		const owned = await readNativeRenderInputOwnedStage(this.#root, recordValue.jobId);
		if (owned === null) throw new Error('The durable native render-input ownership record is missing.');
		const manifest = await assertNativeRenderInputLiveOwnedStage(owned, recordValue);
		const envelope = nativeRenderInputExactV7Envelope(
			recordValue.planPayload, recordValue.planFingerprint,
		);
		for (const file of manifest.files) {
			const path = join(owned.directory, file.name);
			await inspectNativeRenderDerivedFile(path, file, envelope);
			if (!sameNativeRenderInputFileIdentity(
				await nativeRenderInputFileIdentity(path), file.identity,
			)) throw new Error('A durable native render input changed filesystem identity.');
		}
		const byteLength = nativeRenderInputDeclaredBytes(manifest.files);
		return Object.freeze({
			byteLength,
			materialize: async (targetValue: string) => {
				const target = await requireNativeRenderInputRoot(absolutePath(targetValue), false);
				const grants: HelperFileInputGrant[] = [];
				for (const [index, file] of manifest.files.entries()) {
					const source = join(owned.directory, file.name);
					const path = join(target,
						`derived-${String(index).padStart(2, '0')}${file.role === 'staged-audio-mix' ? '.wav' : '.frames'}`);
					await copyFile(source, path, fsConstants.COPYFILE_EXCL);
					await inspectExactNativeRenderInputFile(path, file);
					grants.push(Object.freeze({
						type: 'file', role: file.role, path, bytes: file.byteLength,
						sha256: file.sha256, identity: await nativeRenderInputFileIdentity(path),
					}));
				}
				return Object.freeze(grants);
			},
		});
	}

	async remove(recordValue: NativeQueueRecordV2): Promise<void> {
		assertNativeQueueRecordV2(recordValue);
		if (recordValue.planVersion !== 7) return;
		await this.#mutate(async () => {
			const owned = await readNativeRenderInputOwnedStage(this.#root, recordValue.jobId);
			if (owned === null) return;
			if (owned.ownership.identityDigest !== nativeRenderInputStageIdentityDigest(Object.freeze({
				planFingerprint: recordValue.planFingerprint,
				projectId: recordValue.projectId,
				projectRevision: recordValue.projectRevision,
				inputFingerprints: recordValue.inputFingerprints,
			}))) {
				throw new Error('The durable native render-input identity disagrees with its queue record.');
			}
			await removeNativeRenderInputOwnedStage(owned);
			this.#pending.delete(recordValue.jobId);
		});
	}

	async settle(
		record: NativeQueueRecordV2,
		outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed',
	): Promise<void> {
		if (!['succeeded', 'paused', 'cancelled', 'failed'].includes(outcome)) {
			throw new TypeError('A native render-input settlement has an unsupported outcome.');
		}
		if (outcome === 'succeeded' || outcome === 'cancelled') await this.remove(record);
	}

	#ownedPending(owner: object, idValue: string): PendingStage {
		const stage = this.#pending.get(nativeRenderInputStageId(idValue));
		if (!stage || stage.owner !== owner) {
			throw new Error('The native render-input stage has another owner.');
		}
		return stage;
	}

	#activeOwner(owner: object): object {
		if (this.#revokedOwners.has(owner)) {
			throw new Error('The native render-input owner was revoked.');
		}
		return owner;
	}

	async #mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
		const previous = this.#mutations;
		let release = (): void => undefined;
		this.#mutations = new Promise((resolve) => { release = resolve; });
		await previous;
		try { return await operation(); }
		finally { release(); }
	}
}

function assertClaimIdentity(
	identity: FramescaperNativeRenderInputStageIdentity,
	request: ReturnType<typeof nativeRenderInputClaimRequest>,
): void {
	if (identity.planFingerprint !== request.planFingerprint || identity.projectId !== request.projectId
		|| identity.projectRevision !== request.projectRevision
		|| JSON.stringify(identity.inputFingerprints) !== JSON.stringify(request.inputFingerprints)) {
		throw new Error('The native render-input claim substituted its plan, project, or originals.');
	}
}

function exactLiveRecords(records: readonly NativeQueueRecordV2[]): ReadonlyMap<string, NativeQueueRecordV2> {
	if (!Array.isArray(records) || Reflect.ownKeys(records).length !== records.length + 1
		|| records.length > 100_000) {
		throw new TypeError('Native render-input reclamation requires a bounded dense queue snapshot.');
	}
	const live = new Map<string, NativeQueueRecordV2>();
	for (const record of records) {
		assertNativeQueueRecordV2(record);
		if (live.has(record.jobId)) throw new Error('A native queue snapshot duplicated a job identity.');
		live.set(record.jobId, record);
	}
	return live;
}

function requiredOwner(value: unknown): object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('Native render-input staging requires its authenticated renderer owner.');
	}
	return value as object;
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value
		|| value.includes('\0')) {
		throw new TypeError('The native render-input path must be absolute normalized text.');
	}
	return value;
}

function hasCode(value: unknown, code: string): boolean {
	return Boolean(value && typeof value === 'object' && 'code' in value && value.code === code);
}
