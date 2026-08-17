/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the addon does with an argument it cannot serve.
 *
 * Every call here crosses from JavaScript into fixed-size C arrays, and the
 * only thing standing between a caller's mistake and a wild pointer is the
 * refusal at the boundary. So each assertion names a request the addon must
 * turn down: a block whose channel array disagrees with the engine or session
 * it is aimed at, a topology larger than the transfer path can carry, a string
 * longer than the buffer that would hold it, and a plug-in whose declared input
 * count is not the count the caller supplied. The dangerous ones are made in a
 * child process, because a missing refusal is observed as a dead process rather
 * than as a thrown exception.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	FIXTURE_PLUGIN_SUFFIX,
	fixturePluginDirectory,
} from '../scripts/lib/native-fixture-plugins.mjs';
import {
	ADDON_SOURCE_ROOT,
	ROOT,
	addonIsBuilt,
	addonPath,
	addonTarget,
	childObservation,
	compileSharedLibrary,
	compilerIsAvailable,
	fixturesAreBuilt,
	loadAddon,
	runChildModule,
	temporaryDirectory,
} from './helpers/native-helper-c-harness.js';

const TONE = 2;
const OUTPUT = 1;

const ASYMMETRIC_FIXTURE_SOURCE = `
#include "fixture_plugin_abi.h"

#include <stdlib.h>

struct soundscaper_fixture_instance { uint32_t maximum_frames; };

static soundscaper_fixture_instance *fixture_create(uint32_t sample_rate, uint32_t maximum_frames)
{
	(void)sample_rate;
	soundscaper_fixture_instance *instance = calloc(1u, sizeof(*instance));
	if (instance != NULL) instance->maximum_frames = maximum_frames;
	return instance;
}

static void fixture_destroy(soundscaper_fixture_instance *instance) { free(instance); }

static int32_t fixture_process(
	soundscaper_fixture_instance *instance,
	uint32_t frame_count,
	const float *const *input,
	float *const *output)
{
	if (instance == NULL || output == NULL || input == NULL) return -1;
	if (frame_count == 0u || frame_count > instance->maximum_frames) return -1;
	for (uint32_t channel = 0u; channel < 2u; channel += 1u) {
		float *destination = output[channel];
		if (destination == NULL) return -1;
		for (uint32_t index = 0u; index < frame_count; index += 1u) {
			float sum = 0.0f;
			for (uint32_t source = 0u; source < 4u; source += 1u) {
				const float *samples = input[source];
				if (samples == NULL) return -1;
				sum += samples[index];
			}
			destination[index] = sum;
		}
	}
	return 0;
}

static const soundscaper_fixture_descriptor DESCRIPTOR = {
	.abi_version = SOUNDSCAPER_FIXTURE_ABI_VERSION,
	.stable_id = "soundscaper.fixture.asymmetric",
	.name = "Fixture Asymmetric Topology",
	.vendor = "Soundscaper fixtures",
	.version = "1.0.0",
	.classification = SOUNDSCAPER_FIXTURE_EFFECT,
	.input_channels = 4u,
	.output_channels = 2u,
	.realtime = 1u,
	.offline = 1u,
	.reported_latency_frames = 0,
	.behaviour = SOUNDSCAPER_FIXTURE_PASSTHROUGH,
	.create = fixture_create,
	.destroy = fixture_destroy,
	.process = fixture_process,
	.save_state = NULL,
	.load_state = NULL,
	.latency_frames = NULL,
};

__attribute__((visibility("default")))
const soundscaper_fixture_descriptor *soundscaper_fixture_entry_v1(void)
{
	return &DESCRIPTOR;
}
`;

test('a synthetic block whose channel array is shorter than the engine is refused', { skip: !addonIsBuilt }, () => {
	const run = runChildModule(`
		import { createRequire } from 'node:module';
		const addon = createRequire(import.meta.url)(${JSON.stringify(addonPath)});
		const engine = addon.createSyntheticEngine({
			channelCount: 8, frameCount: 1_024, sampleRate: 48_000, generation: 1,
			mode: ${TONE}, fault: 0, gain: 1, faultFrame: 0,
		});
		const channels = [new Float32Array(1_024), new Float32Array(1_024)];
		let observation;
		try {
			addon.renderSyntheticBlock(engine, 0, 1_024, null, channels);
			observation = { outcome: 'accepted' };
		} catch (error) {
			observation = { outcome: 'refused', message: error.message };
		}
		console.log(\`OBSERVED \${JSON.stringify(observation)}\`);
	`);
	assert.equal(run.signal, null, `the addon must refuse the block rather than die on it:\n${run.stderr}`);
	const observed = childObservation(run);
	assert.equal(observed.outcome, 'refused',
		'an engine configured for eight channels must not render into a two-channel array');
	assert.match(observed.message, /channel/iu);
});

