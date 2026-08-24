/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact compiled transitive modules required by desktop main audio codec entry points. */
export const DESKTOP_AUDIO_CODEC_RUNTIME_FILES = Object.freeze([
	'desktop/desktop-audio-codec-broker.js',
	'desktop/desktop-audio-codec-capability-contract.js',
	'desktop/desktop-audio-codec-main-ipc.js',
	'desktop/desktop-audio-codec-operation-contract.js',
	'desktop/desktop-audio-codec-runtime-composition.js',
	'desktop/desktop-audio-ffmpeg-plan.js',
	'desktop/external-ffmpeg-audio-operation-runner.js',
	'src/common/editor/desktop-codec-coordinator.js',
	'src/common/editor/desktop-codec-provider-catalog.js',
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

/** Compiled, source-only desktop codec modules; never FFmpeg binaries or browser WASM. */
export const DESKTOP_CODEC_RUNTIME_FILES = Object.freeze([
	...DESKTOP_AUDIO_CODEC_RUNTIME_FILES,
	...DESKTOP_EXTERNAL_FFMPEG_CONTROL_RUNTIME_FILES,
].sort());

/** Compatibility name retained for the existing desktop runtime staging caller. */
export const DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES = DESKTOP_CODEC_RUNTIME_FILES;
