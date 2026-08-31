/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import { captureSoundscaperNativeProjectOperation } from '../src/common/editor/ui/soundscaper-native-renderer-project-operation.ts';

test('native project ownership rejects an A-B-A project activation cycle', () => {
	const generation = new EditorProjectGeneration();
	const original = { id: 'project-a', revision: 1 };
	let project = original;
	generation.activate(original.id);
	const controller = projectController();
	const operation = captureSoundscaperNativeProjectOperation(controller);

	generation.invalidate();
	project = { id: 'project-b', revision: 1 };
	generation.activate(project.id);
	generation.invalidate();
	project = original;
	generation.activate(project.id);

	assert.equal(controller.project, original, 'the reference-only fence sees the same project again');
	assert.equal(operation.isCurrent(), false);
	assert.throws(() => operation.assertCurrent(), isProjectOwnershipLoss);
	let mutated = false;
	assert.throws(() => operation.commit(() => { mutated = true; }), isProjectOwnershipLoss);
	assert.equal(mutated, false);

	function projectController() {
		return {
			get project() { return project; },
			getSnapshot: () => ({ selectedTrackId: 'track-1' }),
			captureProjectGeneration: generation.capture.bind(generation),
			assertProjectGeneration: generation.assertCurrent.bind(generation),
		};
	}
});

test('native project commits admit their own same-generation immutable revision', () => {
	const generation = new EditorProjectGeneration();
	let project = { id: 'project-a', revision: 1 };
	generation.activate(project.id);
	const controller = {
		get project() { return project; },
		getSnapshot: () => ({ selectedTrackId: 'track-1' }),
		captureProjectGeneration: generation.capture.bind(generation),
		assertProjectGeneration: generation.assertCurrent.bind(generation),
	};
	const operation = captureSoundscaperNativeProjectOperation(controller);

	const result = operation.commit(() => {
		project = { ...project, revision: 2 };
		return 'committed';
	});

	assert.equal(result, 'committed');
	assert.equal(operation.project, project);
	assert.equal(operation.isCurrent(), true);
});

function isProjectOwnershipLoss(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError' && /project changed/iu.test(error.message);
}
