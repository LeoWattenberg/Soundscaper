/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	beginExportTask,
	handleExportFailure,
} from '../src/common/editor/controller/export/internal/export-task-lifecycle.ts';
import type { EditorExportState } from '../src/common/editor/controller/export/export-state.ts';

test('one export task owns generation, project and lifetime currentness', () => {
	const events: string[] = [];
	const controller = new AbortController();
	const task = {
		name: 'export', generation: 7, scope: 'project', signal: controller.signal,
		abort: (reason?: unknown) => controller.abort(reason),
		assertCurrent: () => { events.push('task-current'); },
		finish: () => { events.push('task-finish'); },
	};
	const state: EditorExportState = {
		disposed: false, exportAbort: null, exportGeneration: 3, exportOutput: null,
		mobile: false, outputCleanup: null, outputUrl: null,
	};
	const abortFailure = new Error('stale export');
	const operation = beginExportTask({
		state,
		lifetime: {
			startTask: () => task,
			cancelTask: () => { events.push('cancel'); },
		},
		projectGeneration: {
			capture: (projectId: string) => ({ generation: 2, projectId }),
			assertCurrent: () => { events.push('project-current'); },
		},
		projectId: 'project-1',
		throwIfAborted: () => { events.push('signal-current'); },
		abortError: () => abortFailure,
		toggleExport: (active: boolean) => { events.push(`toggle:${String(active)}`); },
	});

	assert.equal(state.exportGeneration, 4);
	assert.equal(state.exportAbort, operation.abort);
	operation.assertCurrent();
	assert.deepEqual(events, ['toggle:true', 'signal-current', 'task-current', 'project-current']);
	operation.abort.abort();
	assert.equal(events.at(-1), 'cancel');
	operation.finish({ finish: () => { events.push('progress-finish'); } });
	assert.equal(state.exportAbort, null);
	assert.deepEqual(events.slice(-3), ['toggle:false', 'progress-finish', 'task-finish']);

	state.exportGeneration += 1;
	assert.throws(() => operation.assertCurrent(), (error) => error === abortFailure);
});

test('a superseded export task cannot clear the replacement publication state', () => {
	const events: string[] = [];
	const state: EditorExportState = {
		disposed: false, exportAbort: null, exportGeneration: 0, exportOutput: null,
		mobile: false, outputCleanup: null, outputUrl: null,
	};
	const operation = beginExportTask({
		state,
		lifetime: {
			startTask: () => ({ name: 'export', generation: 1, scope: 'project',
				signal: new AbortController().signal, abort() {}, assertCurrent() {},
				finish: () => { events.push('finish'); } }),
			cancelTask() {},
		},
		projectGeneration: {
			capture: (projectId: string) => ({ generation: 1, projectId }), assertCurrent() {},
		},
		projectId: 'project-1', throwIfAborted() {}, abortError: () => new Error('stale'),
		toggleExport: (active: boolean) => { events.push(`toggle:${String(active)}`); },
	});
	const replacement = { signal: new AbortController().signal, abort() {} };
	state.exportGeneration += 1;
	state.exportAbort = replacement;
	operation.finish();
	assert.equal(state.exportAbort, replacement);
	assert.deepEqual(events, ['toggle:true', 'finish']);
});

test('export failure cleanup preserves the primary error and attempts every cleanup', async () => {
	const primary = new Error('render failed');
	const destinationFailure = new Error('destination cleanup failed');
	const events: string[] = [];
	let reported: unknown = null;
	await handleExportFailure({
		error: primary,
		destination: { abort: async (reason: unknown) => {
			assert.equal(reason, primary);
			events.push('destination');
			throw destinationFailure;
		} },
		cleanup: async () => { events.push('cleanup'); throw new Error('best effort'); },
		cleanupFailureMessage: 'Export and cleanup failed.',
		handleError: (error: unknown) => { reported = error; },
	});
	assert.deepEqual(events, ['destination', 'cleanup']);
	assert.ok(reported instanceof AggregateError);
	assert.deepEqual(reported.errors, [primary, destinationFailure]);
});

test('abort failures are cleaned up without user-facing reporting', async () => {
	const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
	let reported = false;
	await handleExportFailure({
		error,
		destination: null,
		cleanup: null,
		cleanupFailureMessage: 'unused',
		handleError: () => { reported = true; },
	});
	assert.equal(reported, false);
});
