/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import type { RuntimeClipProject } from '../src/common/editor/runtime-clip-projection.ts';

void test('runtime projection retains named document fields while replacing persisted coordinates', () => {
	const project: RuntimeClipProject & Readonly<{ id: string; title: string }> = {
		id: 'projection-contract', title: 'Owned identity', schemaVersion: 2, sampleRate: 48_000,
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 8, durationFrames: 16,
			sourceStartFrame: 4, sourceDurationFrames: 16 }], tracks: [],
	};
	const projected = projectForRuntimeConsumers(project);
	const id: string = projected.id;
	const title: string = projected.title;
	const duration: number = projected.clips[0].durationFrames;
	assert.equal(id, project.id);
	assert.equal(title, project.title);
	assert.equal(duration, 16);
	assert.equal(projected.clips[0].coordinateDomain, 'resolved-samples');
	assert.equal(projectForRuntimeConsumers(projected), projected);
	assert.notEqual(projected, project);
	assert.equal(project.clips?.[0].coordinateDomain, undefined);
});
