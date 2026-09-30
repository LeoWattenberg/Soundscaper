/* SPDX-License-Identifier: AGPL-3.0-only */

/** Generation-neutral durable checkpoint admission, persistence, and recovery. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import {
	admitNativeImageSequenceCheckpointManifest,
	verifyNativeImageSequenceCheckpoint,
	type FramescaperNativePublishedFileObservation,
	type NativeImageSequenceCheckpointFrameV1,
	type NativeImageSequenceCheckpointResultV1,
} from './native-services-publication.ts';
import { syncNativeCheckpointDirectory } from './native-services-checkpoint-directory-durability.ts';
import { readNativeCheckpointManifestBytes } from './native-services-checkpoint-manifest-file.ts';

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

export interface NativeCheckpointQueueRecord {
	readonly jobId: string;
	readonly taskKind: string;
	readonly recoveryClass: string;
	readonly state: string;
	readonly planPayload: string;
	readonly planFingerprint: string;
	readonly planVersion: number;
	readonly inputFingerprints: readonly unknown[];
}

export interface NativeCheckpointRecordAdapter<RecordType extends NativeCheckpointQueueRecord> {
	readonly assertRecord: (record: RecordType) => void;
	readonly createPlanEnvelope: (
		plan: unknown,
		record: RecordType,
	) => Readonly<{
		readonly fingerprint: string;
		readonly planVersion: number;
		readonly summary: Readonly<{ readonly outputFrameCount: number }>;
	}>;
}

export interface NativeCheckpointRecoveryCoreOptions<RecordType extends NativeCheckpointQueueRecord> {
	readonly record: RecordType;
	readonly rootUsable: boolean;
	readonly store?: FramescaperNativeCheckpointStore;
	readonly inspect?: (
		frame: NativeImageSequenceCheckpointFrameV1,
	) => Promise<FramescaperNativePublishedFileObservation | null>;
	readonly onError?: (error: unknown) => void;
}

export function nativeImageSequenceSourceInventoryDigestCore<RecordType extends NativeCheckpointQueueRecord>(
	record: RecordType,
	adapter: NativeCheckpointRecordAdapter<RecordType>,
): string {
	adapter.assertRecord(record);
	return createHash('sha256').update(JSON.stringify(record.inputFingerprints)).digest('hex');
}

export function admitNativeImageSequenceCheckpointEvidenceCore<RecordType extends NativeCheckpointQueueRecord>(
	record: RecordType,
	input: NativeImageSequenceCheckpointInputV1,
	adapter: NativeCheckpointRecordAdapter<RecordType>,
): NativeImageSequenceCheckpointEvidenceV1 {
	const authority = checkpointAuthority(record, adapter);
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

export async function verifyAndStoreNativeImageSequenceCheckpointCore<
	RecordType extends NativeCheckpointQueueRecord,
>(
	record: RecordType,
	input: NativeImageSequenceCheckpointInputV1,
	inspect: (frame: NativeImageSequenceCheckpointFrameV1) => Promise<FramescaperNativePublishedFileObservation | null>,
	store: FramescaperNativeCheckpointStore | undefined,
	adapter: NativeCheckpointRecordAdapter<RecordType>,
): Promise<NativeImageSequenceCheckpointResultV1> {
	if (record.state !== 'running') {
		throw new Error('Only a running image-sequence job may record a checkpoint.');
	}
	const evidence = admitNativeImageSequenceCheckpointEvidenceCore(record, input, adapter);
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

export async function recoverNativeImageSequenceCheckpointCore<
	RecordType extends NativeCheckpointQueueRecord,
>(
	options: NativeCheckpointRecoveryCoreOptions<RecordType>,
	adapter: NativeCheckpointRecordAdapter<RecordType>,
): Promise<Readonly<{ readonly verifiedFrameCount?: number; readonly plannedFrameCount?: number }>> {
	if (options.record.taskKind !== 'image-sequence-export'
		|| options.record.recoveryClass !== 'verified-frame-checkpoint') return Object.freeze({});
	const authority = checkpointAuthority(options.record, adapter);
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
			const bytes = await readNativeCheckpointManifestBytes(
				join(directory, CHECKPOINT_FILE),
				FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES,
			);
			return bytes === null ? null : JSON.parse(bytes.toString('utf8')) as unknown;
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
			await syncNativeCheckpointDirectory(directory);
		},
	});
}

function checkpointAuthority<RecordType extends NativeCheckpointQueueRecord>(
	record: RecordType,
	adapter: NativeCheckpointRecordAdapter<RecordType>,
): Readonly<{
	planFingerprint: string;
	sourceInventoryDigest: string;
	plannedFrameCount: number;
}> {
	adapter.assertRecord(record);
	if (record.taskKind !== 'image-sequence-export'
		|| record.recoveryClass !== 'verified-frame-checkpoint') {
		throw new Error('Only an exact checkpointed image-sequence queue record has checkpoint authority.');
	}
	let plan: unknown;
	try { plan = JSON.parse(record.planPayload) as unknown; }
	catch { throw new Error('The checkpoint queue plan is not canonical JSON.'); }
	const envelope = adapter.createPlanEnvelope(plan, record);
	if (envelope.fingerprint !== record.planFingerprint || envelope.planVersion !== record.planVersion) {
		throw new Error('The checkpoint queue plan changed identity.');
	}
	return Object.freeze({
		planFingerprint: record.planFingerprint,
		sourceInventoryDigest: nativeImageSequenceSourceInventoryDigestCore(record, adapter),
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
		version: 1 as const,
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
		const bytes = await readNativeCheckpointManifestBytes(
			join(directory, 'manifest.json'),
			FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES,
		);
		if (bytes === null) return null;
		const manifest = JSON.parse(bytes.toString('utf8')) as unknown;
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
