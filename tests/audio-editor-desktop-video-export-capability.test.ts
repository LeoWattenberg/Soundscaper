/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertDesktopVideoExportAvailable,
	desktopVideoExportCapabilities,
	desktopVideoExportFormatAvailable,
	desktopVideoExportFormatReason,
} from '../src/common/editor/desktop-video-export-capability.ts';

const EXPLICIT_CAPABILITIES = Object.freeze({
	schemaVersion: 1,
	formats: Object.freeze({
		mp4: Object.freeze({ available: true, provider: 'operating-system' }),
		webm: Object.freeze({ available: true, provider: 'external-ffmpeg' }),
	}),
});

test('desktop video export admits only explicit per-format execution capabilities', () => {
	const capabilities = desktopVideoExportCapabilities(EXPLICIT_CAPABILITIES);

	assert.equal(desktopVideoExportFormatAvailable('mp4', capabilities), true);
	assert.equal(desktopVideoExportFormatAvailable('webm', capabilities), true);
	assert.equal(desktopVideoExportFormatReason('mp4', capabilities), null);
	assert.equal(capabilities.formats.mp4.provider, 'operating-system');
	assert.equal(capabilities.formats.webm.provider, 'external-ffmpeg');
});

test('desktop video export fails closed for absent, malformed, and generic FFmpeg status', () => {
	for (const value of [
		null,
		{ status: 'ready', executable: '/usr/local/bin/ffmpeg' },
		{ schemaVersion: 1, formats: { mp4: { available: true }, webm: { available: true } } },
		{ schemaVersion: 2, formats: EXPLICIT_CAPABILITIES.formats },
	]) {
		const capabilities = desktopVideoExportCapabilities(value);
		assert.equal(desktopVideoExportFormatAvailable('mp4', capabilities), false);
		assert.equal(desktopVideoExportFormatAvailable('webm', capabilities), false);
		const reason = desktopVideoExportFormatReason('mp4', capabilities) ?? '';
		assert.match(reason, /Edit > Preferences > General/u);
		assert.match(reason, /execution-qualified external FFmpeg/iu);
		assert.doesNotMatch(reason, /then reopen Export/iu);
		assert.doesNotMatch(reason, /does not enable video export/iu);
	}
});

test('desktop video export preserves bounded execution-qualification failure reasons', () => {
	const reason = 'The configured FFmpeg failed exact H264/AAC MP4 execution qualification. Manage or rescan it in Edit > Preferences > General.';
	const capabilities = desktopVideoExportCapabilities({
		schemaVersion: 1,
		formats: {
			mp4: { available: false, provider: null, reason },
			webm: EXPLICIT_CAPABILITIES.formats.webm,
		},
	});
	assert.equal(desktopVideoExportFormatReason('mp4', capabilities), reason);
	assert.match(capabilities.notice ?? '', /MP4.*unavailable/iu);
	assert.doesNotMatch(capabilities.notice ?? '', /does not enable video export/iu);
});

test('desktop video export guard bypasses browsers and refuses desktop work before execution', async () => {
	await assert.doesNotReject(assertDesktopVideoExportAvailable({ isDesktop: false }, 'mp4'));
	await assert.rejects(
		assertDesktopVideoExportAvailable({
			isDesktop: true,
			getDesktopVideoExportCapabilities: () => ({ status: 'ready' }),
		}, 'webm'),
		/Edit > Preferences > General/u,
	);
	await assert.doesNotReject(assertDesktopVideoExportAvailable({
		isDesktop: true,
		getDesktopVideoExportCapabilities: () => EXPLICIT_CAPABILITIES,
	}, 'webm'));
});
