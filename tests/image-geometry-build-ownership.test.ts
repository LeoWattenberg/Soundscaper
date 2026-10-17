/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const DIRECTORY = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
const MODULES = ['video-image-geometry-v1.ts', 'video-image-geometry-ffmpeg-v1.ts', 'imaging/image-geometry-v1.ts',
	'imaging/image-geometry-plan-v1.ts', 'imaging/pixel-frame-geometry-v1.ts'];

test('shared geometry contracts have exact imaging ownership on both native path separators', () => {
	for (const module of MODULES) {
		const path = DIRECTORY + module;
		for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), 'editor-imaging', candidate);
		if (!module.startsWith('imaging/')) assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-imaging');
	}
	assert.notEqual(chunkGroupForModulePath(DIRECTORY + 'video-image-geometry-v2.ts'), 'editor-imaging');
});

test('actual Lightscaper effect admission reaches geometry through only imaging and inert foundation modules', () => {
	const pending = [DIRECTORY + 'video-effects.js'], seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!;
		if (seen.has(path)) continue; seen.add(path);
		assert.ok(['editor-imaging', 'editor-neutral-foundations', 'editor-closed-domain-values'].some(owner => owner === chunkGroupForModulePath(path)), path);
		const source = transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code;
		for (const dependency of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(path, dependency); assert.ok(target, dependency); pending.push(target);
		}
	}
	assert.ok(seen.has(DIRECTORY + 'video-image-geometry-v1.ts'));
	assert.ok(seen.has(DIRECTORY + 'imaging/image-geometry-plan-v1.ts'));
	assert.equal(seen.has(DIRECTORY + 'ui/video-preview-image-geometry-v1.ts'), false);
	assert.equal(seen.has(DIRECTORY + 'video-image-geometry-ffmpeg-v1.ts'), false);
});
