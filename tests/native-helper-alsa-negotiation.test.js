/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the ALSA session does when the device answers with something other than
 * what was asked for.
 *
 * No build host has a sound card that will refuse a rate on demand, and a
 * container has no card at all, so the device side is a stub built here: a
 * libasound with exactly the symbols the addon binds, whose granted rate and
 * period are whatever the test says they are. The addon loads it through the
 * same `dlopen` it uses in production — nothing about the code under test is
 * mocked, only the card it talks to.
 *
 * Every probe runs in a child process. The loader reads `LD_LIBRARY_PATH` once
 * at start, and a missing bounds check is observed as a dead child rather than
 * as an exception this process could catch.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBackendStubs } from './helpers/native-backend-stubs.js';
import {
	addonIsBuilt,
	addonPath,
	childObservation,
	compilerIsAvailable,
	runChildModule,
} from './helpers/native-helper-c-harness.js';

const OUTPUT = 1;

const stubRoot = addonIsBuilt && compilerIsAvailable() ? buildBackendStubs(['alsa']) : null;

function probe(script, environment = {}) {
	const run = runChildModule(`
		import { createRequire } from 'node:module';
		const addon = createRequire(import.meta.url)(${JSON.stringify(addonPath)});
		const open = (request) => addon.openAudioDevice({
			candidates: [{ backend: 'alsa', deviceHandle: 'stub' }],
			direction: ${OUTPUT},
			exclusive: 0,
			sampleRate: 48_000,
			periodFrames: 1_024,
			channelCount: 2,
			...request,
		});
		const report = (observation) => console.log(\`OBSERVED \${JSON.stringify(observation)}\`);
		${script}
	`, { env: { LD_LIBRARY_PATH: stubRoot, ...environment } });
	assert.equal(run.signal, null, `the addon must answer the stub card rather than die on it:\n${run.stderr}`);
	return childObservation(run);
}

test('a device that grants the request opens and reports exactly what was asked for', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({});
		report({
			status: result.status,
			rate: result.grantedSampleRate,
			period: result.grantedPeriodFrames,
			channels: result.grantedChannelCount,
			backend: result.grantedBackend,
		});
	`);
	assert.deepEqual(observed, {
		status: 'ok', rate: 48_000, period: 1_024, channels: 2, backend: 'alsa',
	});
});

test('a device that grants another rate is refused rather than recorded as the request', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({});
		report({ status: result.status, detail: result.detail, rate: result.grantedSampleRate, session: Boolean(result.session) });
	`, { SOUNDSCAPER_STUB_ALSA_RATE: '44100' });
	assert.equal(observed.status, 'format-refused',
		'a session recorded at 48 kHz that the card is running at 44.1 kHz is the substitution the milestone stops on');
	assert.equal(observed.session, false);
	assert.match(observed.detail, /44100/u);
	assert.match(observed.detail, /48000/u);
});

test('a device that grants another period size is refused the same way', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({});
		report({ status: result.status, detail: result.detail, session: Boolean(result.session) });
	`, { SOUNDSCAPER_STUB_ALSA_PERIOD: '2048' });
	assert.equal(observed.status, 'format-refused');
	assert.equal(observed.session, false);
	assert.match(observed.detail, /2048/u);
});

test('a transfer whose channel array is narrower than the session is refused', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({ channelCount: 2 });
		const attempt = (channels) => {
			try {
				return { outcome: 'transferred', status: addon.writeAudioDevice(result.session, 64, channels).status };
			} catch (error) {
				return { outcome: 'refused', message: error.message };
			}
		};
		const narrow = attempt([new Float32Array(64)]);
		const matching = attempt([new Float32Array(64), new Float32Array(64)]);
		addon.closeAudioDevice(result.session);
		report({ open: result.status, narrow, matching });
	`);
	assert.equal(observed.open, 'ok');
	assert.equal(observed.narrow.outcome, 'refused',
		'a two-channel session must never read a second channel pointer the caller did not supply');
	assert.match(observed.narrow.message, /channel/iu);
	assert.equal(observed.matching.outcome, 'transferred');
	assert.equal(observed.matching.status, 'ok');
});
