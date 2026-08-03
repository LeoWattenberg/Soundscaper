/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('linked-audio range IPC stays pathless and renderer-owner scoped', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const boundary = matrix.boundaries.find(({ id }) => id === 'renderer-to-electron-main');
	const filesystemBoundary = matrix.boundaries.find(
		({ id }) => id === 'electron-main-to-filesystem',
	);
	const risk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const readRisk = matrix.risks.find(({ id }) => id === 'desktop-read-path-capabilities');
	const archiveRisk = matrix.risks.find(({ id }) => id === 'scape-archive-structure-integrity');
	const libraryRisk = matrix.risks.find(
		({ id }) => id === 'shared-desktop-project-library-integrity',
	);
	const preload = risk?.currentControls.find(
		({ id }) => id === 'sandboxed-versioned-preload-bridge',
	);
	const revocation = risk?.currentControls.find(
		({ id }) => id === 'authenticated-ipc-sender-and-navigation-fence',
	);
	const linkedRange = readRisk?.currentControls.find(
		({ id }) => id === 'owner-scoped-linked-audio-range-lifecycle',
	);
	const portability = archiveRisk?.currentControls.find(
		({ id }) => id === 'linked-pcm-canonical-portability',
	);
	const handoff = libraryRisk?.currentControls.find(
		({ id }) => id === 'point-in-time-linked-pcm-managed-handoff',
	);

	assert.ok(boundary);
	assert.ok(filesystemBoundary);
	assert.ok(preload);
	assert.ok(revocation);
	assert.ok(linkedRange);
	assert.ok(portability);
	assert.ok(handoff);
	assert.match(
		boundary.data,
		/bounded linked-video and maintained linked PCM container locators.*materialized and kind-specific linked-original ranged-read descriptors/iu,
	);
	assert.match(
		filesystemBoundary.data,
		/main-private linked-video and maintained linked PCM container paths.*point-in-time stat identities/iu,
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
	for (const control of [linkedRange, portability, handoff]) {
		assert.match(
			control.summary,
			/exact `?\.aif`? or `?\.aiff`?.*`?audio\/aiff`?.*FORM\/AIFF.*COMM.*SSND.*signed big-endian.*8.*16.*24.*32.*FORM\/AIFC.*FVER v1.*0xA2805140.*44-byte\s+COMM.*32-bit `?fl32`?.*Pascal compression name `?32-bit\s+floating point`?.*first-party label.*maintained fixture.*not authenticated provenance.*producer-neutral.*any producer.*exact tuple.*broader.*compressed.*other AIFC profiles.*reject.*broader third-party interoperability.*producer provenance.*unqualified.*`?\.aifc`?/iu,
		);
		for (const exclusion of [
			/\bnot\b/iu,
			/packaged/iu,
			/operating-system/iu,
			/metadata preservation/iu,
			/content-frozen/iu,
			/reference-scale/iu,
		]) assert.match(control.summary, exclusion);
	}
	for (const path of [
		'src/common/editor/aiff-pcm-chunk-reader.ts',
		'src/common/editor/controller/linked-audio-import-admission.ts',
		'tests/audio-editor-aiff-pcm-chunk-reader.test.ts',
	]) {
		assert.ok(portability.evidence.some((item) => item.path === path), path);
		assert.ok(handoff.evidence.some((item) => item.path === path), path);
	}
});
