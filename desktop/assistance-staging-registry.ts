/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned, process-local custody for pathless assistance data claims. */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
	ASSISTANCE_DATA_CLAIM_VERSION,
	validateAssistanceOutputClaim,
	validateAssistanceOutputReservation,
	validateAssistanceStagedInputClaim,
	type AssistanceInputRole,
	type AssistanceOutputClaim,
	type AssistanceOutputReservation,
	type AssistanceOutputRole,
	type AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
} from './helper-data-plane.ts';
import {
	assertAssistanceStagingPathIdentity,
	assertAssistanceStagingPrivateFile,
	assistanceStagingFileIdentity,
	authenticateAssistanceStagingFile,
	closeAssistanceStagingIterator,
	createAssistanceStagingPrivateFile,
	linkAssistanceStagingSignals,
	nextAssistanceStagingChunk,
	ownedAssistanceStagingChunk,
	privateAssistanceStagingDirectoryIdentity,
	sameAssistanceStagingIdentity,
	writeAssistanceStagingBytes,
	type AssistanceStagingFileIdentity,
} from './assistance-staging-private-files.ts';
import {
	errorCode,
	limit,
	opaqueId,
	sameInputClaim,
	sameOutputClaim,
	sameReservation,
} from './assistance-staging-registry-comparisons.ts';

const ZERO_SHA256 = '0'.repeat(64);
const EMPTY_SHA256 = createHash('sha256').digest('hex');
const MAXIMUM_ID_ATTEMPTS = 32;
const MAXIMUM_CLAIMS_PER_JOB = 64;
export const ASSISTANCE_STAGING_HARD_LIMITS = Object.freeze({
	maximumClaimsPerJob: MAXIMUM_CLAIMS_PER_JOB,
	maximumBytesPerClaim: HELPER_DATA_PLANE_MAXIMUM_BYTES,
	maximumAggregateBytesPerJob: HELPER_DATA_PLANE_MAXIMUM_BYTES,
	maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES,
});
export interface AssistanceStagingRegistryOptions {
	readonly root: string;
	readonly maximumClaimsPerJob?: number;
	readonly maximumBytesPerClaim?: number;
	readonly maximumAggregateBytesPerJob?: number;
	readonly maximumChunkBytes?: number;
	readonly mintId?: () => string;
}
export interface AssistanceStageInputRequest {
	readonly jobId: string; readonly role: AssistanceInputRole; readonly mediaType: string;
	readonly byteLength: number; readonly bytes: AsyncIterable<Uint8Array>;
	readonly signal?: AbortSignal;
}
export interface AssistanceReserveOutputRequest {
	readonly jobId: string; readonly role: AssistanceOutputRole; readonly mediaType: string;
	readonly maximumByteLength: number;
}
interface RegistryLimits {
	readonly maximumClaimsPerJob: number; readonly maximumBytesPerClaim: number;
	readonly maximumAggregateBytesPerJob: number; readonly maximumChunkBytes: number;
}
interface PendingRecord {
	readonly kind: 'pending'; readonly reservedBytes: number;
}

interface InputRecord {
	readonly kind: 'input'; readonly reservedBytes: number; readonly path: string;
	readonly identity: AssistanceStagingFileIdentity;
	readonly claim: AssistanceStagedInputClaim;
}
type OutputState = 'reserved' | 'granting' | 'writing' | 'authenticating' | 'authenticated' | 'invalid';
interface OutputRecord {
	readonly kind: 'output'; readonly reservedBytes: number; readonly path: string;
	readonly identity: AssistanceStagingFileIdentity;
	readonly reservation: AssistanceOutputReservation;
	state: OutputState; claim: AssistanceOutputClaim | null;
}
type ClaimRecord = PendingRecord | InputRecord | OutputRecord;
interface JobRecord {
	readonly jobId: string; readonly path: string; readonly identity: AssistanceStagingFileIdentity;
	readonly controller: AbortController; readonly claims: Map<string, ClaimRecord>;
	readonly operations: Set<Promise<unknown>>;
	status: 'active' | 'releasing'; reservedBytes: number; releasePromise: Promise<boolean> | null;
}

export class AssistanceStagingRegistry {
	readonly #root: string;
	readonly #limits: RegistryLimits;
	readonly #mintId: () => string;
	readonly #issuedIds = new Set<string>();
	readonly #jobs = new Map<string, JobRecord>();
	#rootReady: Promise<AssistanceStagingFileIdentity> | null = null;

