/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	readWebCoreStreamDiagnostics,
	recordWebCoreStreamPlayback,
	recordWebCoreStreamUnderrun,
} from '../src/common/editor/web-core-stream-diagnostics.ts';

test('Web Core stream diagnostics count only observed streamed playback and real underrun frames', () => {
	const before = readWebCoreStreamDiagnostics();
	recordWebCoreStreamPlayback(0);
	recordWebCoreStreamUnderrun({ frames: 0 });
	assert.deepEqual(readWebCoreStreamDiagnostics(), before);

	recordWebCoreStreamPlayback(2);
	recordWebCoreStreamUnderrun({ frames: 128 });
	const after = readWebCoreStreamDiagnostics();
	assert.equal(after.streamedPlaybackObserved, true);
	assert.equal(after.streamUnderrunFrames, before.streamUnderrunFrames + 128);
	assert.ok(Object.isFrozen(after));
});

test('Web Core stream diagnostics reject invented or unsafe observations', () => {
	assert.throws(() => recordWebCoreStreamPlayback(-1), /streamed clip count/iu);
	assert.throws(() => recordWebCoreStreamUnderrun({ frames: -1 }), /underrun frames/iu);
	assert.throws(() => recordWebCoreStreamUnderrun({ frames: 1.5 }), /underrun frames/iu);
});
