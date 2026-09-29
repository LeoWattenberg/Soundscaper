/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitHelperDataPlaneTransfers,
	helperJobTransferredPortCount,
	type HelperDataPlaneTransferPort,
} from '../desktop/helper-data-plane-transfer.ts';

const PLAN = 'ab'.repeat(20);
const SOURCE = 'cd'.repeat(20);

function port(): HelperDataPlaneTransferPort {
	return { postMessage() {}, close() {} };
}

function grant() {
	return {
		plan: { streamId: PLAN },
		sources: [{ type: 'stream', binding: { streamId: SOURCE } }],
	};
}

test('native transfer admission refuses reusing one physical port for two streams', () => {
	const shared = port();
	assert.throws(
		() => admitHelperDataPlaneTransfers('media-encode', grant() as never, [
			{ streamId: PLAN, port: shared },
			{ streamId: SOURCE, port: shared },
		]),
		/port|reus|once/iu,
	);
});

test('native transfer admission returns ports in grant order independent of input order', () => {
	const planPort = port();
	const sourcePort = port();
	assert.deepEqual(admitHelperDataPlaneTransfers('media-encode', grant() as never, [
		{ streamId: SOURCE, port: sourcePort },
		{ streamId: PLAN, port: planPort },
	]), [planPort, sourcePort]);
	assert.equal(helperJobTransferredPortCount('media-encode', grant() as never), 2);
});

test('native transfer admission rejects accessor fields in a transfer descriptor', () => {
	const candidate = { streamId: PLAN, get port() { return port(); } };
	assert.throws(() => admitHelperDataPlaneTransfers('audio-device', {
		persistentPort: { streamId: PLAN },
	} as never, [candidate]), /data field/iu);
});

test('control-only helper jobs refuse even an empty transfer list', () => {
	assert.deepEqual(admitHelperDataPlaneTransfers('plugin-host', {} as never, undefined), []);
	assert.throws(() => admitHelperDataPlaneTransfers('plugin-host', {} as never, []), /control-only/iu);
});
