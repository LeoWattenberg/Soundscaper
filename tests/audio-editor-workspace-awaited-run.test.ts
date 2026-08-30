/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runAwaitedAudioEditorOperation } from '../src/common/editor/ui/workspace/audio-editor-workspace-runner.ts';

test('an awaited workspace operation rejects a synchronous failure reported by the shared runner', async () => {
	const expected = new Error('invalid finishing document');
	const reported: unknown[] = [];
	const run = (operation: () => unknown): unknown => {
		try {
			const result = operation();
			if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
				void Promise.resolve(result).catch((error: unknown) => { reported.push(error); });
			}
			return result;
		} catch (error) {
			reported.push(error);
			return undefined;
		}
	};

	await assert.rejects(
		runAwaitedAudioEditorOperation(run, () => { throw expected; }),
		(error: unknown) => error === expected,
	);
	assert.deepEqual(reported, [expected]);
});

test('an awaited workspace operation preserves synchronous and asynchronous results', async () => {
	const run = (operation: () => unknown): unknown => operation();
	assert.equal(await runAwaitedAudioEditorOperation(run, () => 42), 42);
	assert.equal(await runAwaitedAudioEditorOperation(run, async () => 84), 84);
});
