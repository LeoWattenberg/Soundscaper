/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
	assertSoundscaperDeliveryCurrentV1,
	parseSoundscaperDeliveryPlanV1,
	sealSoundscaperDeliveryReportV1,
	SoundscaperDeliveryContractError,
	validateSoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryCurrentAuthorityV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryProjectIdentityV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import { validateSoundscaperPersistentAudioDeliveryPlanV1 } from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import {
	acquireSoundscaperDeliveryWriterLease,
	assertSoundscaperDeliveryWriterLease,
	initializeSoundscaperDeliveryDatabase,
	releaseSoundscaperDeliveryWriterLease,
	renewSoundscaperDeliveryWriterLease,
	SOUNDSCAPER_DELIVERY_LEASE_MS,
	type SoundscaperDeliveryWriterLease,
} from './soundscaper-delivery-database.ts';
import {
	SoundscaperDeliveryRootStore,
	SoundscaperDeliveryWrite,
	type SoundscaperDeliveryRoot,
} from './soundscaper-delivery-root.ts';
import type { SoundscaperDeliveryFilesystemAuthority } from './soundscaper-delivery-filesystem-authority.ts';
import { SoundscaperDeliveryPublication } from './soundscaper-delivery-publication.ts';
import { SoundscaperDeliveryQueueRepository } from './soundscaper-delivery-queue-repository.ts';
import {
	sameSoundscaperDeliveryProject as sameProject,
	admitSoundscaperDeliverySavedAdmission as savedAdmission,
	assertSoundscaperDeliveryBatchPlan as assertBatchPlan,
	soundscaperDeliveryCursor as cursor,
	soundscaperDeliveryFailureCode as safeFailureCode,
	soundscaperDeliveryId as id,
	soundscaperDeliveryNonNegativeInteger as nonNegativeInteger,
	soundscaperDeliveryPageLimit as boundedLimit,
	type SoundscaperDeliveryClaim,
	type SoundscaperDeliveryEvent,
	type SoundscaperDeliveryPersistedState,
	type SoundscaperDeliveryQueueRow as QueueRow,
	type SoundscaperDeliverySavedAdmission,
	type SoundscaperDeliveryStartOptions as StartOptions,
	type SoundscaperDeliverySummary,
} from './soundscaper-delivery-service-contract.ts';
import {
	soundscaperDeliveryDescription,
	soundscaperDeliverySummary,
} from './soundscaper-delivery-service-view.ts';
export type {
	SoundscaperDeliveryClaim, SoundscaperDeliveryEvent, SoundscaperDeliveryPersistedState,
	SoundscaperDeliverySummary, SoundscaperDeliveryVisibleState,
} from './soundscaper-delivery-service-contract.ts';
const TERMINAL = new Set<SoundscaperDeliveryPersistedState>(['completed', 'cancelled', 'stale']);

export class SoundscaperDeliveryService {
	readonly #database: DatabaseSync;
	readonly #now: () => number;
	readonly #beforeFileFence: (operation: string) => void;
	readonly #readProjectIdentity: StartOptions['readProjectIdentity'];
	readonly #filesystem: SoundscaperDeliveryFilesystemAuthority;
	readonly #repository: SoundscaperDeliveryQueueRepository;
	readonly #publication: SoundscaperDeliveryPublication;
	readonly #roots: SoundscaperDeliveryRootStore;
	readonly #writes = new Map<string, SoundscaperDeliveryWrite>();
	readonly #sealedWrites = new Map<string, SoundscaperDeliveryWrite>();
	#closed = false;
	#fenced = false;
	#lease: SoundscaperDeliveryWriterLease;
	#renewTimer: ReturnType<typeof setInterval> | null = null;

