/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNumericWorkerRequestBrokerBoundary,
} from '../src/common/editor/numeric-worker-request-broker-boundary.ts';
import { WorkerRequestBroker } from '../src/common/editor/worker-request-broker.ts';

test('numeric worker request state is stringified only inside the broker boundary', async () => {
	const broker = new WorkerRequestBroker();
	const requests = createNumericWorkerRequestBrokerBoundary(broker);
	const pending = requests.request<string>({ id: 41, armOnRequest: false });

	assert.equal(requests.has(41), true);
	assert.deepEqual([...broker.values()].map(({ id }) => id), ['41']);
	assert.equal(requests.resolve(41, 'complete'), true);
	assert.equal(await pending, 'complete');
	assert.equal(broker.size, 0);
	broker.dispose();
});
