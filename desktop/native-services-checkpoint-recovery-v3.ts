/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-private persistence and restart verification for image-sequence progress. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	assertNativeQueueRecordV3,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import {
	admitNativeImageSequenceCheckpointManifest,
	verifyNativeImageSequenceCheckpoint,
	type FramescaperNativePublishedFileObservation,
	type NativeImageSequenceCheckpointFrameV1,
	type NativeImageSequenceCheckpointResultV1,
} from './native-services-publication.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^[a-f0-9]{40}$/u;
export const FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES = 64 * 1024;
const MAXIMUM_CHECKPOINT_FRAMES = 2_000_000;
const CHECKPOINT_FILE = 'image-sequence-checkpoint-v1.json';
const CHECKPOINT_TEMPORARY_FILE = 'image-sequence-checkpoint-v1.partial';

export interface NativeImageSequenceCheckpointEvidenceV1 {
	readonly version: 1;
	readonly jobId: string;
	readonly planFingerprint: string;
	readonly sourceInventoryDigest: string;
	readonly plannedFrameCount: number;
	readonly manifest: readonly NativeImageSequenceCheckpointFrameV1[];
}

export interface FramescaperNativeCheckpointStore {
	readonly read: (jobId: string) => Promise<unknown | null>;
	readonly write: (evidence: NativeImageSequenceCheckpointEvidenceV1) => Promise<void>;
}

export interface NativeImageSequenceCheckpointInputV1 {
	readonly sourceInventoryDigest: string;
	readonly plannedFrameCount: number;
	readonly manifest: readonly NativeImageSequenceCheckpointFrameV1[];
}

export interface FramescaperNativeCheckpointRecoveryV3Options {
	readonly record: NativeQueueRecordV3;
	readonly rootUsable: boolean;
	readonly store?: FramescaperNativeCheckpointStore;
	readonly inspect?: (
		frame: NativeImageSequenceCheckpointFrameV1,
	) => Promise<FramescaperNativePublishedFileObservation | null>;
	readonly onError?: (error: unknown) => void;
}

export function nativeImageSequenceSourceInventoryDigestV3(record: NativeQueueRecordV3): string {
	assertNativeQueueRecordV3(record);
	return createHash('sha256').update(JSON.stringify(record.inputFingerprints)).digest('hex');
}

/**
 * Build the exact durable representation and enforce its 64 KiB ceiling before
 * any frame inspection. This is also the narrow admission seam for main IPC.
 */
export function admitNativeImageSequenceCheckpointEvidenceV3(
	record: NativeQueueRecordV3,
	input: NativeImageSequenceCheckpointInputV1,
): NativeImageSequenceCheckpointEvidenceV1 {
	const authority = checkpointAuthority(record);
	if (input.sourceInventoryDigest !== authority.sourceInventoryDigest
		|| input.plannedFrameCount !== authority.plannedFrameCount) {
		throw new Error('The image-sequence checkpoint does not match its queued plan and source inventory.');
	}
	const admitted = admitNativeImageSequenceCheckpointManifest({
		planFingerprint: authority.planFingerprint,
		sourceInventoryDigest: authority.sourceInventoryDigest,
		plannedFrameCount: authority.plannedFrameCount,
		manifest: input.manifest,
	});
	const evidence = Object.freeze({
		version: 1 as const,
		jobId: record.jobId,
		planFingerprint: admitted.planFingerprint,
		sourceInventoryDigest: admitted.sourceInventoryDigest,
		plannedFrameCount: admitted.plannedFrameCount,
		manifest: admitted.manifest,
	});
	assertCheckpointEvidenceByteCeiling(evidence);
	return evidence;
}

export function nativeImageSequenceCheckpointEvidenceByteLength(
	evidence: NativeImageSequenceCheckpointEvidenceV1,
): number {
	return Buffer.byteLength(JSON.stringify(evidence), 'utf8');
}

/** Verify a live checkpoint before retaining only its authenticated contiguous prefix. */
export async function verifyAndStoreNativeImageSequenceCheckpointV3(
	record: NativeQueueRecordV3,
	input: NativeImageSequenceCheckpointInputV1,
	inspect: (frame: NativeImageSequenceCheckpointFrameV1) => Promise<FramescaperNativePublishedFileObservation | null>,
	store?: FramescaperNativeCheckpointStore,
): Promise<NativeImageSequenceCheckpointResultV1> {
	if (record.state !== 'running') {
		throw new Error('Only a running image-sequence job may record a checkpoint.');
	}
	const evidence = admitNativeImageSequenceCheckpointEvidenceV3(record, input);
	const result = await verifyNativeImageSequenceCheckpoint({
		planFingerprint: evidence.planFingerprint,
		sourceInventoryDigest: evidence.sourceInventoryDigest,
		plannedFrameCount: evidence.plannedFrameCount,
		manifest: evidence.manifest,
		inspect,
	});
	if (store) {
		await store.write(Object.freeze({
			...evidence,
			manifest: Object.freeze(evidence.manifest.slice(0, result.verifiedFrameCount)),
		}));
	}
	return result;
}

