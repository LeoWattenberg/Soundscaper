/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createRound7ExternalDisplayNativeFixture } from './helpers/round7-external-display-native-fixture.ts';

function frame(sequence: number) {
	const rgba = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
	return { sequence, evaluationFingerprint: 'ab'.repeat(32), width: 2, height: 1,
		dynamicRange: 'sdr', rgbaSha256: createHash('sha256').update(rgba).digest('hex'), rgba };
}

for (const displayId of ['display-2', 'display-3']) test(`retired MessagePort frame cannot enter a restarted ${displayId} session`, async () => {
	const fixture = createRound7ExternalDisplayNativeFixture();
	try {
		await fixture.bridge.setExternalDisplay({ displayId: 'display-2' });
		await fixture.bridge.presentExternalDisplay(frame(0));
		assert.deepEqual(fixture.frames.map(({ windowId, sequence }) => ({ windowId, sequence })), [{ windowId: 1, sequence: 0 }]);
		fixture.arm();
		const outcome = fixture.bridge.presentExternalDisplay(frame(1)).then(() => 'result', () => 'failure');
		for (let attempts = 0; attempts < 100 && fixture.heldSequence() === null; attempts += 1) await setImmediate();
		assert.equal(fixture.heldSequence(), 1, 'actual native receiver has acknowledged the frame bytes');
		await fixture.bridge.setExternalDisplay({ displayId: null });
		await fixture.bridge.setExternalDisplay({ displayId });
		fixture.release();
		assert.equal(await outcome, 'failure', 'the retired transfer must be refused before presentation');
		assert.equal(fixture.frames.length, 1, 'new display contains no old-session frame');
		await fixture.bridge.presentExternalDisplay(frame(2));
		assert.deepEqual(fixture.frames.map(({ windowId, sequence }) => ({ windowId, sequence })), [{ windowId: 1, sequence: 0 }, { windowId: 2, sequence: 2 }]);
	} finally { await fixture.dispose(); }
});
