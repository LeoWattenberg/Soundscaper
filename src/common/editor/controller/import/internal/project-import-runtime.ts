/* SPDX-License-Identifier: AGPL-3.0-only */

import type { inspectEncodedAudioSampleRate } from '../../../audio-file-metadata.js';
import type { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../../../commands.js';
import type { isAudioEditorEngineSupported } from '../../../engine.js';
import type { createStableId, findTrack } from '../../../project.js';
import type { isAudioEditorVideoFile } from '../../../video-media.js';
import type { inspectWavBlobPcm, streamWavBlobPcm } from '../../../wav-import.js';
import type { formatLegacyAupWarning, isLegacyAupFile, isLegacyBlockFile, isWavFile, stripExtension } from '../../shared/app-helpers.ts';
import type { deferredArchiveRuntime } from '../../document/deferred-archive-runtime.ts';
import type { ImportCompositionDependencies } from './import-composition-types.ts';
import type { EditorProjectToken } from '../../shared/lifecycle.ts';
import type { audioBufferChannels, bufferFromChannels, canonicalizeBuffer, sourcePcmBytes, writeBuffer } from '../../source/source-audio.ts';
import type { ImportVideoFile } from './source-import.ts';
import type { generateWaveformPeaks, peakCacheKey } from '../../source/waveform-analysis.ts';

/** Only ports read by the audio and legacy-project import coordinator. */
export interface ProjectImportRuntime extends Pick<ImportCompositionDependencies,
	| 'activateStoredSource' | 'cacheSourceBuffer' | 'commit' | 'copy' | 'editingBlocked'
	| 'engine' | 'ffmpeg' | 'handleError' | 'preflightStorage' | 'getProject' | 'projectSampleRate'
	| 'publishDocumentSnapshot' | 'retireSourceChunkProvider' | 'setStatus' | 'sourceBuffers'
	| 'sourcePeaks' | 'state' | 'store' | 'switchProject' | 'warnEnvelope' | 'taskProgress'
> {
	readonly SOURCE_CHUNK_FRAMES: number;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly importVideoFile: ImportVideoFile;
	readonly convertLegacyAupToProject: typeof deferredArchiveRuntime.convertLegacyAupToProject;
	readonly decodeLegacyAupProject: typeof deferredArchiveRuntime.decodeLegacyAupProject;
	readonly audioBufferChannels: typeof audioBufferChannels;
	readonly bufferFromChannels: typeof bufferFromChannels;
	readonly canonicalizeBuffer: typeof canonicalizeBuffer;
	readonly createAddClipCommand: typeof createAddClipCommand;
	readonly createAddSourceCommand: typeof createAddSourceCommand;
	readonly createAddTrackCommand: typeof createAddTrackCommand;
	readonly createStableId: typeof createStableId;
	readonly findTrack: typeof findTrack;
	readonly formatLegacyAupWarning: typeof formatLegacyAupWarning;
	readonly generateWaveformPeaks: typeof generateWaveformPeaks;
	readonly inspectEncodedAudioSampleRate: typeof inspectEncodedAudioSampleRate;
	readonly inspectWavBlobPcm: typeof inspectWavBlobPcm;
	readonly isAudioEditorVideoFile: typeof isAudioEditorVideoFile;
	readonly isAudioEditorEngineSupported: typeof isAudioEditorEngineSupported;
	readonly isLegacyAupFile: typeof isLegacyAupFile;
	readonly isLegacyBlockFile: typeof isLegacyBlockFile;
	readonly isWavFile: typeof isWavFile;
	readonly peakCacheKey: typeof peakCacheKey;
	readonly sourcePcmBytes: typeof sourcePcmBytes;
	readonly streamWavBlobPcm: typeof streamWavBlobPcm;
	readonly stripExtension: typeof stripExtension;
	readonly writeBuffer: typeof writeBuffer;
}
