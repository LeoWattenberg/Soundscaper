/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginScanProgressSupervisor } from '../desktop/plugin-scan-progress.ts';
import type { HelperJobRequest } from '../desktop/helper-supervisor.ts';

test('scan progress stays pathless, forwards callbacks, and clears after completion or failure', async () => {
	let job: HelperJobRequest<'plugin-scan'> | null = null;
	let finish: (value: unknown) => void = () => undefined;
	let fail: (error: Error) => void = () => undefined;
	const progress = createPluginScanProgressSupervisor({
		runJob: (request) => {
			job = request;
			return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
		},
		snapshot: () => ({ state: 'idle', quarantined: false }),
		clearQuarantine: () => undefined, dispose: () => undefined,
	});
	const observed: (number | null)[] = [];
	const request: HelperJobRequest<'plugin-scan'> = {
		kind: 'plugin-scan', grant: { format: 'vst3', rootPath: '/private/plugins', identity: { dev: 1, ino: 2 } },
		onProgress: (value) => observed.push(value),
	};
	const first = progress.supervisor.runJob(request);
	assert.deepEqual(progress.getSnapshot(), { format: 'vst3', progress: null });
	(job as HelperJobRequest<'plugin-scan'> | null)?.onProgress?.(0.5);
	assert.deepEqual(progress.getSnapshot(), { format: 'vst3', progress: 0.5 });
	assert.deepEqual(observed, [0.5]);
	finish({ entries: [] });
	await first;
	assert.equal(progress.getSnapshot(), null);
	const second = progress.supervisor.runJob(request);
	fail(new Error('Cancelled'));
	await assert.rejects(second, /Cancelled/u);
	assert.equal(progress.getSnapshot(), null);
});

test('a refused concurrent job cannot erase the active scanner progress', async () => {
	let calls = 0;
	let finish: () => void = () => undefined;
	const progress = createPluginScanProgressSupervisor({
		runJob: (request) => {
			if (++calls > 1) return Promise.reject(new Error('capacity'));
			request.onProgress?.(0.5);
			return new Promise<void>((resolve) => { finish = resolve; });
		},
		snapshot: () => ({ state: 'busy', quarantined: false }),
		clearQuarantine: () => undefined, dispose: () => undefined,
	});
	const request: HelperJobRequest<'plugin-scan'> = {
		kind: 'plugin-scan', grant: { format: 'vst3', rootPath: '/plugins', identity: { dev: 1, ino: 2 } },
	};
	const running = progress.supervisor.runJob(request);
	await assert.rejects(progress.supervisor.runJob({ ...request, grant: { ...request.grant, format: 'vamp' } }), /capacity/u);
	assert.deepEqual(progress.getSnapshot(), { format: 'vst3', progress: 0.5 });
	finish();
	await running;
	assert.equal(progress.getSnapshot(), null);
});
