/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createProjectBinService,
	type ProjectBinServiceDependencies,
} from '../../src/common/editor/controller/project-bin-service.ts';
import type { ProjectBinPreviewEngine } from '../../src/common/editor/controller/project-bin-preview-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorCommand } from '../../src/common/editor/commands/protocol.ts';
import type {
	ProjectBinClip,
	ProjectBinPreview,
	ProjectBinProject,
} from '../../src/common/editor/controller/project-bin-types.ts';

interface HarnessOptions {
	readonly importProjectBinFile?: ProjectBinServiceDependencies['importProjectBinFile'];
	readonly revokeVideoVisual?: ProjectBinServiceDependencies['revokeVideoVisual'];
	readonly sourceChunkProviders?: ProjectBinServiceDependencies['sourceChunkProviders'];
	readonly retireSourceChunkProvider?: ProjectBinServiceDependencies['retireSourceChunkProvider'];
	readonly previewEngine?: ReturnType<typeof createPreviewEngine>;
	readonly createPreviewEngine?: ProjectBinServiceDependencies['createPreviewEngine'];
	readonly editingBlocked?: () => boolean;
	readonly getPositionFrames?: ProjectBinServiceDependencies['getPositionFrames'];
	readonly playbackState?: string;
	readonly visualMediaUrl?: string | null;
	readonly projectChanged?: ProjectBinServiceDependencies['projectChanged'];
	readonly protectedSourceIds?: Set<string>;
}

export function createHarness(initialProject: ProjectBinProject, options: HarnessOptions = {}) {
	const lifetime = new EditorControllerLifetime();
	const projects = new EditorProjectGeneration();
	projects.activate(initialProject.id);
	let project = initialProject;
	let history: unknown = { present: project };
	let selectedClipId: string | null = null;
	let selectedTrackId: string | null = null;
	let preview: ProjectBinPreview | null = null;
	let importing = false;
	let publishCount = 0;
	let restoreCount = 0;
	let playbackStopCount = 0;
	let id = 0;
	const missingSourceIds = new Set<string>();
	const deletedSources: string[] = [];
	const deletedMedia: string[] = [];
	const selectionCommands: Array<Extract<AudioEditorCommand, { type: 'selection/set' }>> = [];
	const commits: Array<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}> = [];
	const previewEngine = options.previewEngine ?? createPreviewEngine(Promise.resolve());
	const sourceChunkProviders = options.sourceChunkProviders
		?? Object.assign(new Map<string, unknown>(), { drain: async () => undefined });
	const dependencies: ProjectBinServiceDependencies = {
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.',
			localSourcesMissing: 'Local sources missing.',
			track: 'Track',
			projectBinReplacementIncompatible: 'Replacement incompatible.',
		},
		trackColors: ['blue', 'green'], retireTimelinePlayback: () => { playbackStopCount += 1; },
		protectedSourceIds: options.protectedSourceIds ?? new Set<string>(),
		playbackEngine: {
			getState: () => ({ state: options.playbackState ?? 'stopped' }),
			stop: () => { playbackStopCount += 1; },
		},
		sourceBuffers: new Map<string, AudioBuffer>(),
		sourceChunkProviders,
		retireSourceChunkProvider: options.retireSourceChunkProvider ?? (async (sourceId) => {
			sourceChunkProviders.delete(sourceId);
			await sourceChunkProviders.drain();
		}),
		sourcePeaks: new Map<string, unknown>(),
		missingSourceIds,
		store: {
			deleteSource: async (sourceId) => { deletedSources.push(sourceId); },
			deleteMediaAsset: async (sourceId) => { deletedMedia.push(sourceId); },
			getLinkedOriginalBinding: async () => null, getSourceMetadata: async () => null, relinkLinkedAudioOriginal: async () => { throw new Error('Unexpected linked-audio relink.'); }, releaseLinkedOriginalLocator: async () => true, getLinkedVideoOriginalBinding: async () => null, relinkLinkedVideoOriginal: async () => { throw new Error('Unexpected linked-video relink.'); }, releaseLinkedVideoOriginalLocator: async () => true,
		},
		createPreviewEngine: options.createPreviewEngine ?? (({ onState }) => {
			previewEngine.setOnState(onState);
			return previewEngine;
		}),
		createId: (prefix) => `${prefix}-${++id}`,
		captureProject: () => projects.capture(project.id),
		assertProject: (token) => projects.assertCurrent(token),
		getProject: () => project,
		getSelectedClipId: () => selectedClipId,
		getSelectedTrackId: () => selectedTrackId,
		setSelectedClipId: (value) => { selectedClipId = value; },
		setSelectedTrackId: (value) => { selectedTrackId = value; },
		getPreview: () => preview,
		setPreview: (value) => { preview = value; },
		editingBlocked: options.editingBlocked ?? (() => false),
		commit: (command, selection) => { commits.push({ command, selection }); },
		updateSelection: (command) => { selectionCommands.push(command); },
		getPositionFrames: options.getPositionFrames ?? (() => 128),
		normalizeTimelineStartFrame: (value) => Math.max(0, Math.round(Number(value))),
		getVisualData: () => options.visualMediaUrl == null ? null : { mediaUrl: options.visualMediaUrl },
		activateStoredSource: async () => null, invalidateSourceRuntime: async () => undefined, activateVideoSource: async () => null,
		digestMediaContent: async (blob) => `digest:${await (blob as Blob).text()}`,
		admitChangedContentAudioCandidate: async () => undefined,
		admitChangedContentVideoCandidate: async () => undefined,
		deleteVideoDerivative: async () => undefined,
		captureActiveDocument: () => ({ history, project }),
		restoreActiveDocument: (snapshot) => {
			history = snapshot.history;
			project = snapshot.project;
			restoreCount += 1;
		},
		setImporting: (value) => { importing = value; },
		importProjectBinFile: options.importProjectBinFile ?? (async () => null),
		projectChanged: options.projectChanged ?? (() => undefined),
		publish: () => { publishCount += 1; },
		revokeVideoVisual: options.revokeVideoVisual ?? (() => undefined),
	};
	const service = createProjectBinService(dependencies);
	return {
		service,
		lifetime,
		commits,
		selectionCommands,
		missingSourceIds,
		deletedSources,
		deletedMedia,
		get project() { return project; },
		get preview() { return preview; },
		get selectedClipId() { return selectedClipId; },
		get selectedTrackId() { return selectedTrackId; },
		get importing() { return importing; },
		get publishCount() { return publishCount; },
		get restoreCount() { return restoreCount; },
		get playbackStopCount() { return playbackStopCount; },
		replaceImportedDocument(value: ProjectBinProject) {
			project = value;
			history = { present: value };
		},
		switchProject(value: ProjectBinProject) {
			project = value;
			history = { present: value };
			projects.activate(value.id);
		},
	};
}

