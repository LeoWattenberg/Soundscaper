/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectV17 } from '../project-v17-validation.ts';
import type { TakeCycleRoutedCaptureProject } from './take-cycle-routed-capture-validation.ts';
import type { ProjectRepositoryPort } from '../storage/project-repository.ts';
import type { RawPcmSpoolRepository } from '../storage/raw-pcm-spool-repository.ts';
import type { SourceRepository } from '../storage/source-repository.ts';
import type { TakeCycleRecoveryEnvelopeRepository } from '../storage/take-cycle-recovery-envelope-repository.ts';
import type { RecordingRoute, RecordingSelection } from './recording-transaction-types.ts';
import type { EditorControllerLifetime, EditorProjectToken } from './lifecycle.ts';
import {
	createTakeCycleCurrentProjectPublicationService,
	type TakeCyclePublicationHistory,
	type TakeCyclePublicationSession,
} from './take-cycle-current-project-publication-service.ts';
import {
	createTakeCycleProductionComposition,
	type TakeCycleProductionComposition,
} from './take-cycle-production-composition.ts';
import type { TakeCycleRoutedCaptureRuntime } from './take-cycle-routed-capture-types.ts';

interface TakeCycleAppState {
	history: TakeCyclePublicationHistory | null;
	saveState: string;
	readonly recordingRouting: Readonly<{ readonly routes: Readonly<Record<string, RecordingRoute>> }>;
	readonly monitoring: boolean;
	readonly recordingInputGain: number;
}

interface TakeCycleAppStore {
	readonly projectRepository: ProjectRepositoryPort;
	readonly sourceRepository: SourceRepository;
	readonly rawPcmSpoolRepository: RawPcmSpoolRepository;
	readonly takeCycleRecoveryEnvelopeRepository: TakeCycleRecoveryEnvelopeRepository;
	getSourceMetadata(sourceId: string): PromiseLike<unknown> | unknown;
}

interface TakeCycleAppSource {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey?: string;
}

type TakeCycleAppProject = AudioEditorProjectV17 & TakeCycleRoutedCaptureProject;

type RoutedRuntimePorts = Pick<TakeCycleRoutedCaptureRuntime,
	'capturePool' | 'engine' | 'sourceChunkFrames' | 'streamAudioChannelCount'
	| 'recordingStreamIsLive' | 'createRecorder' | 'beginPlaybackCachePreparation'
	| 'handleError'
>;

export interface TakeCycleAppCompositionDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'cancelTask'>;
	readonly store: TakeCycleAppStore;
	readonly session: TakeCyclePublicationSession;
	readonly projectGeneration: Readonly<{
		capture(projectId?: string | null): EditorProjectToken;
		assertCurrent(token: EditorProjectToken): void;
	}>;
	readonly state: TakeCycleAppState;
	readonly recording: RoutedRuntimePorts;
	getProject(): TakeCycleAppProject | null;
	setProject(project: TakeCycleAppProject): void;
	activeSelection(project: TakeCycleAppProject): RecordingSelection | null;
	findAudioSource(project: TakeCycleAppProject, mediaId: string): TakeCycleAppSource | null;
	trackName(project: TakeCycleAppProject, trackId: string): string;
	getRoutes(): Readonly<Record<string, RecordingRoute>>;
	soundActivationEnabled(): boolean;
	recordingRouteSourceKey(route: RecordingRoute): string;
	createId(prefix: string): string;
	createRecordingName(trackName: string): string;
	preflightRecording(bytes: number): Promise<void>;
	releaseInputs(): void;
	activateStoredSource(source: TakeCycleAppSource, metadata: unknown): PromiseLike<unknown> | unknown;
	publishProject(project: AudioEditorProjectV17): PromiseLike<void> | void;
	synchronizeProject(project: AudioEditorProjectV17): PromiseLike<void> | void;
	now(): Date | string;
}

/** Adapt the legacy app root to the strict production cycle composition. */
export function createTakeCycleAppComposition(
	dependencies: TakeCycleAppCompositionDependencies,
): Readonly<TakeCycleProductionComposition> {
	const publication = createTakeCycleCurrentProjectPublicationService({
		session: dependencies.session,
		getActiveProject: dependencies.getProject,
		getActiveHistory: () => dependencies.state.history,
		setActiveProject: (project) => dependencies.setProject(appProject(project)),
		setActiveHistory: (history) => { dependencies.state.history = history; },
		isActiveProject: (projectId) => dependencies.getProject()?.id === projectId,
		synchronizeProject: async (project) => {
			dependencies.state.saveState = 'saved';
			await dependencies.publishProject(project);
		},
	});
	return createTakeCycleProductionComposition({
		lifetime: dependencies.lifetime,
		projects: dependencies.store.projectRepository,
		sources: dependencies.store.sourceRepository,
		rawPcmSpools: dependencies.store.rawPcmSpoolRepository,
		recoveryRepository: dependencies.store.takeCycleRecoveryEnvelopeRepository,
		captureProject: () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null),
		assertProject: (token) => dependencies.projectGeneration.assertCurrent(token),
		createId: (prefix) => dependencies.createId(prefix),
		publishCurrentProject: publication.publish,
		activateCommittedSource: activateCommittedSource,
		synchronizeActivatedProject: async () => dependencies.synchronizeProject(requireProject()),
		now: dependencies.now,
		routed: {
			...dependencies.recording,
			getProject: requireProject,
			getRoutes: dependencies.getRoutes,
			activeSelection: dependencies.activeSelection,
			soundActivationEnabled: dependencies.soundActivationEnabled,
			recordingRouteSourceKey: dependencies.recordingRouteSourceKey,
			createGroupId: () => dependencies.createId('take-group'),
			createRecordingName: (trackId) => dependencies.createRecordingName(
				dependencies.trackName(requireProject(), trackId),
			),
			preflightStorage: (bytes) => dependencies.preflightRecording(bytes),
			releaseInputs: dependencies.releaseInputs,
			monitor: dependencies.state.monitoring,
			inputGain: dependencies.state.recordingInputGain,
		},
	});

	function requireProject(): TakeCycleAppProject {
		const project = dependencies.getProject();
		if (!project) throw staleProjectError();
		return project;
	}

	async function activateCommittedSource(mediaId: string): Promise<void> {
		const captured = dependencies.getProject();
		if (!captured) throw staleProjectError();
		const source = dependencies.findAudioSource(captured, mediaId);
		if (!source) throw staleProjectError();
		const metadata = await dependencies.store.getSourceMetadata(source.storageKey || source.id);
		if (dependencies.getProject() !== captured || !metadata) throw staleProjectError();
		await dependencies.activateStoredSource(source, metadata);
	}
}

function appProject(project: AudioEditorProjectV17): TakeCycleAppProject {
	const candidate = project as unknown as Partial<TakeCycleRoutedCaptureProject>;
	if (!candidate.loop || !Array.isArray(candidate.sequences)) throw staleProjectError();
	return project as TakeCycleAppProject;
}

function staleProjectError(): Error {
	const error = new Error('Take cycle app composition belongs to a stale project.');
	error.name = 'AbortError';
	return error;
}