test('a device topology wider than the transfer path can carry is refused at open', { skip: !addonIsBuilt }, () => {
	const native = loadAddon();
	const limit = native.describe().maximumChannelCount;
	const request = {
		candidates: [
			{ backend: 'pipewire', deviceHandle: '@DEFAULT_SINK@' },
			{ backend: 'alsa', deviceHandle: 'null' },
		],
		direction: OUTPUT,
		exclusive: 0,
		sampleRate: 48_000,
		periodFrames: 1_024,
		channelCount: limit + 1,
	};
	const result = native.openAudioDevice(request);
	assert.equal(result.status, 'invalid-request',
		'a session wider than the planar transfer arrays must never open');
	assert.equal(result.session, undefined);
	if (result.session) native.closeAudioDevice(result.session);
});

test('a string longer than the buffer that would hold it is refused, never truncated', { skip: !addonIsBuilt }, () => {
	const native = loadAddon();
	// A path over the 4096-byte candidate buffer: truncation would inspect a
	// different file than the caller named.
	assert.throws(
		() => native.inspectPluginCandidate(`/tmp/${'directory/'.repeat(500)}candidate.scapefx`),
		{ code: 'SOUNDSCAPER_ADDON_INVALID_ARGUMENT' },
		'an over-long candidate path must be refused rather than cut down to one that exists',
	);
	assert.throws(
		() => native.listPluginCandidates(`/tmp/${'directory/'.repeat(500)}`, '.scapefx'),
		{ code: 'SOUNDSCAPER_ADDON_INVALID_ARGUMENT' },
		'an over-long root must be refused before the directory walk',
	);
	// A device handle over the 256-byte handle buffer would open a different
	// device than the one asked for.
	assert.throws(
		() => native.openAudioDevice({
			candidates: [{ backend: 'alsa', deviceHandle: `null${'x'.repeat(400)}` }],
			direction: OUTPUT,
			exclusive: 0,
			sampleRate: 48_000,
			periodFrames: 1_024,
			channelCount: 2,
		}),
		/ordered candidate list/u,
		'an over-long device handle must be refused rather than silently shortened',
	);
});

test('a plug-in state larger than the cap raises its own code, not a generic rejection', {
	skip: !fixturesAreBuilt,
}, () => {
	const native = loadAddon();
	const oversize = join(
		fixturePluginDirectory(ROOT, addonTarget.id),
		`oversize-state${FIXTURE_PLUGIN_SUFFIX}`,
	);
	const instance = native.openPluginInstance(oversize, 48_000, 1_024);
	assert.throws(() => native.savePluginState(instance), {
		code: 'SOUNDSCAPER_PLUGIN_STATE_TOO_LARGE',
		message: 'state-too-large',
	});
});

test('a plug-in that declares more inputs than outputs is served its declared inputs', {
	skip: !addonIsBuilt || !compilerIsAvailable(),
}, () => {
	const directory = temporaryDirectory('native-asymmetric-fixture');
	const fixturePath = join(directory, 'asymmetric-topology.scapefx');
	compileSharedLibrary({
		source: ASYMMETRIC_FIXTURE_SOURCE,
		outputPath: fixturePath,
		includes: [ADDON_SOURCE_ROOT],
	});
	const run = runChildModule(`
		import { createRequire } from 'node:module';
		const addon = createRequire(import.meta.url)(${JSON.stringify(addonPath)});
		const host = addon.openPluginInstance(${JSON.stringify(fixturePath)}, 48_000, 1_024);
		const input = [
			Float32Array.from([1, 1, 1, 1]),
			Float32Array.from([2, 2, 2, 2]),
			Float32Array.from([4, 4, 4, 4]),
			Float32Array.from([8, 8, 8, 8]),
		];
		const output = [new Float32Array(4), new Float32Array(4)];
		const attempt = (channels) => {
			try {
				addon.processPluginBlock(host, 4, channels, output);
				return { outcome: 'processed', first: Array.from(output[0]) };
			} catch (error) {
				return { outcome: 'refused', message: error.message };
			}
		};
		const declared = attempt(input);
		const mismatched = attempt(input.slice(0, 2));
		console.log(\`OBSERVED \${JSON.stringify({ declared, mismatched })}\`);
	`, { directory });
	assert.equal(run.signal, null, `the host must bound the input array rather than die on it:\n${run.stderr}`);
	const observed = childObservation(run);
	assert.equal(observed.declared.outcome, 'processed',
		'a four-input plug-in must be handed four input channels');
	assert.deepEqual(observed.declared.first, [15, 15, 15, 15]);
	assert.equal(observed.mismatched.outcome, 'refused',
		'an input array sized by the output count must be refused, not read past');
});
