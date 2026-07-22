import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	VIDEO_EFFECT_PARITY_HEIGHT,
	VIDEO_EFFECT_PARITY_WIDTH,
	compareVideoEffectFrames,
	createVideoEffectParityFixture,
} from './browser/video-effect-parity-helpers.js';

const FIXTURE_HASHES = Object.freeze({
	gradient: 'a1e713c5c5b9fa18b1c19d0904449027cf0fcfa6c5438c05bedcd0e2554bb200',
	'color-chart': 'b3b7c769d18cd0fded58d55eefc5281a626fcd42acec44d144392ecc4ff308a7',
	edge: '6a2274eba51071e99d08afaf7541ceaeafaba271af69f7f312336024d1873ecf',
	transparency: '55d2384282e66eb12cba4ae16b229d5fdccb5190471dcc8a0487ed0ec56e1399',
});

test('video effect parity fixtures remain byte-deterministic', () => {
	for (const [name, expectedHash] of Object.entries(FIXTURE_HASHES)) {
		const fixture = createVideoEffectParityFixture(name);
		assert.equal(fixture.width, VIDEO_EFFECT_PARITY_WIDTH);
		assert.equal(fixture.height, VIDEO_EFFECT_PARITY_HEIGHT);
		assert.equal(fixture.bytes.length, VIDEO_EFFECT_PARITY_WIDTH * VIDEO_EFFECT_PARITY_HEIGHT * 4);
		assert.equal(createHash('sha256').update(fixture.bytes).digest('hex'), expectedHash);
	}
});

test('video effect parity metrics are normalized per channel and detect structural changes', () => {
	const fixture = createVideoEffectParityFixture('gradient');
	assert.deepEqual(
		compareVideoEffectFrames(fixture.bytes, fixture.bytes, fixture.width, fixture.height),
		{ ssim: 1, channelMae: { red: 0, green: 0, blue: 0, alpha: 0 } },
	);

	const changed = fixture.bytes.slice();
	for (let offset = 0; offset < changed.length; offset += 4) changed[offset] = 255 - changed[offset];
	const metrics = compareVideoEffectFrames(changed, fixture.bytes, fixture.width, fixture.height);
	assert.ok(metrics.ssim < 0.95);
	assert.ok(metrics.channelMae.red > 0.2);
	assert.equal(metrics.channelMae.green, 0);
	assert.equal(metrics.channelMae.blue, 0);
	assert.equal(metrics.channelMae.alpha, 0);
});
