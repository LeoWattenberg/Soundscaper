/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMixerParameterActions } from '../src/common/editor/controller/composition/internal/mixer-parameter-actions.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const MASTER = { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' } as const;

function fixture() {
	let project = createCurrentAudioEditorProject({ id: 'mixer-gesture' });
	const commits: AudioEditorCommand[] = [];
	const previews: number[] = [];
	const actions = createMixerParameterActions({
		getProject: () => project,
		state: { readOnly: false },
		copy: { projectNotFound: 'No project', projectReadOnly: 'Read only' },
		engine: { previewScheduledParameter: (_address, value) => { previews.push(value); return true; } },
		commit: (command) => {
			commits.push(command);
			project = applyEditorCommand(project, command) as typeof project;
			return project;
		},
	});
	return { actions, commits, previews, project: () => project };
}

test('static gain previews leave the document alone and finish with one edit', () => {
	const f = fixture();
	f.actions.beginParameterGesture(MASTER);
	for (const gain of [0.9, 0.8, 0.7, 0.6]) f.actions.previewParameterGesture(MASTER, gain);
	assert.equal(f.project().master.gain, 1);
	assert.equal(f.commits.length, 0);
	f.actions.commitParameterGesture(MASTER, 0.6);
	assert.equal(f.project().master.gain, 0.6);
	assert.equal(f.commits.length, 1);
});

test('canceling a static gain gesture restores the preview without an edit', () => {
	const f = fixture();
	f.actions.beginParameterGesture(MASTER);
	f.actions.previewParameterGesture(MASTER, 0.5);
	f.actions.cancelParameterGesture(MASTER);
	assert.deepEqual(f.previews, [0.5, 1]);
	assert.equal(f.commits.length, 0);
	assert.equal(f.project().master.gain, 1);
});

test('returning to the original gain finishes without an undo entry', () => {
	const f = fixture();
	f.actions.beginParameterGesture(MASTER);
	f.actions.previewParameterGesture(MASTER, 0.5);
	f.actions.commitParameterGesture(MASTER, 1);
	assert.equal(f.commits.length, 0);
	assert.deepEqual(f.previews, [0.5, 1]);
});