/** Re-open persisted evidence and re-hash every output before queue recovery may resume. */
export async function recoverNativeImageSequenceCheckpointV3(
	options: FramescaperNativeCheckpointRecoveryV3Options,
): Promise<Readonly<{ readonly verifiedFrameCount?: number; readonly plannedFrameCount?: number }>> {
	if (options.record.taskKind !== 'image-sequence-export'
		|| options.record.recoveryClass !== 'verified-frame-checkpoint') return Object.freeze({});
	const authority = checkpointAuthority(options.record);
	const restart = Object.freeze({ verifiedFrameCount: 0, plannedFrameCount: authority.plannedFrameCount });
	if (!options.rootUsable || !options.store || !options.inspect) return restart;
	try {
		const stored = await options.store.read(options.record.jobId);
		if (stored === null) return restart;
		const evidence = checkpointEvidence(stored);
		if (evidence.jobId !== options.record.jobId
			|| evidence.planFingerprint !== authority.planFingerprint
			|| evidence.sourceInventoryDigest !== authority.sourceInventoryDigest
			|| evidence.plannedFrameCount !== authority.plannedFrameCount) {
			throw new Error('Persisted image-sequence checkpoint authority is stale.');
		}
		return await verifyNativeImageSequenceCheckpoint({
			planFingerprint: authority.planFingerprint,
			sourceInventoryDigest: authority.sourceInventoryDigest,
			plannedFrameCount: authority.plannedFrameCount,
			manifest: evidence.manifest,
			inspect: options.inspect,
		});
	} catch (error) {
		options.onError?.(error);
		return restart;
	}
}

/** A process-restart durable store inside the exact main-owned job scratch directory. */
export function createFramescaperNativeFilesystemCheckpointStore(
	scratchRootValue: string,
): FramescaperNativeCheckpointStore {
	const scratchRoot = absolutePath(scratchRootValue);
	return Object.freeze({
		read: async (jobIdValue: string) => {
			const directory = await ownedScratchDirectory(scratchRoot, jobIdValue);
			if (directory === null) return null;
			try {
				const bytes = await readBoundedRegularFile(join(directory, CHECKPOINT_FILE));
				return JSON.parse(bytes.toString('utf8')) as unknown;
			} catch (error) {
				if (missing(error)) return null;
				throw error;
			}
		},
		write: async (evidenceValue: NativeImageSequenceCheckpointEvidenceV1) => {
			const evidence = checkpointEvidence(evidenceValue);
			const directory = await ownedScratchDirectory(scratchRoot, evidence.jobId);
			if (directory === null) throw new Error('The checkpoint job has no authenticated scratch directory.');
			const bytes = Buffer.from(JSON.stringify(evidence));
			if (bytes.byteLength > FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES) {
				throw new RangeError('The image-sequence checkpoint exceeds its durable manifest ceiling.');
			}
			const temporary = join(directory, CHECKPOINT_TEMPORARY_FILE);
			const destination = join(directory, CHECKPOINT_FILE);
			await removeRegularFileIfPresent(temporary);
			await refuseSymbolicLinkIfPresent(destination);
			const handle = await open(
				temporary,
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
				0o600,
			);
			try {
				await handle.writeFile(bytes);
				await handle.sync();
			} finally {
				await handle.close();
			}
			if (await ownedScratchDirectory(scratchRoot, evidence.jobId) !== directory) {
				await unlink(temporary).catch(() => undefined);
				throw new Error('The checkpoint scratch authority changed during persistence.');
			}
			await rename(temporary, destination);
		},
	});
}

function checkpointAuthority(record: NativeQueueRecordV3): Readonly<{
	planFingerprint: string;
	sourceInventoryDigest: string;
	plannedFrameCount: number;
}> {
	assertNativeQueueRecordV3(record);
	if (record.taskKind !== 'image-sequence-export'
		|| record.recoveryClass !== 'verified-frame-checkpoint') {
		throw new Error('Only an exact checkpointed image-sequence queue record has checkpoint authority.');
	}
	let plan: unknown;
	try { plan = JSON.parse(record.planPayload) as unknown; }
	catch { throw new Error('The checkpoint queue plan is not canonical JSON.'); }
	// The selected route enqueues exact plan V14, which the V1 envelope (plans
	// seven through twelve) refuses — making every real checkpoint write an
	// unsupported-version error. Resolve the envelope by the record's own
	// plan version instead.
	const envelope = record.planVersion >= 13
		? createNativeMediaPlanEnvelopeV2(plan)
		: createNativeMediaPlanEnvelopeV1(plan);
	if (envelope.fingerprint !== record.planFingerprint || envelope.planVersion !== record.planVersion) {
		throw new Error('The checkpoint queue plan changed identity.');
	}
	return Object.freeze({
		planFingerprint: record.planFingerprint,
		sourceInventoryDigest: nativeImageSequenceSourceInventoryDigestV3(record),
		plannedFrameCount: envelope.summary.outputFrameCount,
	});
}

