/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSerialProjectOperationQueue } from '../src/common/editor/controller/shared/serial-project-operation-queue.ts';
import { captureSoundscaperNativeProjectOperation } from '../src/common/editor/ui/soundscaper-native-renderer-project-operation.ts';
import { deferred } from './helpers/async-test-control.ts';

test('overlapping native state captures serialize and admit their own immutable commits', async () => {
	const fixture = projectFixture();
	const gate = deferred<void>();
	const started = deferred<void>();
	const calls: number[] = [];
	const persist = fixture.queue.wrap(async (operation, revision: number) => {
		calls.push(revision);
		if (revision === 2) { started.resolve(); await gate.promise; }
		operation.commit(() => { fixture.controller.project = { ...fixture.controller.project, revision }; });
		return revision;
	});
	const automatic = persist(2);
	await started.promise;
	const explicit = persist(3);
	assert.deepEqual(calls, [2]);
	gate.resolve();
	assert.deepEqual(await Promise.all([automatic, explicit]), [2, 3]);
	assert.deepEqual(calls, [2, 3]);
	assert.equal(fixture.controller.project.revision, 3);
});

for (const change of ['edit', 'switch', 'reactivate'] as const) {
	test(`queued native state work retains its exact project fence after an unrelated ${change}`, async () => {
		const fixture = projectFixture();
		const gate = deferred<void>();
		const started = deferred<void>();
		let commits = 0;
		const persist = fixture.queue.wrap(async (operation, wait: boolean) => {
			if (wait) { started.resolve(); await gate.promise; }
			operation.commit(() => { commits += 1; });
		});
		const first = persist(true);
		await started.promise;
		const second = persist(false);
		const original = fixture.controller.project;
		if (change === 'edit') fixture.controller.project = { ...original, revision: 2 };
		else {
			fixture.generation.invalidate();
			fixture.controller.project = { id: 'project-b', revision: 1 };
			fixture.generation.activate('project-b');
			if (change === 'reactivate') {
				fixture.generation.invalidate();
				fixture.controller.project = original;
				fixture.generation.activate(original.id);
			}
		}
		const firstRefusal = assert.rejects(first, { name: 'AbortError' });
		const secondRefusal = assert.rejects(second, { name: 'AbortError' });
		gate.resolve();
		await Promise.all([firstRefusal, secondRefusal]);
		assert.equal(commits, 0);
		await fixture.queue.wrap(async (operation) => {
			operation.commit(() => { commits += 1; });
		})();
		assert.equal(commits, 1, 'fresh work can capture the current project after stale work settles');
	});
}

test('a refused native state capture does not poison later queued work', async () => {
	const fixture = projectFixture();
	const failure = new Error('Host refused state');
	const failed = fixture.queue.wrap(async () => { throw failure; })();
	const next = fixture.queue.wrap(async (operation) => operation.commit(() => 'persisted'))();
	await assert.rejects(failed, failure);
	assert.equal(await next, 'persisted');
});

function projectFixture() {
	const generation = new EditorProjectGeneration();
	const controller = {
		project: { id: 'project-a', revision: 1 },
		getSnapshot: () => ({ selectedTrackId: 'track-a' }),
		captureProjectGeneration: generation.capture.bind(generation),
		assertProjectGeneration: generation.assertCurrent.bind(generation),
	};
	generation.activate(controller.project.id);
	const queue = createSerialProjectOperationQueue(() => captureSoundscaperNativeProjectOperation(controller));
	return { controller, generation, queue };
}
