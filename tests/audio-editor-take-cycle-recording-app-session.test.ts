/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTakeCycleRecordingAppSession } from '../src/common/editor/controller/take-cycle-recording-app-session.ts';

test('take cycle start flushes the exact current project before capture I/O', async () => {
	const events: string[] = [];
	const preparationOptions: unknown[] = [];
	const service = createTakeCycleRecordingAppSession({
		cycle: { start: async () => { events.push('capture'); return { stop() {} }; } },
		prepareCurrentProject: async (options) => { preparationOptions.push(options); events.push('flush'); },
		recordingMessage: 'Recording',
		setTransportState: () => undefined,
		setStatus: () => undefined,
	});
	await service.begin({ generation: 1, projectId: 'project', assertCurrent: () => { events.push('assert'); } });
	assert.deepEqual(events, ['assert', 'flush', 'assert', 'capture']);
	assert.deepEqual(preparationOptions, [{ forceCurrentSnapshot: true }]);
});

test('take cycle start does not acquire capture when project preparation fails or becomes stale', async () => {
	let starts = 0;
	const failure = createTakeCycleRecordingAppSession({
		cycle: { start: async () => { starts += 1; return { stop() {} }; } },
		prepareCurrentProject: async () => { throw new Error('save failed'); },
		recordingMessage: 'Recording', setTransportState: () => undefined, setStatus: () => undefined,
	});
	await assert.rejects(failure.begin({ generation: 1, projectId: 'project', assertCurrent() {} }), /save failed/u);

	let assertions = 0;
	const stale = createTakeCycleRecordingAppSession({
		cycle: { start: async () => { starts += 1; return { stop() {} }; } },
		prepareCurrentProject: async () => undefined,
		recordingMessage: 'Recording', setTransportState: () => undefined, setStatus: () => undefined,
	});
	await assert.rejects(stale.begin({
		generation: 1, projectId: 'project',
		assertCurrent() { assertions += 1; if (assertions === 2) throw new DOMException('stale', 'AbortError'); },
	}), /stale/u);
	assert.equal(starts, 0);
});
