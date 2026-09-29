/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('parallel DSP and session preparation stay lazy while preferences and the playback hook stay eager', () => {
	for (const path of [
		'engine/parallel-stack-plan.ts', 'engine/parallel-stack-effects.ts', 'engine/parallel-stack-dsp.ts',
		'engine/parallel-stack-audio-graph.ts', 'engine/parallel-stack-protocol.ts',
		'controller/transport/internal/parallel-stack-session.ts',
	]) {
		const source = `src/common/editor/${path}`;
		assert.equal(chunkGroupForModulePath(source), 'editor-parallel-stacks');
		assert.equal(chunkGroupForModulePath(source.replaceAll('/', '\\')), 'editor-parallel-stacks');
	}
	for (const name of ['preferences', 'playback']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/engine/parallel-stack-${name}.ts`), 'editor-engine');
	}
	assert.equal(chunkGroups.find(({ name }) => name === 'editor-parallel-stacks')?.includeDependenciesRecursively, false);
});
