/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EDITOR_DOMAIN_CHUNK_TEST,
	EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
} from '../scripts/lib/build-chunk-tests.mjs';

test('large audio codec execution remains behind menu-started imports and exports', () => {
	for (const name of [
		'browser-audio-encode-stream-client',
		'browser-audio-streamed-encode',
		'browser-reviewed-streamed-audio-decoders',
		'browser-streamed-audio-import',
		'browser-streamed-wavpack-import',
		'browser-webcodecs-aac-stream',
		'desktop-audio-range-blob',
		'desktop-audio-stream-encoder',
		'desktop-audio-stream-request',
		'desktop-mpeg-layer-ii-import',
		'aac-source-geometry',
		'browser-streamed-audio-output-validation',
		'mp3-gapless-import',
		'ogg-gapless-import',
		'controller/import/internal/streamed-audio-import-service',
	]) {
		const moduleId = `/workspace/src/common/editor/${name}.ts`;
		assert.equal(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(moduleId), true, name);
		assert.equal(EDITOR_DOMAIN_CHUNK_TEST.test(moduleId), false, name);
	}
});


test('reviewed decoder manifests share their lazy execution owner', () => {
	for (const codec of ['flac', 'mpg123', 'opus', 'vorbis']) {
		assert.equal(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(`/workspace/src/common/editor/${codec}/source-manifest.json`), true);
	}
});


test('stream validation parsers share their lazy execution owner', () => {
	for (const name of ['mpeg-audio', 'opus', 'wavpack']) {
		assert.equal(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(`/workspace/desktop/bundled-${name}-stream.ts`), true);
	}
});
