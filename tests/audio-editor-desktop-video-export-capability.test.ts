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
		assert.match(reason, /configuring it does not enable video export in this build/iu);
		assert.doesNotMatch(reason, /then reopen Export/iu);
	}
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
