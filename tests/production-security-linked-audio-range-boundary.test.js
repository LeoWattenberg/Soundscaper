/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('linked-audio range IPC stays pathless and renderer-owner scoped', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const boundary = matrix.boundaries.find(({ id }) => id === 'renderer-to-electron-main');
	const risk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const preload = risk?.currentControls.find(
		({ id }) => id === 'sandboxed-versioned-preload-bridge',
	);
	const revocation = risk?.currentControls.find(
		({ id }) => id === 'authenticated-ipc-sender-and-navigation-fence',
	);

	assert.ok(boundary);
	assert.ok(preload);
	assert.ok(revocation);
	assert.match(
		boundary.data,
		/bounded linked-video and linked-WAV locators.*materialized and kind-specific linked-original ranged-read descriptors/iu,
	);
	for (const path of [
		'tests/desktop-linked-audio-locator-ipc.test.js',
		'tests/desktop-preload-linked-audio-original.test.js',
	]) {
		assert.ok(boundary.evidence.some((item) => item.path === path), path);
		assert.ok(preload.evidence.some((item) => item.path === path), path);
	}
	assert.match(
		preload.summary,
		/linked-original lifecycle methods.*closed kind-specific pathless DTOs.*closed exact kind, locator ID, and revision.*audio and video load requests.*Boolean range and playback modes.*whole-Blob materialization requires false.*ranged access requires true.*non-null exact locator revision.*profile-bound descriptor.*kind-specific MIME\/name contract.*linked-original reads remain owner-bound/iu,
	);
	assert.match(
		revocation.summary,
		/linked-original handlers.*active document owner.*drains its materialized and ranged audio\/video read capabilities.*without deleting persistent locator metadata/iu,
	);
	assert.ok(revocation.evidence.some(
		({ path }) => path === 'tests/desktop-linked-audio-range-capability.test.js',
	));
});
