/* SPDX-License-Identifier: AGPL-3.0-only */
import { createExportSnapshotRenderer, type ExportSnapshotRenderer, type ExportSnapshotRendererRuntime } from '../../export-snapshot-renderer.ts';
import { createRealtimeEncodedAudioExport, type RealtimeEncodedExportRuntime } from '../audio/audio-realtime-encoded-export.ts';
import { renderAndEncodeAudioExport, type AudioExportRenderOrchestrationRuntime, type AudioExportRenderOptions } from '../audio/audio-export-render-orchestration.ts';
import type { RenderedAudioEncodingRuntime } from '../rendered-audio-encoding.ts';
import { createOwnedStemProgress, type StemPresentationPorts } from './owned-stem-progress.ts';

export interface OwnedStemRenderResources {
	readonly snapshot: ExportSnapshotRendererRuntime;
	readonly realtime: RealtimeEncodedExportRuntime;
	readonly encoding: RenderedAudioEncodingRuntime;
	readonly normalizeProjectSampleRate: AudioExportRenderOrchestrationRuntime['normalizeProjectSampleRate'];
	readonly suppliedSnapshotRenderer?: ExportSnapshotRenderer;
}

/** Private factories need the same offline and retry resources as the existing producer. Missing injected ports retain sequential execution. */
export function supportsOwnedStemRendering(resources: OwnedStemRenderResources): boolean {
	if (!resources?.snapshot || !resources.realtime || !resources.encoding || typeof resources.normalizeProjectSampleRate !== 'function') return false;
	if (resources.suppliedSnapshotRenderer && typeof resources.suppliedSnapshotRenderer.createOwnedEntryRenderer !== 'function') return false;
	const snapshot = resources.snapshot; const encoding = resources.encoding; const realtime = resources.realtime;
	return [snapshot.createCacheAwareRenderEngine, snapshot.prepareCommittedTimePitchCaches, snapshot.throwIfAborted,
		encoding.applyMediaChannelMapping, encoding.audioBufferChannels, encoding.encodeAiff, encoding.encodeWav, encoding.resampleBuffer, encoding.throwIfAborted,
		realtime.createCacheAwareRenderEngine, realtime.prepareCommittedTimePitchCaches, realtime.throwIfAborted, realtime.normalizeProjectSampleRate,
		realtime.createTemporaryFileSink, realtime.createStableId, realtime.createStreamingWindowedSincResampler,
		realtime.createAiffStreamEncoder, realtime.createWavStreamEncoder].every((port) => typeof port === 'function')
		&& Boolean(snapshot.options && encoding.copy && realtime.copy);
}

/** Every following entry gets a fresh render/progress runtime; shared global phases and cancellation handles are not mutated. */
export function createOwnedStemRenderer(resources: OwnedStemRenderResources, presentation: StemPresentationPorts, signal: AbortSignal) {
	const progress = createOwnedStemProgress(presentation, signal);
	const snapshot = resources.suppliedSnapshotRenderer?.createOwnedEntryRenderer?.(progress.taskProgress, progress.taskProgress.updateActive)
		?? createExportSnapshotRenderer({ ...resources.snapshot, taskProgress: progress.taskProgress, updateExportProgress: progress.taskProgress.updateActive });
	const renderRealtimeEncoded = createRealtimeEncodedAudioExport({ ...resources.realtime,
		taskProgress: progress.taskProgress, setStatus: progress.setStatus, withRenderProgress: snapshot.withRenderProgress });
	return Object.freeze({ progress,
		render: (options: Omit<AudioExportRenderOptions, 'signal'>) => renderAndEncodeAudioExport({
			encodingRuntime: { ...resources.encoding, setStatus: progress.setStatus }, normalizeProjectSampleRate: resources.normalizeProjectSampleRate,
			renderRealtimeEncoded, renderSnapshot: snapshot.renderSnapshot, taskProgress: progress.taskProgress,
		}, { ...options, signal: progress.signal }),
	});
}
