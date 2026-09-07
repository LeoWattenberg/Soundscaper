/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectEncodedAudioSampleRate } from '../audio-file-metadata.js';
import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../commands.js';
import { isAudioEditorEngineSupported } from '../engine.js';
import { createStableId, findTrack } from '../project.js';
import { digestMediaContent } from '../storage/media-content-digest.ts';
import {
	audioEditorVideoThumbnailTimes,
	createAudioEditorVideoFrameExtractor,
	isAudioEditorVideoFile,
} from '../video-media.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../wav-import.js';
import {
	formatLegacyAupWarning,
	isLegacyAupFile,
	isLegacyBlockFile,
	isWavFile,
	stripExtension,
	throwIfAborted,
} from './app-helpers.ts';
import { fitAudioBufferToFrames } from './audio-buffer-frame-fit.ts';
import { deferredArchiveRuntime } from './deferred-archive-runtime.ts';
import type { ImportCompositionDependencies } from './import-composition-types.ts';
import { createProjectBinService } from './project-bin-service.ts';
import { createProjectImportService } from './project-import-service.ts';
import {
	SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES,
	audioBufferChannels,
	bufferFromChannels,
	canonicalizeBuffer,
	sourcePcmBytes,
	writeBuffer,
} from './source-audio.ts';
import { createImportVideoFile, type ImportVideoFile } from './source-import.ts';
import { admitChangedContentVideoCandidate, type ChangedContentVideoCandidateSource } from './video-relink-probe.ts';
import { generateWaveformPeaks, peakCacheKey } from './waveform-analysis.ts';

export type {
	ImportCompositionCopy,
	ImportCompositionDependencies,
	ImportCompositionEngine,
	ImportCompositionFfmpeg,
	ImportCompositionProject,
	ImportCompositionState,
	ImportCompositionStore,
} from './import-composition-types.ts';

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
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES,
		SOURCE_CHUNK_FRAMES: dependencies.sourceChunkFrames,
		activateStoredSource: dependencies.activateStoredSource,
		audioBufferChannels,
		bufferFromChannels,
		cacheSourceBuffer: dependencies.cacheSourceBuffer,
		canonicalizeBuffer,
		commit: dependencies.commit,
		convertLegacyAupToProject: deferredArchiveRuntime.convertLegacyAupToProject,
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
		importVideoFile: (file: unknown, options?: unknown) => {
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
		sourceChunkProviders: dependencies.sourceChunkProviders,
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