	private constructor(
		database: DatabaseSync,
		lease: SoundscaperDeliveryWriterLease,
		options: StartOptions,
	) {
		this.#database = database;
		this.#lease = lease;
		this.#now = options.now ?? Date.now;
		this.#beforeFileFence = options.beforeFileFence ?? (() => undefined);
		this.#readProjectIdentity = options.readProjectIdentity;
		this.#filesystem = options.filesystem;
		this.#roots = new SoundscaperDeliveryRootStore(database, options.observeRoot);
		this.#repository = new SoundscaperDeliveryQueueRepository(
			database, () => this.#lease, this.#now,
		);
		this.#publication = new SoundscaperDeliveryPublication({
			repository: this.#repository,
			roots: this.#roots,
			assertWriter: () => this.#assertWriter(),
			fileFence: (operation) => this.#fileFence(operation),
			assertCurrent: (description, authority) => this.#assertCurrent(description, authority),
			filesystem: this.#filesystem,
		});
	}

	static async start(options: StartOptions): Promise<SoundscaperDeliveryService> {
		if (!options || typeof options.databasePath !== 'string'
			|| typeof options.readProjectIdentity !== 'function' || !options.filesystem
			|| typeof options.filesystem.open !== 'function'
			|| typeof options.filesystem.removeRecovered !== 'function'
			|| typeof options.filesystem.inspectFinal !== 'function') {
			throw new TypeError('Soundscaper delivery startup requires a database and project authority.');
		}
		await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
		const database = new DatabaseSync(options.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 100,
		});
		try {
			await chmod(options.databasePath, 0o600);
			initializeSoundscaperDeliveryDatabase(database);
			const now = options.now ?? Date.now;
			const lease = acquireSoundscaperDeliveryWriterLease(database, {
				leaseId: randomId(),
				instanceId: options.instanceId ?? randomId(),
				processId: options.processId ?? process.pid,
				nowMs: now(),
			});
			const service = new SoundscaperDeliveryService(database, lease, options);
			await service.#publication.recover();
			service.#renewTimer = setInterval(() => { service.#renew(); }, SOUNDSCAPER_DELIVERY_LEASE_MS / 3);
			service.#renewTimer.unref?.();
			return service;
		} catch (error) {
			database.close();
			throw error;
		}
	}

	async authorizeRoot(path: unknown): Promise<Readonly<{ grantId: string }>> {
		this.#assertWriter();
		const observation = await this.#roots.prepareAuthorization(path);
		let root!: SoundscaperDeliveryRoot;
		this.#repository.mutation('root-authorized', null, null, () => {
			root = this.#roots.authorize(observation, this.#now());
		});
		return Object.freeze({ grantId: root.grantId });
	}

	async revokeRoot(grantId: string): Promise<boolean> {
		this.#assertWriter();
		let changed = false;
		this.#repository.mutation('root-revoked', null, null, () => {
			changed = this.#roots.revoke(grantId, this.#now());
		});
		if (!changed) return false;
		for (const row of this.#rows('destination_grant_id = ?', grantId)) {
			if (row.state === 'running') await this.#abortRowWrite(row);
			if (!TERMINAL.has(row.state)) this.#state(row.job_id, 'needs-authorization', 'authorization-required');
		}
		return true;
	}

	async reauthorizeRoot(grantId: string, path: unknown): Promise<Readonly<{ grantId: string }>> {
		this.#assertWriter();
		const prepared = await this.#roots.prepareReauthorization(grantId, path);
		let root!: SoundscaperDeliveryRoot;
		this.#repository.mutation('root-reauthorized', null, null, () => {
			root = this.#roots.reauthorize(prepared);
		});
		for (const row of this.#rows("destination_grant_id = ? AND state = 'needs-authorization'", grantId)) {
			if (!await this.#removePartial(row, root)) continue;
			this.#state(row.job_id, 'queued', null, { clearAttempt: true });
		}
		return Object.freeze({ grantId: root.grantId });
	}

	async enqueue(
		descriptionValue: unknown,
		batch: Readonly<{ batchId: string; member: Readonly<Record<string, unknown>> }> | null = null,
		admission?: SoundscaperDeliverySavedAdmission,
	): Promise<SoundscaperDeliverySummary> {
		const summaries = await this.enqueueBatch({
			items: [{ description: descriptionValue, batch }], admission,
		});
		return summaries[0]!;
	}

	async enqueueBatch(request: Readonly<{
		items: readonly Readonly<{
			description: unknown;
			batch: Readonly<{ batchId: string; member: Readonly<Record<string, unknown>> }> | null;
		}>[];
		admission?: SoundscaperDeliverySavedAdmission;
	}>): Promise<readonly SoundscaperDeliverySummary[]> {
		const admission = savedAdmission(request?.admission);
		if (!Array.isArray(request?.items) || request.items.length < 1 || request.items.length > 1_000) {
			throw new RangeError('A Soundscaper delivery batch must contain 1 through 1000 members.');
		}
		if (admission.planFingerprints.length !== request.items.length) {
			throw new Error('Persistent delivery admission must re-derive every member plan fingerprint.');
		}
		const items = request.items.map(({ description: value, batch }, index) => {
			const description = validateSoundscaperDeliveryDescriptionV1(value);
			const plan = validateSoundscaperPersistentAudioDeliveryPlanV1(
				parseSoundscaperDeliveryPlanV1(description),
			);
			const currentAuthority = Object.freeze({
				projectIdentity: admission.projectIdentity,
				planFingerprint: admission.planFingerprints[index]!,
			});
			assertSoundscaperDeliveryCurrentV1(description, currentAuthority);
			const root = this.#roots.require(description.destinationGrantId);
			if (root.revokedAtMs !== null) throw new Error('The selected delivery root needs authorization.');
			if ((plan.batch === null) !== (batch === null)) {
				throw new Error('Persistent delivery batch authority and exact plan batch must match, including null.');
			}
			if (batch) assertBatchPlan(description, batch);
			return { description, batch, currentAuthority, jobId: randomId() };
		});
		await this.#assertCurrent(items[0]!.description, items[0]!.currentAuthority);
		if (items.some(({ description }) => !sameProject(
			description.projectIdentity, items[0]!.description.projectIdentity,
		))) throw new Error('One persistent delivery batch must belong to one exact project revision.');
		this.#repository.insert(items);
		return Object.freeze(items.map(({ jobId }) => this.#summary(this.#row(jobId), null)));
	}

	list(request: Readonly<{
		currentProjectIdentity?: SoundscaperDeliveryProjectIdentityV1 | null;
		limit?: number;
		cursor?: string;
	}> = {}): Readonly<{ entries: readonly SoundscaperDeliverySummary[]; paused: boolean; nextCursor: string | null }> {
		this.#assertOpen();
		const limit = boundedLimit(request.limit ?? 1_000);
		const after = request.cursor === undefined ? -1 : cursor(request.cursor);
		const rows = this.#repository.page(after, limit);
		const page = rows.slice(0, limit);
		return Object.freeze({
			entries: Object.freeze(page.map((row) => this.#summary(row, request.currentProjectIdentity ?? null))),
			paused: this.#repository.paused(),
			nextCursor: rows.length > limit ? String(page.at(-1)!.position) : null,
		});
	}

	events(request: Readonly<{ afterSequence?: number; limit?: number }> = {}): Readonly<{
		events: readonly SoundscaperDeliveryEvent[]; nextSequence: number; hasMore: boolean;
	}> {
		this.#assertOpen();
		const after = nonNegativeInteger(request.afterSequence ?? 0, 'event cursor');
		const limit = boundedLimit(request.limit ?? 100);
		const rows = this.#repository.events(after, limit);
		const page = rows.slice(0, limit);
		return Object.freeze({
			events: Object.freeze(page),
			nextSequence: page.at(-1)?.sequence ?? after,
			hasMore: rows.length > limit,
		});
	}

	async claimNext(
		authority: SoundscaperDeliveryCurrentAuthorityV1,
		expectedJobId?: string,
	): Promise<SoundscaperDeliveryClaim | null> {
		this.#assertWriter();
		const project = await this.#readProjectIdentity(authority?.projectIdentity?.projectId);
		this.#assertWriter();
		if (!project || !sameProject(project, authority.projectIdentity)) {
			throw new Error('The open project is not the exact committed Soundscaper project authority.');
		}
		const paused = this.#repository.paused();
		if (paused || this.#rows("state = 'running'").length) return null;
		const candidates = expectedJobId === undefined
			? this.#rows("state = 'queued' AND project_id = ? ORDER BY position", project.projectId)
			: [this.#row(expectedJobId)].filter((row) => row.state === 'queued' && row.project_id === project.projectId);
		for (const row of candidates) {
			const description = this.#description(row);
			validateSoundscaperPersistentAudioDeliveryPlanV1(parseSoundscaperDeliveryPlanV1(description));
			try { assertSoundscaperDeliveryCurrentV1(description, authority); }
			catch (error) {
				if (!(error instanceof SoundscaperDeliveryContractError)
					|| (error.code !== 'stale-plan' && error.code !== 'stale-project')) throw error;
				this.#state(row.job_id, 'stale', error.code);
				continue;
			}
			const root = this.#roots.require(description.destinationGrantId);
			const validRoot = await this.#roots.revalidate(root);
			this.#assertWriter();
			if (!validRoot) {
				this.#state(row.job_id, 'needs-authorization', 'authorization-required');
				continue;
			}
			const claimId = randomId();
			if (!this.#repository.claim(row.job_id, claimId)) return null;
			return Object.freeze({
				jobId: row.job_id, claimId, description, plan: parseSoundscaperDeliveryPlanV1(description),
			});
		}
		return null;
	}

	/** Main-private opaque root lookup used only to re-open the directory picker for a job. */
	destinationGrantIdForJob(jobId: string): string {
		this.#assertWriter();
		return this.#description(this.#row(jobId)).destinationGrantId;
	}

	updateProgress(claimId: string, progress: number): void {
		const row = this.#claim(claimId);
		if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) {
			throw new RangeError('Soundscaper delivery progress must be from zero through one.');
		}
		this.#repository.progress(row.job_id, progress);
	}

	async beginWrite(request: Readonly<{
		claimId: string; fileName: string; size?: number; maximumSize?: number;
		finalPrefixByteLength?: number;
	}>): Promise<Readonly<{ writeId: string; chunkSize: number }>> {
		const row = this.#claim(request.claimId);
		if (row.staging_name !== null) throw new Error('This delivery claim already owns a staging file.');
		const root = this.#roots.require(row.destination_grant_id);
		const validRoot = await this.#roots.revalidate(root);
		this.#assertWriter();
		if (!validRoot) {
			this.#state(row.job_id, 'needs-authorization', 'authorization-required');
			throw new Error('The delivery destination needs authorization.');
		}
		const stagingName = randomId();
		this.#repository.prepareWrite(row.job_id, stagingName, request.fileName);
		try {
			const write = await SoundscaperDeliveryWrite.open(this.#filesystem, root, {
				...request, jobId: row.job_id, stagingName,
				assertFence: (operation) => this.#fileFence(operation),
			});
			this.#assertWriter();
			try {
				this.#repository.authenticateWrite(
					row.job_id, write.volumeIdentity, write.fileIdentity, write.stagingRecoveryToken,
				);
			} catch (error) {
				await write.abandon();
				throw error;
			}
			this.#writes.set(write.writeId, write);
			return Object.freeze({ writeId: write.writeId, chunkSize: 4 * 1024 * 1024 });
		} catch (error) {
			try { this.#assertWriter(); this.#clearStaging(row.job_id); } catch { /* fenced owner cannot mutate */ }
			throw error;
		}
	}

	async writeChunk(request: Readonly<{
		writeId: string; offset: number; bytes: Uint8Array;
	}>): Promise<Readonly<{ nextOffset: number }>> {
		const write = this.#write(request.writeId);
		this.#claim(write.claimId);
		try {
			const nextOffset = await write.write(request.offset, request.bytes);
			this.#assertWriter();
			return Object.freeze({ nextOffset });
		} catch (error) { await this.#abandonWrite(write); throw error; }
	}

	async patchFinalPrefix(request: Readonly<{
		writeId: string; bytes: Uint8Array;
	}>): Promise<Readonly<{ byteLength: number }>> {
		const write = this.#write(request.writeId);
		this.#claim(write.claimId);
		try {
			const byteLength = await write.patchFinalPrefix(request.bytes);
			this.#assertWriter();
			return Object.freeze({ byteLength });
		} catch (error) { await this.#abandonWrite(write); throw error; }
	}

	async finishWrite(writeId: string): Promise<Readonly<{ byteLength: number }>> {
		const write = this.#write(writeId);
		const row = this.#claim(write.claimId);
		try {
			const staged = await write.finish();
			this.#assertWriter();
			this.#repository.sealWrite(row.job_id, staged.byteLength, staged.sha256);
			this.#writes.delete(writeId);
			this.#sealedWrites.set(row.job_id, write);
			return Object.freeze({ byteLength: staged.byteLength });
		} catch (error) { await this.#abandonWrite(write); throw error; }
	}

	async abortWrite(writeId: string): Promise<void> {
		const write = this.#write(writeId);
		this.#writes.delete(writeId);
		await write.abort();
		this.#clearStaging(write.jobId);
	}

	async complete(request: Readonly<{
		claimId: string; report: DeliveryReport;
		currentAuthority: SoundscaperDeliveryCurrentAuthorityV1;
		revalidateAuthority: () => PromiseLike<SoundscaperDeliveryCurrentAuthorityV1> | SoundscaperDeliveryCurrentAuthorityV1;
	}>): Promise<SoundscaperDeliverySummary> {
		const row = this.#claim(request.claimId);
		const write = this.#sealedWrites.get(row.job_id);
		if (!write) throw new Error('The delivery claim has no live sealed native session.');
		try { return await this.#publication.complete(row, write, request.report, request.currentAuthority, request.revalidateAuthority); }
		finally { if (write.settled) this.#sealedWrites.delete(row.job_id); }
	}
	async fail(claimId: string, failureCode = 'render-failed', reportValue: unknown = null): Promise<void> {
		const row = this.#claim(claimId);
		const report = reportValue === null ? null : sealSoundscaperDeliveryReportV1(reportValue);
		await this.#abortRowWrite(row);
		if (!await this.#removePartial(this.#row(row.job_id))) return;
		this.#repository.settleFailed(row.job_id, safeFailureCode(failureCode), report);
	}
	/** Renderer loss is atomic restart, never a rendered failure. */
	async releaseClaim(claimId: string): Promise<void> {
		const row = this.#claim(claimId);
		await this.#abortRowWrite(row);
		if (!await this.#removePartial(this.#row(row.job_id))) return;
		this.#state(row.job_id, 'queued', null, { clearAttempt: true });
	}

	pause(): void { this.#setPaused(true); }
	resume(): void { this.#setPaused(false); }

	async cancel(jobId: string): Promise<void> {
		const row = this.#row(jobId);
		if (TERMINAL.has(row.state) || row.state === 'failed') throw new Error('The delivery job is already settled.');
		await this.#abortRowWrite(row);
		if (!await this.#removePartial(this.#row(jobId))) return;
		this.#state(jobId, 'cancelled', null);
	}

	retry(jobId: string): void {
		const row = this.#row(jobId);
		if (row.state !== 'failed' && row.state !== 'cancelled') {
			throw new Error('Only a failed or cancelled delivery can be retried.');
		}
		this.#state(jobId, 'queued', null, { clearAttempt: true });
	}

	reorder(jobId: string, position: number): void {
		const row = this.#row(jobId);
		if (row.state !== 'queued' && row.state !== 'needs-authorization') {
			throw new Error('Only an unstarted delivery can be reordered.');
		}
		const rows = this.#rows('1 = 1 ORDER BY position');
		if (!Number.isSafeInteger(position) || position < 0 || position >= rows.length) {
			throw new RangeError('The delivery queue position is outside the queue.');
		}
		this.#repository.reorder(rows, jobId, position);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		if (this.#renewTimer) clearInterval(this.#renewTimer);
		this.#renewTimer = null;
		let ownsLease = !this.#fenced;
		if (ownsLease) {
			try { assertSoundscaperDeliveryWriterLease(this.#database, this.#lease, this.#now()); }
			catch { ownsLease = false; }
		}
		try {
			for (const write of [...this.#writes.values()]) {
				if (ownsLease) await write.abort().catch(() => undefined);
				else await write.abandon().catch(() => undefined);
			}
			this.#writes.clear();
			for (const write of [...this.#sealedWrites.values()]) {
				if (ownsLease) await write.abort().catch(() => undefined);
				else await write.abandon().catch(() => undefined);
			}
			this.#sealedWrites.clear();
			if (ownsLease) {
				for (const row of this.#rows("state = 'running'")) {
					if (!this.#repository.journal(row.job_id)) await this.#publication.recoverInterrupted(row);
				}
			}
		} finally {
			this.#closed = true;
			if (ownsLease) releaseSoundscaperDeliveryWriterLease(this.#database, this.#lease);
			this.#database.close();
		}
	}

	#setPaused(paused: boolean): void {
		this.#repository.setPaused(paused);
	}

	#state(
		jobId: string,
		state: SoundscaperDeliveryPersistedState,
		failureCode: string | null,
		options: Readonly<{ clearAttempt?: boolean }> = {},
	): void {
		this.#repository.setState(jobId, state, failureCode, options.clearAttempt === true);
	}

	#clearStaging(jobId: string): void {
		this.#repository.clearStaging(jobId);
	}

	async #abortRowWrite(row: QueueRow): Promise<void> {
		const write = [...this.#writes.values()].find((candidate) => candidate.jobId === row.job_id)
			?? this.#sealedWrites.get(row.job_id);
		if (!write) return;
		this.#writes.delete(write.writeId);
		this.#sealedWrites.delete(row.job_id);
		await write.abort();
	}

	async #abandonWrite(write: SoundscaperDeliveryWrite): Promise<void> {
		this.#writes.delete(write.writeId);
		await write.abandon();
	}

	async #removePartial(row: QueueRow, root?: SoundscaperDeliveryRoot): Promise<boolean> {
		const write = this.#sealedWrites.get(row.job_id);
		try {
			await this.#publication.removeRecordedPartial(row, root, write);
			if (write?.settled) this.#sealedWrites.delete(row.job_id);
			return true;
		}
		catch {
			this.#state(row.job_id, 'failed', 'staging-ownership-lost');
			return false;
		}
	}

	#summary(row: QueueRow, current: SoundscaperDeliveryProjectIdentityV1 | null): SoundscaperDeliverySummary {
		return soundscaperDeliverySummary(row, current, this.#repository.attemptReports(row.job_id));
	}

	#description(row: QueueRow): SoundscaperDeliveryDescriptionV1 {
		return soundscaperDeliveryDescription(row);
	}

	async #assertCurrent(
		description: SoundscaperDeliveryDescriptionV1,
		authority: SoundscaperDeliveryCurrentAuthorityV1,
	): Promise<void> {
		assertSoundscaperDeliveryCurrentV1(description, authority);
		const persisted = await this.#readProjectIdentity(description.projectIdentity.projectId);
		this.#assertWriter();
		if (!persisted || !sameProject(persisted, description.projectIdentity)) {
			throw new SoundscaperDeliveryContractError(
				'stale-project', 'The delivery project changed after its exact plan was authorized.',
			);
		}
	}

	#row(jobId: unknown): QueueRow {
		return this.#repository.row(jobId);
	}

	#rows(where: string, ...parameters: string[]): QueueRow[] {
		return this.#repository.rows(where, ...parameters);
	}

	#claim(claimId: unknown): QueueRow {
		const row = this.#rows("claim_id = ? AND state = 'running'", id(claimId, 'claim'))[0];
		if (!row) throw new Error('The Soundscaper delivery claim is stale or unknown.');
		this.#assertWriter();
		return row;
	}

	#write(writeId: unknown): SoundscaperDeliveryWrite {
		const write = this.#writes.get(id(writeId, 'write'));
		if (!write) throw new Error('The Soundscaper delivery write is stale or unknown.');
		return write;
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error('The Soundscaper delivery service is closed.');
	}

	#assertWriter(): void {
		this.#assertOpen();
		if (this.#fenced) throw new Error('The Soundscaper delivery writer is fenced.');
		assertSoundscaperDeliveryWriterLease(this.#database, this.#lease, this.#now());
	}

	#fileFence(operation: string): void {
		this.#beforeFileFence(operation);
		this.#assertWriter();
	}

	#renew(): void {
		if (this.#closed) return;
		try { this.#lease = renewSoundscaperDeliveryWriterLease(this.#database, this.#lease, this.#now()); }
		catch {
			this.#fenced = true;
			if (this.#renewTimer) clearInterval(this.#renewTimer);
			this.#renewTimer = null;
		}
	}
}

function randomId(): string { return randomBytes(24).toString('hex'); }
