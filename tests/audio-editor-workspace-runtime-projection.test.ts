/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkspaceRuntimeProjection } from '../src/common/editor/ui/workspace/workspace-runtime-projection.ts';

// The workspace derives the runtime projection above every surface boundary,
// so this is where a document the projection refuses must become a value
// rather than a throw.

interface Project { readonly id: string; readonly projected?: boolean }

test('a document that projects hands its surfaces the projection and its length', () => {
	const project: Project = { id: 'p' };
	const resolved = resolveWorkspaceRuntimeProjection(project, {
		projectForRuntimeConsumers: (candidate) => ({ ...candidate, projected: true }),
		projectDurationFrames: (candidate) => (candidate.projected ? 480 : -1),
	});
	assert.deepEqual(resolved, { runtimeProject: { id: 'p', projected: true }, durationFrames: 480, failure: null });
});

test('a document the projection refuses is reported, not thrown, and measures as empty', () => {
	const refusal = new TypeError('A musical label requires project.tempoMap.');
	const resolved = resolveWorkspaceRuntimeProjection({ id: 'p' } as Project, {
		projectForRuntimeConsumers: () => { throw refusal; },
		projectDurationFrames: () => { throw new Error('never measured'); },
	});
	assert.equal(resolved.runtimeProject, null);
	assert.equal(resolved.durationFrames, 0);
	assert.equal(resolved.failure, refusal);
});

test('a length the projection cannot state is the same failure, and a thrown value is still an Error', () => {
	const resolved = resolveWorkspaceRuntimeProjection({ id: 'p' } as Project, {
		projectForRuntimeConsumers: null,
		projectDurationFrames: () => { throw 'clips must be an array.'; },
	});
	assert.equal(resolved.runtimeProject, null);
	assert.equal(resolved.durationFrames, 0);
	assert.ok(resolved.failure instanceof Error);
	assert.equal(resolved.failure?.message, 'clips must be an array.');
});

test('no document means no projection and no failure', () => {
	assert.deepEqual(
		resolveWorkspaceRuntimeProjection(null, { projectDurationFrames: () => 1 }),
		{ runtimeProject: null, durationFrames: 0, failure: null },
	);
});
