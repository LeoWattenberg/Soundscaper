/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopAudioCodecReceiptJournal,
} from '../desktop/desktop-audio-codec-receipt-journal.mjs';

function observation(requestId) {
	return Object.freeze({
		requestId,
		receipt: Object.freeze({
			provider: Object.freeze({ kind: 'bundled', id: 'libopus', implementation: 'libopus', version: '1.5.2' }),
			capabilityGeneration: 'generation',
			operation: Object.freeze({ direction: 'encode', mediaKind: 'audio', container: 'ogg', codec: 'opus' }),
			settings: Object.freeze({ bitrateKbps: 160 }),
			inputDigests: Object.freeze(['1'.repeat(64)]),
			outputDigest: '2'.repeat(64),
			timing: null,
		}),
	});
}

test('desktop audio receipt journal retains only the newest bounded observations', () => {
	const journal = createDesktopAudioCodecReceiptJournal({ maximumEntries: 2 });
	journal.record(observation('request-a'));
	journal.record(observation('request-b'));
	journal.record(observation('request-c'));

	const snapshot = journal.snapshot();
	assert.deepEqual(snapshot.map(({ requestId }) => requestId), ['request-b', 'request-c']);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot[0]), true);
	assert.notEqual(snapshot, journal.snapshot());

	journal.clear();
	assert.deepEqual(journal.snapshot(), []);
});

test('desktop audio receipt journal rejects ambient or malformed observations', () => {
	assert.throws(
		() => createDesktopAudioCodecReceiptJournal({ maximumEntries: 0 }),
		/Desktop audio codec receipt journal options are invalid/u,
	);
	const journal = createDesktopAudioCodecReceiptJournal();
	assert.throws(() => journal.record({ requestId: '../../../escape', receipt: {} }),
		/Desktop audio codec receipt observation is invalid/u);
	assert.throws(() => journal.record({ requestId: null, receipt: null }),
		/Desktop audio codec receipt observation is invalid/u);
});
