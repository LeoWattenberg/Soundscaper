/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBundledAudioCodecCompositeProvider } from
	'../desktop/bundled-audio-codec-composite-provider.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.ts';

const OPERATION = Object.freeze({
	direction: 'decode', mediaKind: 'audio', container: 'flac', codec: 'flac',
	profile: null, sampleFormat: 'f32', pixelFormat: null, sampleRate: null,
	channelCount: null, width: null, height: null,
}) satisfies DesktopCodecOperation;

test('composite provider identity is order-stable and changes for each child identity dimension', () => {
	const children = Object.freeze([
		provider('flac', 'libflac-wasm-f32-to-s24', '1.5.0', 'flac-generation'),
		provider('lame', 'lame-wasm-f32-mp3', '4.0', 'lame-generation'),
		provider('opus', 'libopus-libogg-wasm-f32', 'libopus-1.6.1', 'opus-generation'),
	]);
	const expected = composite(children);
	const reordered = composite([children[2]!, children[0]!, children[1]!]);
	assert.deepEqual(identity(reordered), identity(expected));
	assert.equal(expected.version, '1.5.0+4.0+libopus-1.6.1');
	assert.match(expected.capabilityGeneration, /^libflac-lame-libopus-libogg-[a-f\d]{64}$/u);

	const mismatches = [
		[provider('flac', 'libflac-wasm-f32-to-s24', '1.5.1', 'flac-generation'),
			children[1]!, children[2]!],
		[provider('flac', 'libflac-wasm-f32-to-s24', '1.5.0', 'changed-generation'),
			children[1]!, children[2]!],
		[provider('flac', 'reviewed-lossless-wasm', '1.5.0', 'flac-generation'),
			children[1]!, children[2]!],
	] as const;
	for (const mismatch of mismatches) {
		assert.notDeepEqual(identity(composite(mismatch)), identity(expected));
	}
});

test('composite preflight traverses in order and preserves terminal and fallback results', async () => {
	const visits: string[] = [];
	const unsupported = provider('first', 'libflac', '1', 'first',
		async () => { visits.push('first'); return result('unsupported', 'first misses'); });
	const supported = provider('second', 'lame', '2', 'second',
		async () => { visits.push('second'); return result('supported', null); });
	const unreachable = provider('third', 'wavpack', '3', 'third',
		async () => { visits.push('third'); return result('rejected', 'must not run'); });
	assert.deepEqual(await composite([unsupported, supported, unreachable]).preflight(
		OPERATION, Object.freeze({}),
	), { disposition: 'supported', reason: null });
	assert.deepEqual(visits, ['first', 'second']);

	visits.length = 0;
	const rejected = provider('rejected', 'twolame', '4', 'rejected',
		async () => { visits.push('rejected'); return result('rejected', 'security refusal'); });
	assert.deepEqual(await composite([unsupported, rejected, unreachable]).preflight(
		OPERATION, Object.freeze({}),
	), { disposition: 'rejected', reason: 'security refusal' });
	assert.deepEqual(visits, ['first', 'rejected']);

	visits.length = 0;
	assert.deepEqual(await composite([unsupported]).preflight(OPERATION, Object.freeze({})), {
		disposition: 'unsupported', reason: 'exact composite fallback',
	});
	assert.deepEqual(visits, ['first']);
});

function composite(providers: readonly DesktopCodecProvider[]): DesktopCodecProvider {
	return createBundledAudioCodecCompositeProvider({
		target: 'linux-x64', providers, unsupportedReason: 'exact composite fallback',
	});
}

function provider(
	id: string,
	implementation: string,
	version: string,
	capabilityGeneration: string,
	preflight: DesktopCodecProvider['preflight'] = async () => result('unsupported', 'unsupported'),
): DesktopCodecProvider {
	return Object.freeze({ kind: 'bundled', id: `bundled-${id}-linux-x64`, implementation,
		version, capabilityGeneration, preflight });
}

function result(
	disposition: DesktopCodecPreflightResult['disposition'],
	reason: string | null,
): DesktopCodecPreflightResult {
	return Object.freeze({ disposition, reason }) as DesktopCodecPreflightResult;
}

function identity(providerValue: DesktopCodecProvider) {
	return Object.freeze({ kind: providerValue.kind, id: providerValue.id,
		implementation: providerValue.implementation, version: providerValue.version,
		capabilityGeneration: providerValue.capabilityGeneration });
}
