/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCycleRecoveryEnvelope } from '../take-cycle-recovery-envelope.ts';
import type { TakeMediaPublicationBinding, TakeMediaRecoveryDecision } from '../take-media-recovery-journal.ts';
import type { ProjectRepositoryPort } from '../storage/project-repository.ts';
import type { RawPcmSpoolRepository } from '../storage/raw-pcm-spool-repository.ts';
import type { SourceRepository } from '../storage/source-repository.ts';
import type { TakeCycleRecoveryEnvelopeRepository } from '../storage/take-cycle-recovery-envelope-repository.ts';
import { createTakeCycleCaptureOrchestrator, type TakeCyclePendingOpenRecovery } from './take-cycle-capture-orchestrator.ts';
import { createTakeCycleCaptureSourceSpool } from './take-cycle-capture-spool.ts';
import { createTakeCycleLiveCaptureSpool } from './take-cycle-live-capture-spool.ts';
import {
	createTakeCycleRecordingRepositoryComposition,
	type TakeCyclePublishedProject,
} from './take-cycle-recording-repository-composition.ts';
import {
	createTakeCycleRoutedCaptureService,
	type TakeCycleRoutedCaptureRuntime,
	type TakeCycleRoutedCaptureService,
} from './take-cycle-routed-capture-service.ts';
import type { EditorControllerLifetime, EditorProjectToken } from './lifecycle.ts';
import type { RecordingControllerLike, RecordingStartScope } from './recording-session-service.ts';

type StableIdPrefix = 'envelope' | 'lane' | 'take' | 'media' | 'journal' | 'comp-region';

export interface TakeCycleProductionCompositionDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'cancelTask'>;
	readonly projects: ProjectRepositoryPort;
	readonly sources: SourceRepository;
	readonly rawPcmSpools: RawPcmSpoolRepository;
	readonly recoveryRepository: TakeCycleRecoveryEnvelopeRepository;
	readonly routed: Omit<TakeCycleRoutedCaptureRuntime, 'orchestrator'>;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createId(prefix: StableIdPrefix): string;
	publishCurrentProject(publication: TakeCyclePublishedProject): PromiseLike<void> | void;
	activateCommittedSource(mediaId: string): PromiseLike<void> | void;
	synchronizeActivatedProject(): PromiseLike<void> | void;
	now?(): Date | string;
}

export interface TakeCycleProductionComposition {
	readonly routed: TakeCycleRoutedCaptureService;
	start(scope: RecordingStartScope): Promise<RecordingControllerLike>;
	inspectOpenRecovery(projectId: string): Promise<TakeCyclePendingOpenRecovery | null>;
	recoverOnOpen(
		pending: TakeCyclePendingOpenRecovery,
		decision: TakeMediaRecoveryDecision,
	): Promise<void>;
	cancel(reason?: unknown): void;
}

/** Compose canonical CAS/source repositories through durable routed cycle capture. */
export function createTakeCycleProductionComposition(
	dependencies: TakeCycleProductionCompositionDependencies,
): Readonly<TakeCycleProductionComposition> {
	let orchestrator: ReturnType<typeof createTakeCycleCaptureOrchestrator> | null = null;
	const recoveredBindings = new Map<string, readonly TakeMediaPublicationBinding[]>();
	const recording = createTakeCycleRecordingRepositoryComposition({
		lifetime: dependencies.lifetime,
		recoveryRepository: dependencies.recoveryRepository,
		projects: dependencies.projects,
		sources: dependencies.sources,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		resolveLaneTarget: ({ plan }) => requireOrchestrator().resolveLaneTarget(plan.laneId),
		describeSource: ({ publication }) => requireOrchestrator().describeSource(publication.mediaId),
		readPassChunks: ({ envelope, entryIndex, ownership }) => requireOrchestrator().readPassChunks(
			envelope.entries[entryIndex]!.journal.binding.mediaId,
			{ signal: ownership.signal },
		),
		createCompRegionId: () => dependencies.createId('comp-region'),
		publishCurrentProject: dependencies.publishCurrentProject,
		...(dependencies.now ? { now: dependencies.now } : {}),
	});
	const spool = createTakeCycleCaptureSourceSpool(
		dependencies.sources,
		createTakeCycleLiveCaptureSpool(dependencies.rawPcmSpools),
	);
	orchestrator = createTakeCycleCaptureOrchestrator({
		service: recording,
		spool,
		async loadRecoveryEnvelope(projectId) {
			const envelope = await dependencies.recoveryRepository.load(projectId);
			if (envelope) recoveredBindings.set(projectId, envelopeBindings(envelope));
			else recoveredBindings.delete(projectId);
			return envelope;
		},
		createId: (prefix) => dependencies.createId(prefix),
		activateCommittedSource: ({ mediaId }) => dependencies.activateCommittedSource(mediaId),
		listRecoveredMedia: (projectId) => recoveredBindings.get(projectId) ?? Object.freeze([]),
	});
	const routed = createTakeCycleRoutedCaptureService({
		...dependencies.routed,
		orchestrator,
		// Monitoring and input gain follow live app state that the spread above would freeze.
		get monitor() { return dependencies.routed.monitor; },
		get inputGain() { return dependencies.routed.inputGain; },
	});
	return Object.freeze({
		routed,
		start,
		inspectOpenRecovery: (projectId: string) => requireOrchestrator().inspectOpenRecovery({ projectId }),
		recoverOnOpen: async (
			pending: TakeCyclePendingOpenRecovery,
			decision: TakeMediaRecoveryDecision,
		) => {
			await requireOrchestrator().recoverOnOpen({ pending, decision });
			recoveredBindings.delete(pending.projectId);
		},
		cancel: (reason?: unknown) => requireOrchestrator().cancel(reason),
	});

	async function start(scope: RecordingStartScope): Promise<RecordingControllerLike> {
		await routed.start({ kind: 'take-cycle-routed-capture' }, scope);
		let state: 'recording' | 'stopping' | 'stopped' = 'recording';
		let stopPromise: Promise<void> | null = null;
		return Object.freeze({
			get state() { return state; },
			pause: () => false,
			resume: () => false,
			stop() {
				if (stopPromise) return stopPromise;
				state = 'stopping';
				stopPromise = routed.stop()
					.then(() => dependencies.synchronizeActivatedProject())
					.then(() => { state = 'stopped'; });
				return stopPromise;
			},
			dispose() { return this.stop(); },
		});
	}

	function requireOrchestrator(): NonNullable<typeof orchestrator> {
		if (!orchestrator) throw new Error('Take cycle production composition is unavailable.');
		return orchestrator;
	}
}

function envelopeBindings(envelope: TakeCycleRecoveryEnvelope): readonly TakeMediaPublicationBinding[] {
	return Object.freeze(envelope.entries.map(({ journal }) => Object.freeze({ ...journal.binding })));
}
