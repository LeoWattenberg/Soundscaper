/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectFoundationCommand } from '../src/soundscaper/editor-project-command-foundation.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

test('inherited commands clone their mutation draft without cloning the untouched input authority', () => {
	for (const command of [
		{ type: 'project/rename', title: 'Renamed' },
		{ type: 'selection/set', startFrame: 10, endFrame: 20 },
		{ type: 'master/update', changes: { gain: 0.5 } },
	] satisfies AudioEditorCommand[]) {
		const project = createSoundscaperProject();
		const prior = structuredClone(project);
		const clone = globalThis.structuredClone;
		let inputClones = 0;
		globalThis.structuredClone = <Value>(value: Value, options?: StructuredSerializeOptions): Value => {
			if (value === project) inputClones++;
			return clone(value, options);
		};
		try {
			const result = applySoundscaperProjectFoundationCommand(project, command, { now: '2026-10-06T00:00:00Z' });
			assert.equal(inputClones, 0);
			assert.deepEqual(project, prior);
			assert.notEqual(result, project);
			assert.notEqual(result.master, project.master);
			assert.notEqual(result.metadata, project.metadata);
			assert.equal(result.revision, project.revision + 1);
		} finally { globalThis.structuredClone = clone; }
	}
});

test('failed inherited commands leave the original nested authority unchanged', () => {
	const project = createSoundscaperProject();
	const prior = structuredClone(project);
	assert.throws(() => applySoundscaperProjectFoundationCommand(project,
		{ type: 'selection/set', startFrame: 0, endFrame: 10, trackIds: ['missing'] }));
	assert.deepEqual(project, prior);
});

test('empty nested batches preserve the untouched input even when it is frozen', () => {
	const project = Object.freeze(createSoundscaperProject());
	const features = project.featureRequirements;
	const result = applySoundscaperProjectFoundationCommand(project,
		{ type: 'batch', commands: [{ type: 'batch', commands: [] }] });
	assert.equal(result, project);
	assert.equal(project.featureRequirements, features);
});
