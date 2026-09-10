/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createTakeCompService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-service.ts';
import type { TakeCompCompositionDependencies } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-composition.ts';
import type { TakeCompPreviewDependencies } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-preview-service.ts';
import type { TakeCompFlattenServiceDependencies } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-flatten-service.ts';

test('take-comp owners accept the actual Framescaper document without changing its schema', () => {
	const project = createFramescaperProject();
	const provider = { getProject: () => project } satisfies
		Pick<TakeCompCompositionDependencies, 'getProject'> &
		Pick<TakeCompPreviewDependencies, 'getProject'> &
		Pick<TakeCompFlattenServiceDependencies, 'getProject'>;
	let commits = 0;
	const service = createTakeCompService({
		...provider,
		lifetime: { assertActive() {} },
		editingBlocked: () => false,
		commit: () => { commits += 1; },
	});
	assert.throws(() => service.removeGroup('missing'), /Unknown take group/);
	assert.equal(provider.getProject(), project);
	assert.equal(project.schemaVersion, 1);
	assert.equal(commits, 0);
});

test('take-comp admission retains future-schema and malformed graph refusals', () => {
	const project = createFramescaperProject();
	for (const [candidate, message] of [
		[{ ...project, schemaVersion: 999 }, /current project authority/],
		[{ ...project, takeGroups: null }, /takeGroups/],
	] as const) {
		const service = createTakeCompService({
			getProject: () => candidate,
			lifetime: { assertActive() {} },
			editingBlocked: () => false,
			commit: () => assert.fail('Invalid take graphs cannot be committed.'),
		});
		assert.throws(() => service.removeGroup('missing'), message);
	}
});
