/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/exact-preview-render-coordinator.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>(complete => { resolve = complete; });
	return { promise, resolve };
}

void test('a seek during an exact render discards the old frame and requests the latest frame once', async () => {
	const oldFrame = deferred<number>();
	let redraws = 0;
	const published: number[] = [];
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; });
	const request = { isCurrent: () => true, publish: (frame: number) => { published.push(frame); }, onError: (error: unknown) => assert.fail(String(error)) };
	const pending = coordinator.run({ ...request, render: () => oldFrame.promise });
	assert.equal(coordinator.deferWhileActive(), true);
	await coordinator.run({ ...request, render: async () => { assert.fail('renders must stay serial'); } });
	await coordinator.run({ ...request, render: async () => { assert.fail('coalesce further redraws'); } });
	oldFrame.resolve(0);
	await pending;
	assert.deepEqual(published, []);
	assert.equal(redraws, 1);
	assert.equal(coordinator.deferWhileActive(), false);
	await coordinator.run({ ...request, render: async () => 6400 });
	assert.deepEqual(published, [6400]);
	assert.equal(redraws, 1);
});

void test('a replaced visual session cannot publish its completion and requests a fresh draw', async () => {
	const frame = deferred<number>();
	let current = true;
	let redraws = 0;
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; });
	const pending = coordinator.run({ render: () => frame.promise, isCurrent: () => current,
		publish: () => assert.fail('old session must not publish'), onError: (error: unknown) => assert.fail(String(error)) });
	current = false;
	frame.resolve(0);
	await pending;
	assert.equal(redraws, 1);
});

void test('render failure releases the slot and permits a subsequent exact frame', async () => {
	const errors: unknown[] = [];
	const failure = new Error('render failed');
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('no redraw is pending'));
	await coordinator.run({ render: () => { throw failure; }, isCurrent: () => true,
		publish: assert.fail, onError: error => { errors.push(error); } });
	assert.deepEqual(errors, [failure]);
	let published = false;
	await coordinator.run({ render: async () => 1, isCurrent: () => true,
		publish: () => { published = true; }, onError: (error: unknown) => assert.fail(String(error)) });
	assert.equal(published, true);
});
