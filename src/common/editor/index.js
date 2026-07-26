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
	createAddSourceCommand,
	createAddTrackCommand,
	createReplaceClipSourceCommand,
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
export {
	AUDIO_EDITOR_MEDIA_KINDS,
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	AUDIO_EDITOR_TRACK_TYPES,
	cloneAudioEditorProjectV5,
	createAudioClipV5,
	createAudioEditorProjectV5,
	createAudioSourceV5,
	createAudioTrackV5,
	createLabelTrackV5,
	createMediaClipV5,
	createMediaSourceV5,
	createMediaTrackV5,
	createProjectBinV5,
	createVideoClipV5,
	createVideoSourceV5,
	createVideoTrackV5,
	loadAudioEditorProjectV5,
	validateAudioEditorProjectV5,
} from './project-v5.js';
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
export { Aup4ClientError, Aup4WorkerClient, createAup4Client } from './aup4-client.js';
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
