/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectEncodedAudioSampleRate } from '../../audio-file-metadata.js';
import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../../commands.js';
import { isAudioEditorEngineSupported } from '../../engine.js';
import { createStableId, findTrack } from '../../project.js';
import { digestMediaContent } from '../../storage/media-content-digest.ts';
import {
	audioEditorVideoThumbnailTimes,
	createAudioEditorVideoFrameExtractor,
	isAudioEditorVideoFile,
} from '../../video-media.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../wav-import.js';
import {
	formatLegacyAupWarning,
	isLegacyAupFile,
	isLegacyBlockFile,
	isWavFile,
	stripExtension,
	throwIfAborted,
} from '../shared/app-helpers.ts';
import { fitAudioBufferToFrames } from './internal/audio-buffer-frame-fit.ts';
import { deferredArchiveRuntime } from '../document/deferred-archive-runtime.ts';
import type { ImportCompositionDependencies } from './internal/import-composition-types.ts';
import { createProjectBinService } from './internal/project-bin/project-bin-service.ts';
import { createProjectImportService } from './internal/project-import-service.ts';
import type {
	createFreesoundImportService,
	FreesoundImportRequest,
	FreesoundSearchRequest,
} from './internal/freesound-import-service.ts';
import {
	audioBufferChannels,
	bufferFromChannels,
	canonicalizeBuffer,
	sourcePcmBytes,
	writeBuffer,
} from '../source/source-audio.ts';
import {
	createImportVideoFile,
	type ImportVideoFile,
	type ImportVideoFileInput,
	type ImportVideoOptions,
} from './internal/source-import.ts';
import { admitChangedContentVideoCandidate, type ChangedContentVideoCandidateSource } from './internal/linked-media/video-relink-probe.ts';
import { generateWaveformPeaks, peakCacheKey } from '../source/waveform-analysis.ts';

export type {
	ImportCompositionCopy,
	ImportCompositionDependencies,
	ImportCompositionEngine,
	ImportCompositionFfmpeg,
	ImportCompositionProject,
	ImportCompositionState,
	ImportCompositionStore,
} from './internal/import-composition-types.ts';

/**
 * Build the import domain: file and project import, video import, and the
 * project bin that stages imported media and relinks it. The project import
 * routes video files to the video importer, which in turn normalises its
 * options through the project import, so the two are bound through a closure
 * in the order the file kinds are recognised.
 */
