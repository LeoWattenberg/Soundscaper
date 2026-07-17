import test from 'node:test';
import assert from 'node:assert/strict';

import {
	playbackMeterAmplitudeToDb,
	playbackMeterFullSteps,
	playbackMeterGainFromPosition,
	playbackMeterPercent,
} from '../src/lib/tools/audio-editor/playback-meter.js';

test('playback meter scales match Audacity logarithmic, IEC dB, and amplitude models', () => {
	assert.equal(playbackMeterPercent(-60, 'db-log', 60), 0);
	assert.equal(playbackMeterPercent(-30, 'db-log', 60), 50);
	assert.equal(playbackMeterPercent(-30, 'db-log', 120), 75);
	assert.equal(playbackMeterPercent(0, 'db-log', 60), 100);

	assert.equal(playbackMeterPercent(-20, 'db-linear', 60), 50);
	assert.equal(playbackMeterPercent(-30, 'db-linear', 60), 30);
	assert.equal(playbackMeterPercent(-40, 'db-linear', 60), 15);
	assert.equal(playbackMeterPercent(-50, 'db-linear', 60), 7.5);

	assert.equal(playbackMeterPercent(-60, 'amplitude', 60), 0);
	assert.ok(Math.abs(playbackMeterPercent(-6.020599913, 'amplitude', 60) - 50) < 0.000001);
	assert.equal(playbackMeterPercent(0, 'amplitude', 60), 100);
});

test('playback volume positions invert every meter model', () => {
	for (const type of ['db-log', 'db-linear', 'amplitude']) {
		for (const position of [0, 0.075, 0.15, 0.3, 0.5, 0.75, 1]) {
			const gain = playbackMeterGainFromPosition(position, type, 60);
			const db = playbackMeterAmplitudeToDb(gain, 60);
			const restored = playbackMeterPercent(db, type, 60) / 100;
			assert.ok(Math.abs(restored - position) < 0.000001, `${type} at ${position}`);
		}
	}
});

test('playback meter values clamp safely at silence and full scale', () => {
	assert.equal(playbackMeterAmplitudeToDb(0, 96), -96);
	assert.equal(playbackMeterAmplitudeToDb(2, 96), 0);
	assert.equal(playbackMeterPercent(Number.NaN, 'db-log', 72), 0);
	assert.equal(playbackMeterGainFromPosition(-1, 'db-log', 60), 0);
	assert.equal(playbackMeterGainFromPosition(2, 'db-log', 60), 1);
});

test('playback meter rulers use Audacity full-step selection at their rendered size', () => {
	assert.deepEqual(playbackMeterFullSteps('db-linear', 60, 280), [-60, -30, -20, -15, -10, -5, 0]);
	assert.deepEqual(
		playbackMeterFullSteps('db-linear', 60, 500),
		[-60, -50, -40, -30, -24, -18, -12, -9, -6, -3, 0],
	);
	assert.deepEqual(playbackMeterFullSteps('db-log', 60, 280), [-60, -48, -36, -24, -12, 0]);
	assert.deepEqual(playbackMeterFullSteps('amplitude', 60, 280), [0, 0.2, 0.4, 0.6, 0.8, 1]);
	assert.deepEqual(playbackMeterFullSteps('amplitude', 60, 500), [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
});
