/* SPDX-License-Identifier: AGPL-3.0-only */

// Build-time inventory for the exact codec contracts browser fixtures import.
export const NIGHTLY_BROWSER_CODEC_INPUTS = Object.freeze([
	{ source: 'desktop/desktop-audio-codec-capability-contract.ts', destination: 'desktop/desktop-audio-codec-capability-contract.ts', kind: 'file', label: 'browser codec capability source map input' },
	{ source: 'desktop/desktop-audio-codec-operation-contract.ts', destination: 'desktop/desktop-audio-codec-operation-contract.ts', kind: 'file', label: 'browser codec operation source map input' },
	{ source: 'desktop/desktop-video-codec-operation-contract.ts', destination: 'desktop/desktop-video-codec-operation-contract.ts', kind: 'file', label: 'browser video codec operation fixture support' },
	{ source: 'desktop/desktop-video-h264-encoder.ts', destination: 'desktop/desktop-video-h264-encoder.ts', kind: 'file', label: 'main H264 encoder browser fixture support' },
]);
