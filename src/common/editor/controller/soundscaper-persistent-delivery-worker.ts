/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DeliveryReport } from '../delivery-report.ts';
import {
	fingerprintSoundscaperDeliveryPlanV1,
	type SoundscaperDeliveryProjectIdentityV1,
} from '../soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
	validateSoundscaperPersistentDeliveryBatchMemberV1,
	validateSoundscaperPersistentAudioDeliveryPlanV1,
} from '../soundscaper-persistent-delivery-plan-v1.ts';
import { createSoundscaperPersistentDeliverySaveTarget } from '../soundscaper-persistent-delivery-save-target.ts';
import type {
	SoundscaperPersistentDeliveryClaimCapability,
	SoundscaperPersistentDeliveryPrivateTransport,
} from './soundscaper-persistent-delivery-private-transport.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface PersistentDeliveryWorkerBridge {
	list(value: Readonly<{ limit: number; cursor?: string }>): PromiseLike<Readonly<{
		entries: readonly PersistentDeliveryWorkerEntry[];
		paused: boolean;
		nextCursor: string | null;
	}>>;
}

interface PersistentAudioExportExecutor {
	persistentAudioDeliveryAvailable(): Awaitable<boolean>;
	whenPersistentAudioDeliveryAvailable(): Awaitable<void>;
	derivePersistentAudioDeliveryPlan(settings: Readonly<Record<string, unknown>>): PromiseLike<Readonly<{
		settings: Readonly<Record<string, unknown>>;
		exportPlan: Readonly<Record<string, unknown>>;
	}>>;
	executePersistentAudioDeliveryPlan(value: Readonly<{
		settings: Readonly<Record<string, unknown>>;
		exportPlan: Readonly<Record<string, unknown>>;
		destination: unknown;
		onProgress?: (progress: number) => void;
	}>): PromiseLike<unknown>;
}

interface PersistentDeliveryWorkerEntry {
	readonly jobId: string;
	readonly state: string;
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	readonly planFingerprint: string;
	readonly batchId: string | null;
	readonly batchMember: Readonly<Record<string, unknown>> | null;
}

export interface SoundscaperPersistentDeliveryWorkerRuntime {
	readonly bridge: PersistentDeliveryWorkerBridge;
	readonly workerTransport: SoundscaperPersistentDeliveryPrivateTransport;
	readonly exportService: PersistentAudioExportExecutor;
	readonly currentProjectIdentity: () => Awaitable<SoundscaperDeliveryProjectIdentityV1 | null>;
	readonly deliveryReport: () => DeliveryReport | null;
	readonly cancelExport?: () => Awaitable<unknown>;
	readonly onChange?: () => void;
}

/**
 * Runs one main-owned claim at a time through the ordinary audio export path.
 * `wake` is called by queue/project events; browser builds never construct it.
 */
