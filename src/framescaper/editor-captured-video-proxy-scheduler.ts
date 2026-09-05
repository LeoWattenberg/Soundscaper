/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCapturedVideoProxyRequest,
} from '../common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import type {
	FramescaperCaptureProxySaveLease,
} from '../common/editor/controller/framescaper-capture-proxy-quiescence.ts';
import { createVideoProxyOriginalObserver } from '../common/editor/controller/video-proxy-original-observer.ts';
import { VideoProxyClaimRepository } from '../common/editor/storage/video-proxy-claim-repository.ts';
import { VideoProxyClaimStagingRepository } from '../common/editor/storage/video-proxy-claim-staging-repository.ts';
import {
	bindVideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import {
	assertVideoProxyRelationshipAdoptionCurrent,
	captureVideoProxyRelationshipAdoptionLease,
	consumePreparedVideoProxyRelationship,
	createVideoProxyRelationshipAuthority,
	proveVideoProxyRelationship,
	releaseVideoProxyRelationshipAdoptionLease,
	type VideoProxyRelationshipAdoptionLease,
} from '../common/editor/video-proxy-relationship.ts';
import {
	CapturedVideoProxyBodyStagingError,
	createCapturedVideoProxyAttachment,
	releaseReusedCapturedVideoProxyClaims,
	stageCapturedVideoProxyBodies,
	type StagedCapturedVideoProxyBody,
} from './editor-captured-video-proxy-bodies.ts';
import {
	cleanupCapturedVideoProxyClaims,
	type CapturedVideoProxyCleanupOperation,
} from './editor-captured-video-proxy-claim-cleanup.ts';
import {
	CapturedVideoProxyDesktopCommittedReconciliationError,
	CapturedVideoProxyDesktopIndeterminateReconciliationError,
	publishCapturedVideoProxyDesktopMainFirst,
} from './editor-captured-video-proxy-desktop-publication.ts';
import {
	assertCapturedVideoProxyProjectCurrent,
	captureCapturedVideoProxyFinalControllerTicket,
	captureCapturedVideoProxyLandedControllerTicket,
} from './editor-captured-video-proxy-controller-fence.ts';
import {
	reconcileLandedCapturedVideoProxyProject,
	type LandedCapturedVideoProxy,
} from './editor-captured-video-proxy-landed-reconciliation.ts';
import { settleIndeterminateCapturedVideoProxyPredecessor } from './editor-captured-video-proxy-indeterminate-reconciliation.ts';
import {
	CapturedVideoProxyAutomaticReconciliation,
	CapturedVideoProxyBoundedState,
} from './editor-captured-video-proxy-scheduler-state.ts';
import {
	capturedVideoProxyAbortError as abortError,
	assertMatchingCapturedVideoProxyAttachment as assertMatchingExistingAttachment,
	capturedVideoProxySource as videoSource,
	throwIfCapturedVideoProxyAborted as throwIfAborted,
} from './editor-captured-video-proxy-scheduler-guards.ts';
import {
	type CapturedVideoProxySchedulerDependencies,
} from './editor-captured-video-proxy-scheduler-composition.ts';
import {
	FramescaperCapturedVideoProxyPreservationRepository,
	type FramescaperCapturedVideoProxyProject,
} from './editor-captured-video-proxy-preservation.ts';
import {
	cloneCapturedVideoProxyProject as cloneProject,
	capturedVideoProxyProjectFingerprint as projectFingerprint,
} from './editor-captured-video-proxy-project.ts';
import { nextCapturedVideoProxyAttachmentProject } from './editor-captured-video-proxy-transition.ts';
import {
	capturedVideoProxyLineageKey as lineageKey,
	capturedVideoProxyOperationIdentifier as operationIdentifier,
	capturedVideoProxyOperationKey as operationKey,
	normalizeCapturedVideoProxyRequest as normalizeRequest,
	sameCapturedVideoProxyAttachment as sameAttachment,
} from './editor-captured-video-proxy-request.ts';
import type { CapturedVideoProxyControllerTicket } from './editor-captured-video-proxy-session-reconciliation.ts';
import {
	acquireFramescaperVideoProxyAttachmentBudgetSequence,
	assertFramescaperVideoProxyAttachmentCapacitySequence,
} from './editor-video-proxy-attachment-capacity-sequence.ts';

export type {
	FramescaperCapturedVideoProxyRuntimeComposition,
} from './editor-captured-video-proxy-scheduler-composition.ts';

export interface FramescaperCapturedVideoProxyScheduler {
	(request: FramescaperCapturedVideoProxyRequest): Promise<void>;
	dispose(): Promise<void>;
}

export function createFramescaperCapturedVideoProxyScheduler(dependencies: CapturedVideoProxySchedulerDependencies): FramescaperCapturedVideoProxyScheduler {
	const claims = new VideoProxyClaimRepository(dependencies.port);
	const staging = new VideoProxyClaimStagingRepository(dependencies.port, dependencies.opfs);
	const preservation = new FramescaperCapturedVideoProxyPreservationRepository(
		dependencies.schemaVersion,
		dependencies.profile,
		{ port: dependencies.port, claims },
	);
	const lineage = new CapturedVideoProxyBoundedState<Readonly<{
		readonly expectedRevision: number;
		readonly fingerprint: string;
	}>>(dependencies.policy.maximumLineageEntries, true);
	const landed = new CapturedVideoProxyBoundedState<LandedCapturedVideoProxy>(
		dependencies.policy.maximumLandedEntries,
	);
	const lifetime = new AbortController();
	let disposed = false;
	let disposePromise: Promise<void> | null = null;
	let tail = Promise.resolve();
	const automatic = new CapturedVideoProxyAutomaticReconciliation<FramescaperCapturedVideoProxyRequest>({
		maximumAttempts: dependencies.policy.maximumReconciliationAttempts,
		isPending: (key) => landed.get(key) !== null,
		execute: (request) => enqueue(request),
		onExhausted: () => undefined,
	});
	return Object.freeze(Object.assign(schedule, { dispose }));

	function schedule(requestValue: FramescaperCapturedVideoProxyRequest): Promise<void> {
		const request = normalizeRequest(requestValue);
		if (disposed) return Promise.reject(abortError('The captured proxy scheduler is disposed.'));
		const key = operationKey(request);
		const result = enqueue(request);
		void result.then(
			() => { automatic.complete(key); },
			() => { automatic.afterFailure(key, request); },
		);
		return result;
	}

	function enqueue(request: FramescaperCapturedVideoProxyRequest): Promise<void> {
		const result = tail.then(() => {
			throwIfAborted(lifetime.signal);
			return run(request, lifetime.signal);
		});
		tail = result.then(() => undefined, () => undefined);
		return result;
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposed = true;
		automatic.dispose();
		lifetime.abort(abortError('The captured proxy scheduler was disposed.'));
		disposePromise = tail.then(() => {
			lineage.clear();
			landed.clear();
		});
		return disposePromise;
	}

	async function run(request: FramescaperCapturedVideoProxyRequest, signal: AbortSignal): Promise<void> {
		let releaseBudget: (() => void) | null = null;
		let adoption: VideoProxyRelationshipAdoptionLease | null = null;
		let staged: readonly StagedCapturedVideoProxyBody[] = [];
		let committed = false;
		let cleanupOperation: CapturedVideoProxyCleanupOperation | null = null;
		let controllerTicket: CapturedVideoProxyControllerTicket | null = null;
		let saveLease: FramescaperCaptureProxySaveLease | null = null;
		let primaryFailure: unknown = null;
		try {
			throwIfAborted(signal);
			const reconciliationKey = operationKey(request);
			const pending = landed.get(reconciliationKey);
			if (!pending) landed.assertCapacity(reconciliationKey);
			const base = await loadAdmittedBase(dependencies, lineage, request, signal, pending);
			const target = videoSource(base, request.sourceId);
			const replacementBase = request.expectedProxyAttachment
				? sameAttachment(target.proxyAttachment, request.expectedProxyAttachment)
				: target.proxyAttachment === null;
			if (pending?.outcome === 'indeterminate' && replacementBase) {
				committed = true;
				await settleIndeterminateCapturedVideoProxyPredecessor({
					pending, current: base, projectId: request.projectId,
					session: dependencies.session, claimCleanup: dependencies.claimCleanup,
					quiesceProjectSaves: dependencies.quiesceProjectSaves,
					loadCurrent: (currentSignal) => dependencies.loadAuthoritativeProject(request.projectId, currentSignal),
					cloneProject: (project) => cloneProject(dependencies, project),
					fingerprint: (project) => projectFingerprint(dependencies, project), signal,
				});
				landed.delete(reconciliationKey);
				return;
			}
			if (target.proxyAttachment !== null && !replacementBase) {
				if (request.expectedProxyAttachment && !pending) throw abortError(
					'The captured proxy replacement attachment changed before generation.',
				);
				assertMatchingExistingAttachment(target, request.expectedContentSha256);
				const reconciliation = pending ?? Object.freeze({
					outcome: 'committed' as const, base, target: base, cleanupOperation: null,
				});
				if (projectFingerprint(dependencies, reconciliation.target)
					!== projectFingerprint(dependencies, base)) {
					throw abortError('The landed captured proxy target changed before reconciliation.');
				}
				committed = true;
				if (dependencies.quiesceProjectSaves) {
					saveLease = await dependencies.quiesceProjectSaves(request.projectId, signal);
					throwIfAborted(signal);
				}
				await assertCapturedVideoProxyProjectCurrent({
					expected: reconciliation.target,
					loadCurrent: (currentSignal) => dependencies.loadAuthoritativeProject(request.projectId, currentSignal),
					cloneProject: (project) => cloneProject(dependencies, project),
					fingerprint: (project) => projectFingerprint(dependencies, project),
					changedMessage: 'The landed captured proxy target changed while queued saves drained.', signal,
				});
				controllerTicket = captureCapturedVideoProxyLandedControllerTicket(
					dependencies.session, reconciliation.base, reconciliation.target,
					(project) => projectFingerprint(dependencies, project),
				);
				await reconcileLandedProject(
					dependencies, reconciliation, request.sourceId, signal, controllerTicket,
				);
				lineage.set(lineageKey(request), {
					expectedRevision: request.expectedProjectRevision,
					fingerprint: projectFingerprint(dependencies, base),
				});
				landed.delete(reconciliationKey);
				return;
			}
			if (!dependencies.candidateObserver) throw new Error('This runtime cannot generate captured video proxies.');
			releaseBudget = await acquireFramescaperVideoProxyAttachmentBudgetSequence(dependencies.store, signal);
			let currentProject = base;
			let currentRelationshipProject = dependencies.projectForRelationship(base);
			const originalObserver = createVideoProxyOriginalObserver({
				store: dependencies.store,
				getProject: () => currentRelationshipProject,
			});
			const relationshipAuthority = createVideoProxyRelationshipAuthority({
				getProject: () => currentRelationshipProject,
				captureTask: () => currentProject,
				assertTaskCurrent: (token) => {
					if (token !== currentProject) throw abortError('Captured proxy project generation changed.');
				},
				resolveOriginalTiming: (source) => bindVideoSourceTimingView(
					resolveVideoSourceTimingViews(currentProject),
					source,
				),
				observeOriginal: originalObserver,
				candidateObserver: dependencies.candidateObserver,
			});
			const preparation = await proveVideoProxyRelationship(relationshipAuthority, {
				sourceId: request.sourceId, signal,
			});
			const latest = cloneProject(dependencies, await dependencies.loadAuthoritativeProject(
				request.projectId, signal,
			));
			if (projectFingerprint(dependencies, latest) !== projectFingerprint(dependencies, base)) {
				throw abortError('The captured proxy project changed during generation.');
			}
			currentProject = latest;
			currentRelationshipProject = dependencies.projectForRelationship(latest);
			const material = consumePreparedVideoProxyRelationship(preparation);
			adoption = await captureVideoProxyRelationshipAdoptionLease(
				relationshipAuthority,
				material.relationship,
				{ sourceId: request.sourceId, signal },
			);
			assertVideoProxyRelationshipAdoptionCurrent(adoption);
			const attachment = await createCapturedVideoProxyAttachment(
				material,
				videoSource(latest, request.sourceId),
				signal,
			);
			const next = nextCapturedVideoProxyAttachmentProject(
				dependencies, latest, request.sourceId, attachment, request.expectedProxyAttachment,
			);
			await assertFramescaperVideoProxyAttachmentCapacitySequence(
				dependencies.store,
				latest as never,
				next as never,
				material,
				signal,
			);
			const baseFingerprint = projectFingerprint(dependencies, latest);
			const operationId = operationIdentifier(request);
			cleanupOperation = Object.freeze({
				operationId, projectId: request.projectId, sourceId: request.sourceId, baseFingerprint,
			});
			try {
				staged = await stageCapturedVideoProxyBodies(
					dependencies.store,
					staging,
					material,
					attachment,
					{ operationId, projectId: request.projectId, sourceId: request.sourceId, baseFingerprint },
					signal,
				);
			} catch (error) {
				if (error instanceof CapturedVideoProxyBodyStagingError) staged = error.staged;
				throw error;
			}
			const durable = cloneProject(dependencies, await dependencies.loadAuthoritativeProject(
				request.projectId, signal,
			));
			if (projectFingerprint(dependencies, durable) !== baseFingerprint) {
				throw abortError('The captured proxy base changed before compare-and-swap.');
			}
			assertVideoProxyRelationshipAdoptionCurrent(adoption);
			const proxy = staged.find((body) => body.bodyKind === 'proxy')!.claim;
			const timing = staged.find((body) => body.bodyKind === 'timing')!.claim;
			throwIfAborted(signal);
			const plan = await claims.preparePreservationPlan({
				operationId,
				projectId: request.projectId,
				sourceId: request.sourceId,
				baseFingerprint,
				proxyClaimKey: proxy.key,
				timingClaimKey: timing.key,
			});
			throwIfAborted(signal);
			if (dependencies.quiesceProjectSaves) {
				saveLease = await dependencies.quiesceProjectSaves(request.projectId, signal);
				throwIfAborted(signal);
			}
			await assertCapturedVideoProxyProjectCurrent({
				expected: latest,
				loadCurrent: (currentSignal) => dependencies.loadAuthoritativeProject(request.projectId, currentSignal),
				cloneProject: (project) => cloneProject(dependencies, project),
				fingerprint: (project) => projectFingerprint(dependencies, project),
				changedMessage: 'The captured proxy base changed while queued saves drained.', signal,
			});
			let published: FramescaperCapturedVideoProxyProject;
			if (dependencies.publishDesktopProject) {
				let ticketCaptured = false;
				try {
					published = await publishCapturedVideoProxyDesktopMainFirst({
						base: latest,
						target: next,
						publishProject: dependencies.publishDesktopProject,
						loadAuthoritativeProject: (reconciliationSignal) => dependencies.loadAuthoritativeProject(
							request.projectId, reconciliationSignal,
						),
						cloneProject: (project) => cloneProject(dependencies, project),
						fingerprint: (project) => projectFingerprint(dependencies, project),
						beforeFinish: async () => {
							if (ticketCaptured) throw new Error('Desktop captured proxy finalization ran twice.');
							ticketCaptured = true;
							controllerTicket = await captureCapturedVideoProxyFinalControllerTicket({
								session: dependencies.session, expected: latest,
								loadCurrent: (currentSignal) => dependencies.store.loadProject(
									request.projectId, { signal: currentSignal },
								),
								cloneProject: (project) => cloneProject(dependencies, project),
								fingerprint: (project) => projectFingerprint(dependencies, project),
								changedMessage: 'The desktop captured proxy shadow changed before final CAS.', signal,
								assertAdoptionCurrent: () => assertVideoProxyRelationshipAdoptionCurrent(adoption!),
							});
							},
							signal,
					});
					} catch (error) {
						if (error instanceof CapturedVideoProxyDesktopCommittedReconciliationError) {
							committed = true;
							landed.set(reconciliationKey, Object.freeze({
								outcome: 'committed' as const, base: latest,
								target: error.target,
								cleanupOperation,
							}));
							lineage.set(lineageKey(request), {
								expectedRevision: request.expectedProjectRevision,
								fingerprint: projectFingerprint(dependencies, error.target),
							});
						}
						if (error instanceof CapturedVideoProxyDesktopIndeterminateReconciliationError) {
							committed = true;
							landed.set(reconciliationKey, Object.freeze({
								outcome: 'indeterminate' as const,
								base: error.base,
								target: error.target,
								cleanupOperation,
							}));
						}
						throw error;
					}
			} else {
				controllerTicket = await captureCapturedVideoProxyFinalControllerTicket({
					session: dependencies.session, expected: latest,
					loadCurrent: (currentSignal) => dependencies.loadAuthoritativeProject(
						request.projectId, currentSignal,
					),
					cloneProject: (project) => cloneProject(dependencies, project),
					fingerprint: (project) => projectFingerprint(dependencies, project),
					changedMessage: 'The captured proxy base changed inside its final controller fence.', signal,
					assertAdoptionCurrent: () => assertVideoProxyRelationshipAdoptionCurrent(adoption!),
				});
				const localPublished = await preservation.publishIfCurrent({
					expected: latest,
					project: next,
					sourceId: request.sourceId,
					plan,
				});
				if (!localPublished) throw abortError('The captured proxy compare-and-swap base became stale.');
				published = localPublished;
			}
			committed = true;
			const reconciliation = Object.freeze({
				outcome: 'committed' as const, base: latest,
				target: published,
				cleanupOperation: dependencies.publishDesktopProject ? cleanupOperation : null,
			});
			landed.set(reconciliationKey, reconciliation);
			lineage.set(lineageKey(request), {
				expectedRevision: request.expectedProjectRevision,
				fingerprint: projectFingerprint(dependencies, published),
			});
			await reconcileLandedProject(
				dependencies, reconciliation, request.sourceId, signal, controllerTicket,
			);
			await releaseVideoProxyRelationshipAdoptionLease(adoption);
			adoption = null;
			landed.delete(reconciliationKey);
		} catch (error) {
			const cleanupErrors: unknown[] = [];
			if (adoption) {
				try { await releaseVideoProxyRelationshipAdoptionLease(adoption); adoption = null; }
				catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
			if (!committed) {
				const reusedErrors = await releaseReusedCapturedVideoProxyClaims(staging, staged);
				cleanupErrors.push(...reusedErrors);
				if (reusedErrors.length === 0 || staged.every(({ created }) => created)) {
					cleanupErrors.push(...await cleanupCapturedVideoProxyClaims(
						dependencies.claimCleanup, cleanupOperation, dependencies.session.getSnapshot(),
					));
				}
			}
			if (cleanupErrors.length) {
				primaryFailure = new AggregateError(
					[error, ...cleanupErrors], 'Captured proxy work and cleanup failed.', { cause: error },
				);
				throw primaryFailure;
			}
			primaryFailure = error;
			throw error;
		} finally {
			const finalizerFailures: unknown[] = [];
			try { controllerTicket?.reservation.release(); }
			catch (error) { finalizerFailures.push(error); }
			try { saveLease?.release(); }
			catch (error) { finalizerFailures.push(error); }
			try { releaseBudget?.(); }
			catch (error) { finalizerFailures.push(error); }
			if (primaryFailure && finalizerFailures.length) {
				throw new AggregateError(
					[primaryFailure, ...finalizerFailures],
					'Captured proxy work and finalizers failed.',
					{ cause: primaryFailure },
				);
			}
			if (finalizerFailures.length === 1) throw finalizerFailures[0];
			if (finalizerFailures.length > 1) {
				throw new AggregateError(finalizerFailures, 'Captured proxy finalizers failed.');
			}
		}
	}
}

async function reconcileLandedProject(
	dependencies: CapturedVideoProxySchedulerDependencies,
	reconciliation: LandedCapturedVideoProxy,
	sourceId: string,
	signal: AbortSignal,
	controllerTicket?: CapturedVideoProxyControllerTicket | null,
): Promise<void> {
	await reconcileLandedCapturedVideoProxyProject({
		session: dependencies.session,
		claimCleanup: dependencies.claimCleanup,
		synchronizeActiveProject: dependencies.synchronizeActiveProject,
		sameProject: (left, right) => (
			projectFingerprint(dependencies, left) === projectFingerprint(dependencies, right)
		),
	}, reconciliation, sourceId, signal, controllerTicket);
}

async function loadAdmittedBase(
	dependencies: CapturedVideoProxySchedulerDependencies,
	lineage: CapturedVideoProxyBoundedState<Readonly<{
		readonly expectedRevision: number;
		readonly fingerprint: string;
	}>>,
	request: FramescaperCapturedVideoProxyRequest,
	signal: AbortSignal,
	pending?: LandedCapturedVideoProxy | null,
): Promise<FramescaperCapturedVideoProxyProject> {
	const base = cloneProject(dependencies, await dependencies.loadAuthoritativeProject(request.projectId, signal));
	throwIfAborted(signal);
	const source = videoSource(base, request.sourceId);
	if (source.contentSha256 !== request.expectedContentSha256) {
		throw abortError('The captured video source digest changed before proxy generation.');
	}
	if (request.expectedProxyAttachment) {
		const exactPendingTarget = Boolean(pending
			&& projectFingerprint(dependencies, pending.target) === projectFingerprint(dependencies, base));
		if (!sameAttachment(source.proxyAttachment, request.expectedProxyAttachment) && !exactPendingTarget) {
			throw abortError('The captured proxy replacement attachment changed before generation.');
		}
		if (exactPendingTarget) return base;
	} else if (source.proxyAttachment !== null) {
		assertMatchingExistingAttachment(source, request.expectedContentSha256);
		return base;
	}
	const owned = lineage.get(lineageKey(request));
	const admitted = Number(base.revision) === request.expectedProjectRevision
		|| Boolean(owned
			&& owned.expectedRevision === request.expectedProjectRevision
			&& owned.fingerprint === projectFingerprint(dependencies, base))
		|| Boolean(pending?.outcome === 'indeterminate'
			&& projectFingerprint(dependencies, pending.base) === projectFingerprint(dependencies, base));
	if (!admitted) throw abortError('The captured proxy origin revision is no longer current.');
	return base;
}