export function createImportComposition(dependencies: ImportCompositionDependencies) {
	const { state, copy, lifetime, engine, ffmpeg, store, projectVisual, taskProgress } = dependencies;
	const captureProject = () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null);
	const assertProject = (token: ReturnType<typeof captureProject>) => dependencies.projectGeneration.assertCurrent(token);
	const activateVideoSource: ImportCompositionDependencies['projectVisual']['activateVideoSource'] = (source, options) => (
		projectVisual.activateVideoSource(source, options)
	);
	const revokeVideoVisual: ImportCompositionDependencies['projectVisual']['revokeVideoVisual'] = (sourceId, expectedMediaUrl) => (
		projectVisual.revokeVideoVisual(sourceId, expectedMediaUrl)
	);
	let importVideoFile: ImportVideoFile | null = null;

	const projectImport = createProjectImportService({
		SOURCE_CHUNK_FRAMES: dependencies.sourceChunkFrames,
		activateStoredSource: dependencies.activateStoredSource,
		audioBufferChannels,
		bufferFromChannels,
		cacheSourceBuffer: dependencies.cacheSourceBuffer,
		canonicalizeBuffer,
		commit: dependencies.commit,
		convertLegacyAupToProject: async (...args) => {
			const decoded = await deferredArchiveRuntime.convertLegacyAupToProject(...args);
			return dependencies.adaptAudacityProject
				? { ...decoded, project: await dependencies.adaptAudacityProject(decoded.project) }
				: decoded;
		},
		copy,
		createAddClipCommand,
		createAddSourceCommand,
		createAddTrackCommand,
		createStableId,
		decodeLegacyAupProject: deferredArchiveRuntime.decodeLegacyAupProject,
		editingBlocked: dependencies.editingBlocked,
		engine,
		ffmpeg,
		findTrack,
		formatLegacyAupWarning,
		generateWaveformPeaks,
		handleError: dependencies.handleError,
		importVideoFile: (file: ImportVideoFileInput, options?: Readonly<ImportVideoOptions>) => {
			if (!importVideoFile) throw new Error('The video importer is not composed yet.');
			return importVideoFile(file, options);
		},
		inspectEncodedAudioSampleRate,
		inspectWavBlobPcm,
		isAudioEditorVideoFile,
		isAudioEditorEngineSupported,
		isLegacyAupFile,
		isLegacyBlockFile,
		isWavFile,
		peakCacheKey,
		preflightStorage: dependencies.preflightStorage,
		getProject: dependencies.getProject,
		captureProject,
		assertProject,
		projectSampleRate: dependencies.projectSampleRate,
		retireSourceChunkProvider: dependencies.retireSourceChunkProvider,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		setStatus: dependencies.setStatus,
		sourceBuffers: dependencies.sourceBuffers,
		sourcePcmBytes,
		sourcePeaks: dependencies.sourcePeaks,
		state,
		store,
		streamWavBlobPcm,
		stripExtension,
		switchProject: dependencies.switchProject,
		warnEnvelope: dependencies.warnEnvelope,
		writeBuffer,
		taskProgress,
	});
	type FreesoundService = ReturnType<typeof createFreesoundImportService>;
	let freesoundService: Promise<FreesoundService> | null = null;
	let activeFreesoundImport: symbol | null = null;
	const loadFreesoundService = async (): Promise<FreesoundService> => {
		assertFreesoundEnabled(dependencies.freesoundEnabled);
		freesoundService ??= import('./internal/freesound-import-service.ts').then(({ createFreesoundImportService: create }) => create({
			enabled: true,
			fetch: dependencies.freesoundFetch,
			apiBaseUrl: dependencies.freesoundApiBaseUrl,
			createContributionId: () => createStableId('attribution'),
			importFile: projectImport.importFile,
		}));
		return freesoundService;
	};
	const freesound = Object.freeze({
		search: async (request: FreesoundSearchRequest) => (await loadFreesoundService()).search(request),
		getSound: async (soundId: number, signal?: AbortSignal) => (await loadFreesoundService()).getSound(soundId, signal),
		importSound: async (request: FreesoundImportRequest) => {
			if (activeFreesoundImport !== null || dependencies.editingBlocked()) {
				throw new Error('Editing is blocked during Freesound import.');
			}
			const projectToken = captureProject();
			const importLease = Symbol('freesound-import');
			const assertImportProjectCurrent = () => {
				request.signal?.throwIfAborted();
				if (activeFreesoundImport !== importLease || !state.importing) {
					throw new Error('Freesound import admission is no longer current.');
				}
				if (state.readOnly) throw new Error('The project became read-only during Freesound import.');
				try { assertProject(projectToken); }
				catch (error) { throw new Error('The project changed during Freesound import.', { cause: error }); }
			};
			activeFreesoundImport = importLease;
			try {
				state.importing = true;
				dependencies.publishDocumentSnapshot();
				const service = await loadFreesoundService();
				assertImportProjectCurrent();
				return await service.importSound(request, assertImportProjectCurrent);
			} finally {
				if (activeFreesoundImport === importLease) {
					activeFreesoundImport = null;
					state.importing = false;
					dependencies.publishDocumentSnapshot();
				}
			}
		},
		previewUrl: (soundId: number) => freesoundPreviewUrl(
			dependencies.freesoundEnabled, dependencies.freesoundApiBaseUrl, soundId,
		),
	});
	importVideoFile = createImportVideoFile({
		SOURCE_CHUNK_FRAMES: dependencies.sourceChunkFrames,
		activateVideoSource,
		audioBufferChannels,
		audioEditorVideoThumbnailTimes,
		bufferFromChannels,
		cacheSourceBuffer: dependencies.cacheSourceBuffer,
		canonicalizeBuffer,
		commit: dependencies.commit,
		copy,
		createAddClipCommand,
		createAddSourceCommand,
		createAddTrackCommand,
		createAudioEditorVideoFrameExtractor,
		createStableId,
		engine,
		ffmpeg,
		helperTimingProbe: dependencies.helperTimingProbe,
		findTrack,
		fitAudioBufferToFrames,
		generateWaveformPeaks,
		inspectEncodedAudioSampleRate,
		normalizeImportOptions: projectImport.normalizeImportOptions,
		peakCacheKey,
		preflightStorage: dependencies.preflightStorage,
		getProject: dependencies.getProject,
		captureProject,
		assertProject,
		projectSampleRate: dependencies.projectSampleRate,
		revokeVideoVisual,
		sourceBuffers: dependencies.sourceBuffers,
		sourcePeaks: dependencies.sourcePeaks,
		store,
		stripExtension,
		warnEnvelope: dependencies.warnEnvelope,
		writeBuffer,
	});
	const projectBin = createProjectBinService({
		lifetime,
		copy,
		trackColors: dependencies.trackColors,
		protectedSourceIds: dependencies.protectedSourceIds,
		playbackEngine: engine,
		retireTimelinePlayback: dependencies.retireTimelinePlayback,
		sourceBuffers: dependencies.sourceBuffers,
		sourceChunkProviders: dependencies.sourceChunkProviders,
		sourcePeaks: dependencies.sourcePeaks,
		missingSourceIds: state.missingSourceIds,
		sourceResolver: dependencies.sourceResolver,
		store,
		activateVideoSource,
		createPreviewEngine: dependencies.createPreviewEngine,
		createId: createStableId,
		captureProject,
		assertProject,
		getProject: () => {
			const project = dependencies.getProject();
			if (!project) throw new Error('The project bin requires an open project.');
			return project;
		},
		getSelectedClipId: () => state.selectedClipId,
		getSelectedTrackId: () => state.selectedTrackId,
		setSelectedClipId: (clipId) => { state.selectedClipId = clipId; },
		setSelectedTrackId: (trackId) => { state.selectedTrackId = trackId; },
		getPreview: () => state.projectBinPreview,
		setPreview: (preview) => { state.projectBinPreview = preview; },
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		updateSelection: dependencies.updateSelection,
		getPositionFrames: () => engine.getPositionFrames(),
		normalizeTimelineStartFrame: projectImport.normalizeImportTimelineStartFrame,
		getVisualData: (clipId) => projectVisual.getProjectBinClipVisualData(clipId),
		captureActiveDocument: dependencies.captureActiveDocument,
		restoreActiveDocument: dependencies.restoreActiveDocument,
		setImporting: (importing) => { state.importing = importing; },
		importProjectBinFile: async (file, { signal }) => {
			throwIfAborted(signal);
			const result = await projectImport.importFile(file, projectImport.normalizeImportOptions({ destination: 'project-bin' }));
			throwIfAborted(signal);
			return result;
		},
		activateStoredSource: dependencies.activateStoredSource,
		invalidateSourceRuntime: dependencies.invalidateSourceRuntime,
		projectChanged: dependencies.projectChanged,
		publish: dependencies.publishDocumentSnapshot,
		retireSourceChunkProvider: dependencies.retireSourceChunkProvider,
		revokeVideoVisual,
		digestMediaContent,
		deleteVideoDerivative: (sourceId) => store.deleteVideoDerivative(sourceId),
		admitChangedContentVideoCandidate: (file, source, probeOptions) => admitChangedContentVideoCandidate(
			file,
			changedContentCandidateSource(source),
			{ createAudioEditorVideoFrameExtractor, engine, ffmpeg },
			probeOptions,
		),
	});

	return Object.freeze({
		importFile: projectImport.importFile,
		importFiles: projectImport.importFiles,
		normalizeImportOptions: projectImport.normalizeImportOptions,
		normalizeImportTimelineStartFrame: projectImport.normalizeImportTimelineStartFrame,
		importVideoFile,
		freesound,
		projectBin,
	});
}

