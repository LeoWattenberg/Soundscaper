/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('product bootstraps observe runtime disposal failures on every detached path', async () => {
	for (const [product, path] of [
		['Soundscaper', '../src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx'],
		['Framescaper', '../src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx'],
	] as const) {
		const source = await readFile(new URL(path, import.meta.url), 'utf8');
		assert.match(source,
			/void candidate\.dispose\(\)\.catch\(reportRuntimeDisposalFailure\);/u,
			`${product} must observe disposal after runtime creation loses its owner`,
		);
		assert.match(source,
			/void owned(?:Runtime)?\.dispose\(\)\.catch\(reportRuntimeDisposalFailure\);/u,
			`${product} must observe disposal during effect cleanup`,
		);
		assert.match(source,
			/function reportRuntimeDisposalFailure\(error: unknown\): void/u,
			`${product} must route observed disposal failures`,
		);
	}
});
