/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveMediaImportVideoRoute } from '../src/common/editor/controller/import/internal/media-import-video-route.ts';
import { isAudioEditorVideoFile } from '../src/common/editor/video-media.js';
import { deterministicAvMedia } from './browser/fixtures/deterministic-av-media.js';

const recording = Uint8Array.from(Buffer.from(readFileSync(
	new URL('./fixtures/chromium-audio-only.webm.base64', import.meta.url), 'utf8',
), 'base64'));

test('ordinary audio-only WebM is routed to audio independently of the picker container MIME', async () => {
	for (const type of ['audio/webm', 'video/webm', 'application/octet-stream']) {
		const file = new File([recording], 'voice-memo.webm', { type });
		assert.equal(isAudioEditorVideoFile(file), true, 'the shared suffix is only a container candidate');
		assert.equal(await resolveMediaImportVideoRoute(file, isAudioEditorVideoFile(file)), false);
	}
});

test('a normal audiovisual WebM retains the video route and cancellation fences', async () => {
	const media = deterministicAvMedia[0];
	assert.ok(media);
	const file = new File([Uint8Array.from(media.file.buffer)], media.file.name, { type: media.file.mimeType });
	let currentChecks = 0;
	assert.equal(await resolveMediaImportVideoRoute(file, true, undefined, () => { currentChecks += 1; }), true);
	assert.ok(currentChecks >= 2);
	const aborted = new AbortController();
	aborted.abort(new DOMException('The import was cancelled.', 'AbortError'));
	await assert.rejects(resolveMediaImportVideoRoute(file, true, aborted.signal), { name: 'AbortError' });
});