export function createSoundscaperPersistentDeliveryWorker(
	runtime: SoundscaperPersistentDeliveryWorkerRuntime,
) {
	if (!runtime?.bridge || typeof runtime.workerTransport?.claimNext !== 'function'
		|| typeof runtime.exportService?.persistentAudioDeliveryAvailable !== 'function'
		|| typeof runtime.exportService.whenPersistentAudioDeliveryAvailable !== 'function'
		|| typeof runtime.exportService?.derivePersistentAudioDeliveryPlan !== 'function'
		|| typeof runtime.exportService.executePersistentAudioDeliveryPlan !== 'function'
		|| typeof runtime.currentProjectIdentity !== 'function' || typeof runtime.deliveryReport !== 'function') {
		throw new TypeError('A persistent delivery worker requires bridge, authority, report, and ordinary export seams.');
	}
	let activeClaimId: string | null = null;
	let activeJobId: string | null = null;
	let activeCapability: SoundscaperPersistentDeliveryClaimCapability | null = null;
	let disposed = false;
	let generation = 0;
	let pumping: Promise<void> | null = null;

	const wake = (): Promise<void> => {
		if (disposed) return Promise.resolve();
		pumping ??= pump(generation).finally(() => { pumping = null; });
		return pumping;
	};

	async function pump(startGeneration: number): Promise<void> {
		while (!disposed && startGeneration === generation) {
			if (!await runtime.exportService.persistentAudioDeliveryAvailable()) {
				await runtime.exportService.whenPersistentAudioDeliveryAvailable();
			}
			if (disposed || startGeneration !== generation) return;
			const projectIdentity = await runtime.currentProjectIdentity();
			if (!projectIdentity || disposed || startGeneration !== generation) return;
			const prepared = await claimNextExact(projectIdentity, startGeneration);
			if (!prepared) return;
			const { claim, plan } = prepared;
			if (disposed || startGeneration !== generation) {
				await release(claim);
				return;
			}
			activeClaimId = claim.claimId;
			activeJobId = claim.jobId;
			activeCapability = claim;
			try {
				await claim.progress(0);
				let progressWrites = Promise.resolve();
				let progressFailure: unknown;
				let progressFailed = false;
				let acceptingProgress = true;
				const onProgress = (progress: number) => {
					if (!acceptingProgress) return;
					progressWrites = progressWrites.then(async () => {
						if (progressFailed) return;
						try { await claim.progress(progress); }
						catch (error) { progressFailed = true; progressFailure = error; }
					});
				};
				let outcome: unknown;
				let executionFailure: unknown;
				let executionFailed = false;
				try {
					outcome = await runtime.exportService.executePersistentAudioDeliveryPlan({
						settings: plan.settings,
						exportPlan: plan.exportPlan,
						destination: createSoundscaperPersistentDeliverySaveTarget(claim.claimId, claim),
						onProgress,
					});
				} catch (error) { executionFailed = true; executionFailure = error; }
				acceptingProgress = false;
				await progressWrites;
				if (executionFailed) throw executionFailure;
				if (progressFailed) throw progressFailure;
				if (disposed || startGeneration !== generation) {
					await release(claim);
					return;
				}
				if (!publishedOutcome(outcome)) {
					await release(claim);
					return;
				}
				const report = runtime.deliveryReport();
				if (!report) throw new Error('The ordinary export produced no sealed delivery report.');
				await claim.progress(1);
				await claim.complete(report);
			} catch (error) {
				if (disposed || startGeneration !== generation || isAbort(error)) {
					await release(claim);
					return;
				}
					try { await claim.fail(failureCode(error), runtime.deliveryReport()); }
					catch (failure) { await release(claim); throw failure; }
			} finally {
				if (activeClaimId === claim.claimId) activeClaimId = null;
				if (activeJobId === claim.jobId) activeJobId = null;
				if (activeCapability === claim) activeCapability = null;
				runtime.onChange?.();
			}
		}
	}

	async function claimNextExact(
		projectIdentity: SoundscaperDeliveryProjectIdentityV1,
		startGeneration: number,
	): Promise<Readonly<{
		claim: SoundscaperPersistentDeliveryClaimCapability;
		plan: ReturnType<typeof validateSoundscaperPersistentAudioDeliveryPlanV1>;
	}> | null> {
		const entries = await queuedEntries(projectIdentity);
		for (const entry of entries) {
			if (disposed || startGeneration !== generation) return null;
			if (entry.batchId === null && entry.batchMember === null) {
				const queuedClaim = await runtime.workerTransport.claimNext({
					jobId: entry.jobId,
					currentAuthority: Object.freeze({
						projectIdentity, planFingerprint: entry.planFingerprint,
					}),
					});
					if (!queuedClaim) continue;
					try {
						if (disposed || startGeneration !== generation) {
							await release(queuedClaim);
							return null;
						}
						if (queuedClaim.jobId !== entry.jobId) {
							throw new Error('Main returned a persistent delivery claim for another job.');
						}
						const claimedPlan = validateSoundscaperPersistentAudioDeliveryPlanV1(queuedClaim.plan);
						if (claimedPlan.batch !== null) {
							throw new Error('Main returned batch authority for a non-batch persistent delivery.');
						}
						let derived: Awaited<ReturnType<PersistentAudioExportExecutor['derivePersistentAudioDeliveryPlan']>>;
						try { derived = await runtime.exportService.derivePersistentAudioDeliveryPlan(claimedPlan.settings); }
						catch { await release(queuedClaim); continue; }
						if (disposed || startGeneration !== generation) {
							await release(queuedClaim);
							return null;
						}
						const currentPlan = createSoundscaperPersistentAudioDeliveryPlanV1({
							settings: derived.settings, exportPlan: derived.exportPlan, batch: null,
						});
						const currentFingerprint = fingerprintSoundscaperDeliveryPlanV1(currentPlan);
						const claimedFingerprint = fingerprintSoundscaperDeliveryPlanV1(claimedPlan);
						if (currentFingerprint.sha256 !== entry.planFingerprint) {
							await release(queuedClaim);
							if (disposed || startGeneration !== generation) return null;
							const unexpected = await runtime.workerTransport.claimNext({
								jobId: entry.jobId,
								currentAuthority: Object.freeze({
									projectIdentity, planFingerprint: currentFingerprint.sha256,
								}),
							});
							if (unexpected) {
								await release(unexpected);
								throw new Error('Main accepted changed authority for a queued persistent delivery.');
							}
							continue;
						}
						if (claimedFingerprint.sha256 !== currentFingerprint.sha256
							|| claimedFingerprint.canonical !== currentFingerprint.canonical) {
							throw new Error('Main returned a persistent delivery plan other than the re-derived plan.');
						}
						return Object.freeze({ claim: queuedClaim, plan: claimedPlan });
					} catch (error) { await release(queuedClaim); throw error; }
				}
				const member = admittedMember(entry);
				let derived: Awaited<ReturnType<PersistentAudioExportExecutor['derivePersistentAudioDeliveryPlan']>>;
				try { derived = await runtime.exportService.derivePersistentAudioDeliveryPlan(member.settings); }
				catch { continue; }
				if (disposed || startGeneration !== generation) return null;
			const currentPlan = createSoundscaperPersistentAudioDeliveryPlanV1({
				settings: derived.settings,
				exportPlan: derived.exportPlan,
				batch: {
					batchId: entry.batchId!, memberId: member.memberId, presetId: member.presetId,
					target: member.target, mode: member.mode,
				},
			});
			const fingerprint = fingerprintSoundscaperDeliveryPlanV1(currentPlan);
			const claim = await runtime.workerTransport.claimNext({
				jobId: entry.jobId,
				currentAuthority: Object.freeze({
					projectIdentity,
					planFingerprint: fingerprint.sha256,
				}),
			});
			// A changed plan is deliberately offered to main: its exact-job claim
				// permanently records stale-plan, then returns no authority to render.
				if (!claim) continue;
				try {
					if (disposed || startGeneration !== generation) {
						await release(claim);
						return null;
					}
					if (claim.jobId !== entry.jobId) {
						throw new Error('Main returned a persistent delivery claim for another job.');
					}
					const claimedPlan = validateSoundscaperPersistentAudioDeliveryPlanV1(claim.plan);
					const claimedFingerprint = fingerprintSoundscaperDeliveryPlanV1(claimedPlan);
					if (claimedFingerprint.sha256 !== fingerprint.sha256
						|| claimedFingerprint.canonical !== fingerprint.canonical) {
						throw new Error('Main returned a persistent delivery plan other than the re-derived plan.');
					}
					return Object.freeze({ claim, plan: claimedPlan });
				} catch (error) { await release(claim); throw error; }
		}
		return null;
	}

	async function queuedEntries(
		projectIdentity: SoundscaperDeliveryProjectIdentityV1,
	): Promise<readonly PersistentDeliveryWorkerEntry[]> {
		const entries: PersistentDeliveryWorkerEntry[] = [];
		let cursor: string | undefined;
		do {
			const page = await runtime.bridge.list({ limit: 250, ...(cursor ? { cursor } : {}) });
			if (page.paused) return Object.freeze([]);
			for (const entry of page.entries) {
				if ((entry.state === 'queued' || entry.state === 'waiting-for-project')
					&& entry.projectIdentity.projectId === projectIdentity.projectId
					&& ((entry.batchId === null && entry.batchMember === null)
						|| (Boolean(entry.batchId) && entry.batchMember !== null))) {
					entries.push(entry);
				}
			}
			cursor = page.nextCursor ?? undefined;
		} while (cursor !== undefined);
		return Object.freeze(entries);
	}

	async function release(claim: SoundscaperPersistentDeliveryClaimCapability): Promise<void> {
		await Promise.resolve(claim.release()).catch(() => undefined);
	}

	async function invalidate(): Promise<void> {
		generation += 1;
		if (!activeClaimId) return;
		let cancellationError: unknown;
		try { await runtime.cancelExport?.(); } catch (error) { cancellationError = error; }
		if (cancellationError) {
			const claim = activeCapability;
			activeClaimId = null;
			activeJobId = null;
			activeCapability = null;
			if (claim) await release(claim);
			return;
		}
		if (pumping) await pumping;
	}

	return Object.freeze({
		wake,
		projectChanged: invalidate,
		async cancelJob(jobId: string): Promise<boolean> {
			if (activeJobId !== jobId) return false;
			await invalidate();
			return true;
		},
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			await invalidate();
		},
	});
}

function publishedOutcome(value: unknown): boolean {
	if (!value || typeof value !== 'object') throw new Error('The ordinary export published no persistent output.');
	const result = value as Readonly<{ busy?: unknown; cancelled?: unknown; fileName?: unknown; size?: unknown }>;
	if (result.busy === true) return false;
	if (result.cancelled) throw new DOMException('Persistent delivery was cancelled.', 'AbortError');
	if (typeof result.fileName !== 'string' || !Number.isSafeInteger(result.size) || Number(result.size) < 0) {
		throw new Error('The ordinary export published no persistent output.');
	}
	return true;
}

function admittedMember(entry: PersistentDeliveryWorkerEntry) {
	return validateSoundscaperPersistentDeliveryBatchMemberV1(entry.batchMember);
}

function isAbort(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (error as Readonly<{ name?: unknown }>).name === 'AbortError');
}

function failureCode(error: unknown): string {
	const name = error && typeof error === 'object' && typeof (error as Readonly<{ name?: unknown }>).name === 'string'
		? (error as Readonly<{ name: string }>).name : 'render';
	return `ordinary-export-${name.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').slice(0, 96)}`;
}
