/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_BUNDLED_FLAC_WASM } from './desktop-bundled-flac-runtime.mjs';
import { DESKTOP_BUNDLED_MPG123_WASM } from './desktop-bundled-mpg123-runtime.mjs';
import { DESKTOP_BUNDLED_OPUS_WASM } from './desktop-bundled-opus-runtime.mjs';
import { DESKTOP_BUNDLED_VORBIS_WASM } from './desktop-bundled-vorbis-runtime.mjs';
import { DESKTOP_BUNDLED_WAVPACK_WASM } from './desktop-bundled-wavpack-runtime.mjs';

export {
	DESKTOP_BUNDLED_FLAC_WASM, DESKTOP_BUNDLED_MPG123_WASM, DESKTOP_BUNDLED_OPUS_WASM,
	DESKTOP_BUNDLED_VORBIS_WASM, DESKTOP_BUNDLED_WAVPACK_WASM,
};

/** Exact compiled transitive modules required by desktop main audio codec entry points. */
export const DESKTOP_AUDIO_CODEC_RUNTIME_FILES = Object.freeze([
	'desktop/bounded-regular-file.js',
	'desktop/bundled-audio-codec-runtime.js',
	'desktop/bundled-flac-audio-codec-runtime.js',
	'desktop/bundled-flac-stream.js',
	'desktop/bundled-mpeg-audio-stream.js',
	'desktop/bundled-mpg123-audio-codec-runtime.js',
	'desktop/bundled-opus-audio-codec-runtime.js',
	'desktop/bundled-opus-stream.js',
	'desktop/bundled-vorbis-audio-codec-runtime.js',
	'desktop/bundled-vorbis-stream.js',
	'desktop/bundled-wavpack-audio-codec-runtime.js',
	'desktop/bundled-wavpack-stream.js',
	'desktop/desktop-audio-codec-broker.js',
	'desktop/desktop-audio-codec-capability-contract.js',
	'desktop/desktop-audio-codec-main-ipc.js',
	'desktop/desktop-audio-codec-operation-contract.js',
	'desktop/desktop-audio-codec-runtime-composition.js',
	'desktop/desktop-audio-ffmpeg-plan.js',
	'desktop/desktop-audio-ffmpeg-wave-output.js',
	'desktop/desktop-audio-os-codec-candidates.js',
	'desktop/external-ffmpeg-audio-operation-runner.js',
	'desktop/os-audio-codec-canary-adapter.js',
	'desktop/os-audio-codec-operation-runner.js',
	'desktop/os-audio-codec-runtime.js',
	'desktop/os-audio-codec-source-inspection.js',
	'desktop/os-codec-capability-adapter.js',
	'desktop/os-codec-native-canary-runner.js',
	'desktop/process-tree-termination.js',
	'src/common/editor/desktop-codec-coordinator.js',
	'src/common/editor/desktop-codec-provider-catalog.js',
	'src/common/editor/desktop-wavpack-codec-profile.js',
	DESKTOP_BUNDLED_FLAC_WASM.file,
	DESKTOP_BUNDLED_MPG123_WASM.file,
	DESKTOP_BUNDLED_OPUS_WASM.file,
	DESKTOP_BUNDLED_VORBIS_WASM.file,
	DESKTOP_BUNDLED_WAVPACK_WASM.file,
]);

const DESKTOP_EXTERNAL_FFMPEG_CONTROL_RUNTIME_FILES = Object.freeze([
	'desktop/external-ffmpeg-installer-node-runtime.js',
	'desktop/external-ffmpeg-installer.js',
	'desktop/external-ffmpeg-node-runtime.js',
	'desktop/external-ffmpeg-preference-main-ipc.js',
	'desktop/external-ffmpeg-preference-node-probe.js',
	'desktop/external-ffmpeg-preference-service.js',
	'desktop/external-ffmpeg-probe.js',
]);

/** Exact desktop codec graph: source modules plus reviewed FLAC, mpg123, Opus, Vorbis, and WavPack payloads. */
export const DESKTOP_CODEC_RUNTIME_FILES = Object.freeze([
	...DESKTOP_AUDIO_CODEC_RUNTIME_FILES,
	...DESKTOP_EXTERNAL_FFMPEG_CONTROL_RUNTIME_FILES,
].sort());

/** Compatibility name retained for the existing desktop runtime staging caller. */
export const DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES = DESKTOP_CODEC_RUNTIME_FILES;
