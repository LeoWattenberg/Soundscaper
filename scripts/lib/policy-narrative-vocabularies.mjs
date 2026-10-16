/* SPDX-License-Identifier: AGPL-3.0-only */

export const FALLBACK_WITNESS_ROLES = Object.freeze([
	'project-audio-mix-v1',
	'audio-track-render-v1',
	'project-video-render-v1',
	'video-clip-render-v1',
]);

export const FALLBACK_ROUNDTRIP_WORKFLOWS = Object.freeze([
	'audio-whole-mix-electron-roundtrip',
	'audio-track-render-electron-roundtrip',
	'video-full-project-electron-roundtrip',
	'video-clip-render-electron-roundtrip',
]);

export const ELECTRON_LIBRARY_WORKFLOWS = Object.freeze([
	'electron-soundscaper-to-framescaper-to-soundscaper-library',
	'electron-framescaper-to-soundscaper-to-framescaper-library',
]);

export const ELECTRON_LEASE_WORKFLOWS = Object.freeze([
	'same-project-simultaneous-open',
	'cross-product-simultaneous-open',
	'writer-lease-transfer',
	'stale-lease-takeover',
	'conflicting-canonical-commit',
	'renderer-loss-during-operation',
	'orderly-process-restart',
	'crash-restart-recovery',
]);
