/* SPDX-License-Identifier: AGPL-3.0-only */

// Public editor facade. Production internals import their owning domain module
// directly; adding an export here is an API decision, not a convenience barrel.
export * from './facade.ts';
export * from './types.ts';
export * from './controller/lifecycle.ts';
export * from './storage/status.ts';
export * from './worker-protocol.ts';
export {
	DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
	WorkerRequestBroker,
	normalizeWorkerRequestTimeout,
} from './worker-request-broker.ts';
export * from './commands/protocol.ts';
export {
	EDITOR_COMMAND_DOMAINS_EXHAUSTIVE,
	defineEditorCommandHandlerRegistry,
	dispatchEditorCommand,
} from './commands/registry.ts';
export {
	applyEditorCommand,
	createAddClipCommand,
	createAddLabelCommand,
	createAddLabelTrackCommand,
	createAddSignatureEventCommand,
	createAddSourceCommand,
	createAddTempoEventCommand,
	createAddTimelineAnnotationCommand,
	createAddTrackCommand,
	createBatchSetTimelineAnnotationsCommand,
	createConvertTimelineAnnotationCommand,
	createMoveTimelineAnnotationsCommand,
	createRemoveTimelineAnnotationsCommand,
	createRemoveSignatureEventCommand,
	createRemoveTempoEventCommand,
	createReplaceClipSourceCommand,
	createResizeTimelineAnnotationCommand,
	createSetTempoMapModeCommand,
	createUpdateSignatureEventCommand,
	createUpdateTempoEventCommand,
	createUpdateTimelineAnnotationsCommand,
	prepareCut,
	prepareGroupClipsCommand,
	prepareKeepRangeCommand,
	prepareLinkedSplitCommand,
	prepareOverwriteClipCommand,
	preparePasteCommand,
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	prepareSplitCommand,
	prepareTransformClipsCommand,
} from './commands.js';
export * from './project-media-factory.ts';
export * from './project-v17.ts';
export * from './project-current.ts';
export * from './project-feature-requirements.ts';
export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-current.ts';
export {
	AUDIO_EDITOR_SAMPLE_RATE,
	cloneProject,
	createStableId,
	findClip,
	findClipTrack,
	findSource,
	findTrack,
	projectDurationFrames,
	validateAudioEditorProject,
} from './project.js';
export {
	AudioEditorEngineDisposedError,
	WebAudioEditorEngine,
	createAudioEditorEngine,
	isAudioEditorEngineSupported,
} from './engine.js';
export { AudioEditorProjectStore } from './storage.js';
export {
	FfmpegCoreUnavailableError,
	FfmpegDisposedError,
	FfmpegEncodingError,
	FfmpegVideoEncodingError,
	createEditorFfmpeg,
} from './ffmpeg.js';
// The AUP4 archive client is deliberately absent: it is optional archive implementation
// with no chunk owner, and `controller/deferred-archive-runtime.ts` is the only production
// reach into it, through a dynamic import. Re-exporting it from this eagerly owned barrel
// put the whole archive chunk one static import away from the boot graph.
export { StaffPadRenderClient } from './staffpad/client.js';
export { WavPackCodecClient } from './wavpack/client.js';
export { ChunkStreamClient } from './chunk-stream-client.js';
export {
	PRODUCT_IDS,
	PRODUCT_PROFILES,
	normalizeProductId,
	otherProductId,
	productLocalePath,
	productProfile,
} from '../products.js';
