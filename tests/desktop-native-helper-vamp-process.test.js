/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeHelperWorker } from '../desktop/native-helper-process.js';

const JOB_ID = 'a'.repeat(40);

test('the scanner helper preserves the closed isolated Vamp child-crash code', async () => {
	const posted = [];
	const worker = createNativeHelperWorker({
		role: 'plugin-scanner', post: (message) => posted.push(message),
		runScanJob: () => ({
			completion: Promise.reject(Object.assign(new Error('isolated child exited'), {
				code: 'vamp-peer-crash',
			})),
			cancel: async () => undefined,
		}),
		heartbeatIntervalMs: 1_000_000,
	});
	worker.handleMessage({
		contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'plugin-scan', jobContractVersion: 1,
		grant: { rootPath: '/plug-ins', format: 'vamp', identity: { dev: 1, ino: 2 } },
		resourcePolicy: {
			maximumInputBytes: 1_024, maximumJobDurationMs: 30_000,
			maximumRssBytes: 1_024 ** 3,
		},
	});
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(posted.at(-1).type, 'error');
	assert.equal(posted.at(-1).error.code, 'vamp-peer-crash');
	worker.dispose();
});