function checkpointEvidence(value: unknown): NativeImageSequenceCheckpointEvidenceV1 {
	if (!plainExactRecord(value, [
		'version', 'jobId', 'planFingerprint', 'sourceInventoryDigest', 'plannedFrameCount', 'manifest',
	]) || value.version !== 1 || typeof value.jobId !== 'string' || !JOB_ID.test(value.jobId)
		|| typeof value.planFingerprint !== 'string' || !SHA256.test(value.planFingerprint)
		|| typeof value.sourceInventoryDigest !== 'string' || !SHA256.test(value.sourceInventoryDigest)
		|| !Number.isSafeInteger(value.plannedFrameCount) || Number(value.plannedFrameCount) < 1
		|| Number(value.plannedFrameCount) > MAXIMUM_CHECKPOINT_FRAMES
		|| !Array.isArray(value.manifest) || value.manifest.length > Number(value.plannedFrameCount)) {
		throw new TypeError('Persisted image-sequence checkpoint evidence is malformed.');
	}
	const admitted = admitNativeImageSequenceCheckpointManifest({
		planFingerprint: value.planFingerprint,
		sourceInventoryDigest: value.sourceInventoryDigest,
		plannedFrameCount: Number(value.plannedFrameCount),
		manifest: value.manifest as readonly NativeImageSequenceCheckpointFrameV1[],
	});
	const evidence = Object.freeze({
		version: 1,
		jobId: value.jobId,
		planFingerprint: admitted.planFingerprint,
		sourceInventoryDigest: admitted.sourceInventoryDigest,
		plannedFrameCount: admitted.plannedFrameCount,
		manifest: admitted.manifest,
	});
	assertCheckpointEvidenceByteCeiling(evidence);
	return evidence;
}

async function ownedScratchDirectory(scratchRoot: string, jobIdValue: string): Promise<string | null> {
	const jobId = exactJobId(jobIdValue);
	const directory = join(scratchRoot, `job-${jobId}`);
	try {
		const stat = await lstat(directory);
		if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) {
			throw new Error('The checkpoint scratch path is not one canonical regular directory.');
		}
		const manifest = JSON.parse((await readBoundedRegularFile(join(directory, 'manifest.json'))).toString('utf8')) as unknown;
		if (!plainExactRecord(manifest, ['jobId', 'manifestDigest', 'rootIdentity'])
			|| manifest.jobId !== jobId || typeof manifest.manifestDigest !== 'string'
			|| !SHA256.test(manifest.manifestDigest) || typeof manifest.rootIdentity !== 'string'
			|| manifest.rootIdentity.length === 0 || manifest.rootIdentity.length > 256) {
			throw new Error('The checkpoint scratch ownership manifest is invalid.');
		}
		return directory;
	} catch (error) {
		if (missing(error)) return null;
		throw error;
	}
}

async function readBoundedRegularFile(path: string): Promise<Buffer> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES) {
			throw new Error('A checkpoint manifest is not one bounded regular file.');
		}
		const bytes = Buffer.alloc(stat.size);
		const result = await handle.read(bytes, 0, bytes.length, 0);
		if (result.bytesRead !== bytes.length) throw new Error('A checkpoint manifest changed during inspection.');
		return bytes;
	} finally {
		await handle.close();
	}
}

async function removeRegularFileIfPresent(path: string): Promise<void> {
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('A checkpoint temporary path is unsafe.');
		await unlink(path);
	} catch (error) {
		if (!missing(error)) throw error;
	}
}

async function refuseSymbolicLinkIfPresent(path: string): Promise<void> {
	try {
		if ((await lstat(path)).isSymbolicLink()) throw new Error('A checkpoint destination must not be a symbolic link.');
	} catch (error) {
		if (!missing(error)) throw error;
	}
}

function exactJobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID.test(value)) throw new TypeError('A checkpoint requires an exact job ID.');
	return value;
}

function absolutePath(value: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || value.includes('\0')) {
		throw new TypeError('The checkpoint store requires an absolute normalized scratch root.');
	}
	return value;
}

function plainExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype
		&& Object.keys(value).sort().join('|') === [...fields].sort().join('|'));
}

function missing(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error
		&& (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}

function assertCheckpointEvidenceByteCeiling(
	evidence: NativeImageSequenceCheckpointEvidenceV1,
): void {
	if (nativeImageSequenceCheckpointEvidenceByteLength(evidence)
		> FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES) {
		throw new RangeError('The image-sequence checkpoint exceeds its 64 KiB durable manifest ceiling.');
	}
}