	constructor(options: AssistanceStagingRegistryOptions) {
		if (!options || typeof options !== 'object' || typeof options.root !== 'string'
			|| !isAbsolute(options.root) || resolve(options.root) !== options.root
			|| dirname(options.root) === options.root) {
			throw new TypeError('Assistance staging needs one normalized absolute private root.');
		}
		this.#root = options.root;
		const hard = ASSISTANCE_STAGING_HARD_LIMITS;
		this.#limits = Object.freeze({
			maximumClaimsPerJob: limit(options.maximumClaimsPerJob,
				hard.maximumClaimsPerJob, hard.maximumClaimsPerJob, 'assistance claim count'),
			maximumBytesPerClaim: limit(options.maximumBytesPerClaim,
				hard.maximumBytesPerClaim, hard.maximumBytesPerClaim, 'assistance per-claim bytes'),
			maximumAggregateBytesPerJob: limit(options.maximumAggregateBytesPerJob,
				hard.maximumAggregateBytesPerJob, hard.maximumAggregateBytesPerJob, 'assistance aggregate bytes'),
			maximumChunkBytes: limit(options.maximumChunkBytes,
				hard.maximumChunkBytes, hard.maximumChunkBytes, 'assistance chunk bytes'),
		});
		this.#mintId = options.mintId ?? (() => randomBytes(20).toString('hex'));
	}

	async createJob(): Promise<string> {
		await this.#assertRoot();
		for (let attempt = 0; attempt < MAXIMUM_ID_ATTEMPTS; attempt += 1) {
			const jobId = this.#mintUniqueId();
			const path = join(this.#root, jobId);
			try {
				await mkdir(path, { recursive: false, mode: 0o700 });
			} catch (error) {
				if (errorCode(error) === 'EEXIST') continue;
				throw error;
			}
			try {
				const identity = await privateAssistanceStagingDirectoryIdentity(path, 'assistance job directory');
				this.#jobs.set(jobId, {
					jobId,
					path,
					identity,
					controller: new AbortController(),
					claims: new Map(),
					operations: new Set(),
					status: 'active',
					reservedBytes: 0,
					releasePromise: null,
				});
				return jobId;
			} catch (error) {
				await rm(path, { recursive: true, force: true }).catch(() => undefined);
				throw error;
			}
		}
		throw new Error('Assistance staging could not mint a collision-free job identity.');
	}

	stageInput(request: AssistanceStageInputRequest): Promise<AssistanceStagedInputClaim> {
		const job = this.#activeJob(request?.jobId);
		if (!request.bytes || typeof request.bytes[Symbol.asyncIterator] !== 'function') {
			return Promise.reject(new TypeError('Assistance input bytes must be an asynchronous stream.'));
		}
		const task = this.#stageInput(job, request);
		return this.#track(job, task);
	}

	reserveOutput(request: AssistanceReserveOutputRequest): Promise<AssistanceOutputReservation> {
		const job = this.#activeJob(request?.jobId);
		const task = this.#reserveOutput(job, request);
		return this.#track(job, task);
	}

	resolveInputPathForMain(
		jobId: string,
		claimValue: unknown,
		signal?: AbortSignal,
	): Promise<string> {
		const job = this.#activeJob(jobId);
		const claim = validateAssistanceStagedInputClaim(claimValue);
		this.#assertClaimJob(job, claim.jobId);
		const record = job.claims.get(claim.claimId);
		if (!record || record.kind !== 'input' || !sameInputClaim(record.claim, claim)) {
			return Promise.reject(new Error('The assistance input claim is not registered for this job.'));
		}
		return this.#track(job, this.#resolveInputPath(job, record, signal));
	}

	resolveOutputReservationPathForMain(
		jobId: string,
		reservationValue: unknown,
		signal?: AbortSignal,
	): Promise<string> {
		const job = this.#activeJob(jobId);
		const reservation = validateAssistanceOutputReservation(reservationValue);
		this.#assertClaimJob(job, reservation.jobId);
		const record = job.claims.get(reservation.claimId);
		if (!record || record.kind !== 'output' || !sameReservation(record.reservation, reservation)) {
			return Promise.reject(new Error('The assistance output reservation is not registered for this job.'));
		}
		if (record.state !== 'reserved') {
			return Promise.reject(new Error('An assistance output path may be granted exactly once.'));
		}
		record.state = 'granting';
		return this.#track(job, this.#resolveOutputReservationPath(job, record, signal));
	}

	authenticateOutput(
		jobId: string,
		reservationValue: unknown,
		signal?: AbortSignal,
	): Promise<AssistanceOutputClaim> {
		const job = this.#activeJob(jobId);
		const reservation = validateAssistanceOutputReservation(reservationValue);
		this.#assertClaimJob(job, reservation.jobId);
		const record = job.claims.get(reservation.claimId);
		if (!record || record.kind !== 'output' || !sameReservation(record.reservation, reservation)) {
			return Promise.reject(new Error('The assistance output reservation is not registered for this job.'));
		}
		if (record.state !== 'writing') {
			return Promise.reject(new Error('An assistance output may be authenticated exactly once after its path grant.'));
		}
		record.state = 'authenticating';
		return this.#track(job, this.#authenticateOutput(job, record, signal));
	}

	resolveOutputClaimPathForMain(
		jobId: string,
		claimValue: unknown,
		signal?: AbortSignal,
	): Promise<string> {
		const job = this.#activeJob(jobId);
		const claim = validateAssistanceOutputClaim(claimValue);
		this.#assertClaimJob(job, claim.jobId);
		const record = job.claims.get(claim.claimId);
		if (!record || record.kind !== 'output' || record.state !== 'authenticated'
			|| !record.claim || !sameOutputClaim(record.claim, claim)) {
			return Promise.reject(new Error('The assistance output claim is not registered for this job.'));
		}
		return this.#track(job, this.#resolveOutputClaimPath(job, record, claim, signal));
	}

	releaseJob(jobIdValue: string): Promise<boolean> {
		const jobId = opaqueId(jobIdValue, 'job');
		const job = this.#jobs.get(jobId);
		if (!job) return Promise.resolve(false);
		if (job.releasePromise) return job.releasePromise;
		job.status = 'releasing';
		job.controller.abort(new DOMException('The assistance staging job was released.', 'AbortError'));
		const operations = [...job.operations];
		const release = (async (): Promise<boolean> => {
			try {
				await Promise.allSettled(operations);
				await this.#assertJobDirectory(job);
				await rm(job.path, { recursive: true, force: false, maxRetries: 0 });
			} catch (error) {
				// Caching the rejection would make one failure permanent: every later
				// release would return the same settled promise, so a directory the
				// removal could not take on the first attempt — a helper still holding
				// the staged file — could never be reclaimed.
				job.releasePromise = null;
				throw error;
			}
			job.claims.clear();
			this.#jobs.delete(job.jobId);
			return true;
		})();
		job.releasePromise = release;
		return release;
	}

	async #stageInput(
		job: JobRecord,
		request: AssistanceStageInputRequest,
	): Promise<AssistanceStagedInputClaim> {
		const claimId = this.#mintUniqueId();
		const shape = validateAssistanceStagedInputClaim({
			claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
			claimId,
			jobId: job.jobId,
			role: request.role,
			mediaType: request.mediaType,
			byteLength: request.byteLength,
			sha256: ZERO_SHA256,
		});
		this.#assertPerClaimBytes(shape.byteLength);
		this.#reserveCapacity(job, claimId, shape.byteLength);
		const path = join(job.path, `${claimId}.input`);
		const linked = linkAssistanceStagingSignals(request.signal, job.controller.signal);
		let handle: FileHandle | null = null;
		let created = false;
		try {
			linked.signal.throwIfAborted();
			await this.#assertJobDirectory(job);
			handle = await createAssistanceStagingPrivateFile(path);
			created = true;
			const digest = createHash('sha256');
			const iterator = request.bytes[Symbol.asyncIterator]();
			let complete = false;
			let byteLength = 0;
			try {
				while (true) {
					const next = await nextAssistanceStagingChunk(iterator, linked.signal);
					if (next.done) { complete = true; break; }
					const chunk = ownedAssistanceStagingChunk(next.value, this.#limits.maximumChunkBytes);
					if (byteLength + chunk.byteLength > shape.byteLength) {
						throw new RangeError('Assistance input bytes exceed their exact declared length.');
					}
					await writeAssistanceStagingBytes(handle, chunk);
					digest.update(chunk);
					byteLength += chunk.byteLength;
				}
			} finally {
				if (!complete) closeAssistanceStagingIterator(iterator);
			}
			if (byteLength !== shape.byteLength) {
				throw new RangeError('Assistance input bytes do not match their exact declared length.');
			}
			linked.signal.throwIfAborted();
			await handle.sync();
			const metadata = await handle.stat();
			assertAssistanceStagingPrivateFile(metadata, shape.byteLength, 'staged assistance input');
			const identity = assistanceStagingFileIdentity(metadata);
			await handle.close();
			handle = null;
			linked.signal.throwIfAborted();
			await assertAssistanceStagingPathIdentity(path, identity, shape.byteLength, 'staged assistance input');
			const claim = validateAssistanceStagedInputClaim({ ...shape, sha256: digest.digest('hex') });
			job.claims.set(claimId, Object.freeze({
				kind: 'input',
				reservedBytes: shape.byteLength,
				path,
				identity,
				claim,
			}));
			return claim;
		} catch (error) {
			if (handle) await handle.close().catch(() => undefined);
			if (created) await rm(path, { force: true }).catch(() => undefined);
			this.#rollbackCapacity(job, claimId, shape.byteLength);
			throw error;
		} finally {
			linked.dispose();
		}
	}

	async #reserveOutput(
		job: JobRecord,
		request: AssistanceReserveOutputRequest,
	): Promise<AssistanceOutputReservation> {
		const claimId = this.#mintUniqueId();
		const reservation = validateAssistanceOutputReservation({
			claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
			claimId,
			jobId: job.jobId,
			role: request.role,
			mediaType: request.mediaType,
			maximumByteLength: request.maximumByteLength,
		});
		this.#assertPerClaimBytes(reservation.maximumByteLength);
		this.#reserveCapacity(job, claimId, reservation.maximumByteLength);
		const path = join(job.path, `${claimId}.output`);
		let handle: FileHandle | null = null;
		let created = false;
		try {
			job.controller.signal.throwIfAborted();
			await this.#assertJobDirectory(job);
			handle = await createAssistanceStagingPrivateFile(path);
			created = true;
			await handle.sync();
			const metadata = await handle.stat();
			assertAssistanceStagingPrivateFile(metadata, 0, 'reserved assistance output');
			const identity = assistanceStagingFileIdentity(metadata);
			await handle.close();
			handle = null;
			job.controller.signal.throwIfAborted();
			await assertAssistanceStagingPathIdentity(path, identity, 0, 'reserved assistance output');
			job.claims.set(claimId, {
				kind: 'output',
				reservedBytes: reservation.maximumByteLength,
				path,
				identity,
				reservation,
				state: 'reserved',
				claim: null,
			});
			return reservation;
		} catch (error) {
			if (handle) await handle.close().catch(() => undefined);
			if (created) await rm(path, { force: true }).catch(() => undefined);
			this.#rollbackCapacity(job, claimId, reservation.maximumByteLength);
			throw error;
		}
	}

	async #resolveInputPath(
		job: JobRecord,
		record: InputRecord,
		externalSignal?: AbortSignal,
	): Promise<string> {
		const linked = linkAssistanceStagingSignals(externalSignal, job.controller.signal);
		try {
			await this.#assertJobDirectory(job);
			const authenticated = await authenticateAssistanceStagingFile(record.path, record.identity, {
				minimumByteLength: record.claim.byteLength,
				maximumByteLength: record.claim.byteLength,
				expectedSha256: record.claim.sha256,
				signal: linked.signal,
				label: 'registered assistance input',
			});
			if (authenticated.byteLength !== record.claim.byteLength) {
				throw new Error('The registered assistance input changed length.');
			}
			return record.path;
		} finally {
			linked.dispose();
		}
	}

	async #resolveOutputReservationPath(
		job: JobRecord,
		record: OutputRecord,
		externalSignal?: AbortSignal,
	): Promise<string> {
		const linked = linkAssistanceStagingSignals(externalSignal, job.controller.signal);
		try {
			await this.#assertJobDirectory(job);
			await authenticateAssistanceStagingFile(record.path, record.identity, {
				minimumByteLength: 0,
				maximumByteLength: 0,
				expectedSha256: EMPTY_SHA256,
				signal: linked.signal,
				label: 'reserved assistance output',
			});
			linked.signal.throwIfAborted();
			record.state = 'writing';
			return record.path;
		} catch (error) {
			record.state = linked.signal.aborted ? 'reserved' : 'invalid';
			throw error;
		} finally {
			linked.dispose();
		}
	}

	async #authenticateOutput(
		job: JobRecord,
		record: OutputRecord,
		externalSignal?: AbortSignal,
	): Promise<AssistanceOutputClaim> {
		const linked = linkAssistanceStagingSignals(externalSignal, job.controller.signal);
		try {
			await this.#assertJobDirectory(job);
			const authenticated = await authenticateAssistanceStagingFile(record.path, record.identity, {
				minimumByteLength: 1,
				maximumByteLength: record.reservation.maximumByteLength,
				expectedSha256: null,
				signal: linked.signal,
				label: 'reserved assistance output',
			});
			const claim = validateAssistanceOutputClaim({
				claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
				claimId: record.reservation.claimId,
				jobId: record.reservation.jobId,
				role: record.reservation.role,
				mediaType: record.reservation.mediaType,
				byteLength: authenticated.byteLength,
				sha256: authenticated.sha256,
			}, record.reservation);
			record.claim = claim;
			record.state = 'authenticated';
			return claim;
		} catch (error) {
			record.state = linked.signal.aborted ? 'writing' : 'invalid';
			throw error;
		} finally {
			linked.dispose();
		}
	}

	async #resolveOutputClaimPath(
		job: JobRecord,
		record: OutputRecord,
		claim: AssistanceOutputClaim,
		externalSignal?: AbortSignal,
	): Promise<string> {
		const linked = linkAssistanceStagingSignals(externalSignal, job.controller.signal);
		try {
			await this.#assertJobDirectory(job);
			await authenticateAssistanceStagingFile(record.path, record.identity, {
				minimumByteLength: claim.byteLength,
				maximumByteLength: claim.byteLength,
				expectedSha256: claim.sha256,
				signal: linked.signal,
				label: 'registered assistance output',
			});
			return record.path;
		} finally {
			linked.dispose();
		}
	}

	#activeJob(jobIdValue: string): JobRecord {
		const jobId = opaqueId(jobIdValue, 'job');
		const job = this.#jobs.get(jobId);
		if (!job || job.status !== 'active') throw new Error('The assistance staging job is unknown or released.');
		return job;
	}

	#assertClaimJob(job: JobRecord, claimJobId: string): void {
		if (claimJobId !== job.jobId) throw new Error('An assistance claim belongs to another job.');
	}

	#assertPerClaimBytes(value: number): void {
		if (value > this.#limits.maximumBytesPerClaim) {
			throw new RangeError('Assistance claim bytes exceed the registry per-claim bound.');
		}
	}

	#reserveCapacity(job: JobRecord, claimId: string, bytes: number): void {
		if (job.status !== 'active') throw new Error('The assistance staging job was released.');
		if (job.claims.size >= this.#limits.maximumClaimsPerJob) {
			throw new RangeError('The assistance staging claim count is exhausted.');
		}
		if (job.claims.has(claimId)) throw new Error('An assistance claim identity is duplicated.');
		if (job.reservedBytes + bytes > this.#limits.maximumAggregateBytesPerJob) {
			throw new RangeError('Assistance aggregate bytes exceed the job bound.');
		}
		job.claims.set(claimId, Object.freeze({ kind: 'pending', reservedBytes: bytes }));
		job.reservedBytes += bytes;
	}

	#rollbackCapacity(job: JobRecord, claimId: string, bytes: number): void {
		const record = job.claims.get(claimId);
		if (record?.kind !== 'pending' || record.reservedBytes !== bytes) return;
		job.claims.delete(claimId);
		job.reservedBytes -= bytes;
	}

	#mintUniqueId(): string {
		for (let attempt = 0; attempt < MAXIMUM_ID_ATTEMPTS; attempt += 1) {
			const value = opaqueId(this.#mintId(), 'minted');
			if (this.#issuedIds.has(value)) continue;
			this.#issuedIds.add(value);
			return value;
		}
		throw new Error('Assistance staging could not mint a unique opaque identity.');
	}

	#track<Value>(job: JobRecord, operation: Promise<Value>): Promise<Value> {
		const tracked = operation.then(
			(value) => { job.operations.delete(tracked); return value; },
			(error: unknown) => { job.operations.delete(tracked); throw error; },
		);
		job.operations.add(tracked);
		return tracked;
	}

	async #assertRoot(): Promise<void> {
		this.#rootReady ??= (async () => {
			await mkdir(this.#root, { recursive: true, mode: 0o700 });
			return privateAssistanceStagingDirectoryIdentity(this.#root, 'assistance staging root');
		})();
		const expected = await this.#rootReady;
		const current = await privateAssistanceStagingDirectoryIdentity(this.#root, 'assistance staging root');
		if (!sameAssistanceStagingIdentity(expected, current)) {
			throw new Error('The assistance staging root changed identity.');
		}
	}

	async #assertJobDirectory(job: JobRecord): Promise<void> {
		await this.#assertRoot();
		const current = await privateAssistanceStagingDirectoryIdentity(job.path, 'assistance job directory');
		if (!sameAssistanceStagingIdentity(job.identity, current)) {
			throw new Error('The assistance job directory changed identity.');
		}
	}
}
