/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BUNDLED_AUDIO_CODEC_IDENTITIES,
	createBundledAudioCodecProvider,
	bundledAudioCodecProviderIdentity,
} from '../desktop/bundled-audio-codec-identity.ts';
import { createIsolatedBundledAudioCodecProvider } from
	'../desktop/bundled-audio-codec-provider-catalog.ts';
import { bundledAudioCodecSpec } from '../desktop/bundled-audio-codec-helper-configuration.ts';

const CASES = Object.freeze([
	['flac', 'libflac', 'libflac-wasm-f32-to-s24', '1.5.0',
		'6246c5d6979f25b733e399383004a6a861478802c376d59885a7b2c7130a1584'],
	['lame', 'lame', 'lame-wasm-f32-mp3', '4.0',
		'e8ca1786d95a56ead1fc2294be98ea68d31eed5837abd79d2a3322a0af946c6f'],
	['mpg123', 'mpg123', 'libmpg123-wasm-feed-f32', 'mpg123-1.33.7',
		'1aa30e6e25a9503be94ce3720ce6c4af649b2412c191a6f800f36dd619270bc2'],
	['opus', 'libopus-libogg', 'libopus-libogg-wasm-f32', 'libopus-1.6.1+libogg-1.3.6',
		'cc5577fa2a6c74781b7eb57bd754f7d9b50b2355a83d85b0f0cfe96415607dce'],
	['twolame', 'twolame', 'twolame-wasm-f32-mp2', '0.4.0',
		'8b89b6a12eab302c92960865c6b1c7d33df86d6d8760c8549a8ee38a99ef2b30'],
	['vorbis', 'libvorbis-libogg', 'libvorbis-libogg-wasm-f32', 'libvorbis-1.3.7+libogg-1.3.6',
		'cfa42717394ce29f8af676fb0ad7bff632306f75e536211eb85b7cc5aaf09aa0'],
	['wavpack', 'wavpack', 'wavpack-wasm-f32', '5.9.0',
		'5197fb8fd8e6cbef210acad11eb2a9dd8395a519b5fd64ba14a1b4978041b0c5'],
] as const);

test('all bundled codec provider identities have one frozen digest-bound authority', () => {
	assert.ok(Object.isFrozen(BUNDLED_AUDIO_CODEC_IDENTITIES));
	for (const [codec, capabilityStem, implementation, version, digest] of CASES) {
		const identity = bundledAudioCodecProviderIdentity(codec, 'linux-x64');
		const isolated = createIsolatedBundledAudioCodecProvider(codec, 'linux-x64');
		assert.ok(Object.isFrozen(BUNDLED_AUDIO_CODEC_IDENTITIES[codec]));
		assert.ok(Object.isFrozen(identity));
		assert.deepEqual(identity, {
			kind: 'bundled',
			id: `bundled-${capabilityStem}-wasm-linux-x64`,
			implementation,
			version,
			capabilityGeneration: `${capabilityStem}-${digest}`,
		});
		for (const field of ['kind', 'id', 'implementation', 'version', 'capabilityGeneration'] as const) {
			assert.equal(isolated[field], identity[field], `${codec}.${field}`);
		}
		assert.equal(bundledAudioCodecSpec(codec).providerId('linux-x64'), identity.id);
	}
});

test('shared descriptor preflight keeps exact caller policy and cancellation', async () => {
	const cancelled = new Error('cancelled by caller');
	const provider = createBundledAudioCodecProvider('flac', 'linux-x64', {
		matches: (operation) => operation.codec === 'flac',
		unsupportedReason: 'exact caller reason',
		throwIfAborted: (signal) => { if (signal?.aborted) throw cancelled; },
	});
	const operation = Object.freeze({
		direction: 'encode', mediaKind: 'audio', container: 'flac', codec: 'flac',
		profile: null, sampleFormat: 's24', pixelFormat: null, sampleRate: 48_000,
		channelCount: 2, width: null, height: null,
	} as const);
	const supported = await provider.preflight(operation, {});
	assert.deepEqual(supported, { disposition: 'supported', reason: null });
	assert.ok(Object.isFrozen(supported));
	const unsupported = await provider.preflight({ ...operation, codec: 'other' }, {});
	assert.deepEqual(unsupported, { disposition: 'unsupported', reason: 'exact caller reason' });
	assert.ok(Object.isFrozen(unsupported));
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(provider.preflight(operation, { signal: controller.signal }), (error) => error === cancelled);
});
