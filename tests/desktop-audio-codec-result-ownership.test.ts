/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createDesktopAudioCodecBroker, type DesktopAudioCodecProviderRuntime } from '../desktop/desktop-audio-codec-broker.ts';

for (const operation of ['audio-encode', 'audio-decode'] as const) test(`${operation} snapshots provider output exactly once and preserves result isolation and integrity`, async (t) => {
	const output = Uint8Array.of(0, 0, 128, 62, 0, 0, 128, 190);
	const input = new Uint8Array(8);
	const Original = Uint8Array;
	let snapshots = 0;
	const Instrumented = new Proxy(Original, { construct(target, args) {
		if (args[0] instanceof Original && args[0].byteLength === output.byteLength && args[0][2] === 128) snapshots += 1;
		return Reflect.construct(target, args, target) as Uint8Array;
	} });
	const runtimes = (['bundled', 'operating-system', 'external-ffmpeg'] as const).map((kind): DesktopAudioCodecProviderRuntime => ({
		provider: { kind, id: kind, implementation: kind,
			version: '1.0.0', capabilityGeneration: 'same', preflight: async () => kind === 'operating-system'
				? { disposition: 'supported' as const, reason: null } : { disposition: 'unsupported' as const, reason: 'Not selected.' } },
		execute: async () => operation === 'audio-decode'
			? { status: 'executed', output, decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 } }
			: { status: 'executed', output },
	}));
	assert.equal(runtimes.length, 3);
	const broker = createDesktopAudioCodecBroker({ runtimes: [runtimes[0]!, runtimes[1]!, runtimes[2]!] });
	const expectedDigest = createHash('sha256').update(output).digest('hex');
	t.mock.method(globalThis, 'Uint8Array', Instrumented);
	const { result, receipt } = await broker.execute(operation === 'audio-decode'
		? { operation, format: 'flac', input, sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' }, maximumOutputBytes: 1_024 }
		: { operation, format: 'flac', input, sampleRate: 48_000, channelCount: 2, settings: { compressionLevel: 5, bitDepth: 24 }, maximumOutputBytes: 1_024 });
	assert.equal(snapshots, 1, 'one isolated provider-output snapshot; validation does not duplicate it');
	assert.equal(receipt.outputDigest, expectedDigest);
	output.fill(255);
	assert.equal(createHash('sha256').update(result.bytes).digest('hex'), expectedDigest);
	result.bytes.fill(0);
	assert.ok(output.every((sample) => sample === 255));
});
