/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';

function heldBin() {
	const fixture = createTransportFixture();
	fixture.state.projectBinPreview = { clipId: 'audition', state: 'playing' };
	let release = (): void => undefined;
	const stopped = new Promise<void>(resolve => { release = resolve; });
	fixture.setStopPreview(async () => {
		assert.equal(fixture.calls.playAtSpeed.length, 0);
		assert.equal(fixture.calls.begins.length, 0, 'the audible Bin must retire before preparing timeline playback');
		await stopped;
	});
	return { ...fixture, release };
}

test('the configured play-at-speed command awaits retirement of the live Bin audition', async () => {
	const fixture = heldBin();
	const start = fixture.service.handlePlayAtSpeed(1.25);
	try {
		assert.equal(fixture.calls.previewStops, 1);
		assert.equal(fixture.calls.begins.length, 0);
	} finally {
		fixture.release();
		await start;
	}
	assert.equal(fixture.state.projectBinPreview, null);
	assert.equal(fixture.calls.playAtSpeed.length, 1);
});

test('ordinary Stop during Bin retirement cancels the pending speed handoff', async () => {
	const fixture = heldBin();
	const start = fixture.service.handlePlayAtSpeed(1.25);
	await fixture.service.handleTransport('stop');
	fixture.release();
	assert.equal(await start, false);
	assert.equal(fixture.calls.playAtSpeed.length, 0);
	assert.equal(fixture.calls.begins.length, 0);
});

test('a direct speed start without a Bin owner keeps the existing playback path', async () => {
	const fixture = createTransportFixture();
	assert.equal(await fixture.service.handlePlayAtSpeed(1.25), true);
	assert.equal(fixture.calls.previewStops, 0);
	assert.equal(fixture.calls.playAtSpeed.length, 1);
});