export function projectFixture(options: Readonly<{
	id?: string;
	clips?: readonly ProjectBinClip[];
	projectBinClips?: readonly ProjectBinClip[];
	selectionClipIds?: readonly string[];
	sources?: ProjectBinProject['sources'];
}> = {}): ProjectBinProject {
	const clips = options.clips ?? [];
	const sourceIds = new Set([
		...clips.map((clip) => clip.sourceId),
		...(options.projectBinClips ?? []).map((clip) => clip.sourceId),
	]);
	return {
		schemaVersion: 17, revision: 0,
		id: options.id ?? 'project',
		sampleRate: 48_000,
		sources: options.sources ?? [...sourceIds].map((sourceId) => ({
			id: sourceId, kind: 'audio', sampleRate: 48_000, frameCount: 8_000, channelCount: 1,
		})),
		clips,
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: clips.map((clip) => clip.id) }],
		projectBin: { clips: options.projectBinClips ?? [] },
		selection: { clipIds: options.selectionClipIds ?? [] },
	};
}

export function clipFixture(overrides: Partial<ProjectBinClip> = {}): ProjectBinClip {
	return {
		id: 'clip',
		sourceId: 'source',
		title: 'Clip',
		kind: 'audio',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 1_000,
		durationFrames: 1_000,
		...overrides,
	};
}

export function createPreviewEngine(play: Promise<void>) {
	let disposeCalls = 0;
	let pauseCalls = 0;
	let onState: (state: string) => void = () => undefined;
	const engine: ProjectBinPreviewEngine & {
		readonly disposeCalls: number;
		readonly pauseCalls: number;
		setOnState(listener: (state: string) => void): void;
		emit(state: string): void;
	} = {
		loadProject: () => undefined,
		setSourceResolver: () => undefined,
		play: async () => play,
		pause: () => { pauseCalls += 1; },
		stop: () => undefined,
		dispose: async () => { disposeCalls += 1; },
		get disposeCalls() { return disposeCalls; },
		get pauseCalls() { return pauseCalls; },
		setOnState: (listener) => { onState = listener; },
		emit: (state) => { onState(state); },
	};
	return engine;
}