export type ImportComposition = ReturnType<typeof createImportComposition>;

/** The probe compares a candidate against the source's canonical claims; a source that never recorded them cannot admit one. */
function changedContentCandidateSource(
	source: Readonly<{ id: string; width?: number; height?: number; sampleFrameCount?: number; sampleRate?: number }>,
): ChangedContentVideoCandidateSource {
	const { width, height, sampleFrameCount, sampleRate } = source;
	if (typeof width !== 'number' || typeof height !== 'number' || typeof sampleFrameCount !== 'number' || typeof sampleRate !== 'number') {
		throw new TypeError(`Video source ${source.id} has no canonical characteristics to admit a changed-content relink against.`);
	}
	return { width, height, sampleFrameCount, sampleRate };
}

function assertFreesoundEnabled(enabled: boolean): void {
	if (!enabled) throw new Error('Freesound is unavailable for this product.');
}

function freesoundPreviewUrl(enabled: boolean, apiBaseUrl: string, soundId: number): string {
	assertFreesoundEnabled(enabled);
	if (!Number.isSafeInteger(soundId) || soundId <= 0) throw new TypeError('A valid Freesound sound ID is required.');
	const base = new URL(apiBaseUrl);
	if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
		throw new TypeError('The Freesound API proxy base URL must use HTTPS.');
	}
	return new URL(`/api/freesound/sounds/${String(soundId)}/preview`, base).href;
}
