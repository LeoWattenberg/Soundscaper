/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('product bootstraps observe runtime disposal failures on every detached path', async () => {
	const lifecycle = await readFile(new URL(
		'../src/common/editor/ui/audio-editor-web-bootstrap.tsx', import.meta.url,
	), 'utf8');
	assert.match(lifecycle,
		/void candidate\.dispose\(\)\.catch\(configuration\.reportRuntimeDisposalFailure\);/u,
		'the shared lifecycle must observe disposal after runtime creation loses its owner',
	);
	assert.match(lifecycle,
		/if \(owned\) void owned\.dispose\(\)\.catch\(configuration\.reportRuntimeDisposalFailure\);/u,
		'the shared lifecycle must observe disposal during effect cleanup',
	);
	for (const [product, path] of [
		['Soundscaper', '../src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx'],
		['Framescaper', '../src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx'],
	] as const) {
		const source = await readFile(new URL(path, import.meta.url), 'utf8');
		assert.match(source,
			/function reportRuntimeDisposalFailure\(error: unknown\): void/u,
			`${product} must route observed disposal failures`,
		);
		assert.match(source, /reportRuntimeDisposalFailure,/u,
			`${product} must inject its disposal-failure reporter into the shared lifecycle`);
	}
});
