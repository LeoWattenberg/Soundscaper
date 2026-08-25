/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	loadIsolatedBundledAudioCodecRuntime,
} from '../desktop/bundled-audio-codec-isolated-runtime.ts';
import type {
	BundledAudioCodecHelperConfiguration,
	BundledAudioCodecId,
} from '../desktop/bundled-audio-codec-helper-process.ts';
import type { BundledAudioCodecOperationRunner } from '../desktop/bundled-audio-codec-operation-runner.ts';
import type { DesktopAudioCodecProviderRuntime } from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IDS = Object.freeze(['flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack'] as const);

const configurations = Object.freeze(Object.fromEntries(IDS.map((codec) => [codec, Object.freeze({
	contractVersion: 1 as const, target: 'linux-x64' as const, codec,
	runtimeRoot: '/app/desktop/project-library-runtime', moduleBytes: 1_000,
	moduleSha256: codec.padEnd(64, 'a').slice(0, 64).replace(/[^a-f0-9]/gu, 'a'),
	wasmBytes: 10_000, wasmSha256: codec.padEnd(64, 'b').slice(0, 64).replace(/[^a-f0-9]/gu, 'b'),
})])) as Record<BundledAudioCodecId, BundledAudioCodecHelperConfiguration>);

function configuration(codec: BundledAudioCodecId) { return configurations[codec]; }

function request(format: DesktopAudioCodecRequest['format'], operation: 'audio-decode' | 'audio-encode') {
	if (operation === 'audio-decode') return Object.freeze({
		operation, format, input: Uint8Array.of(1), sampleRate: null, channelCount: null,
		settings: Object.freeze({ sampleFormat: 'f32le' as const }), maximumOutputBytes: 1_024,
	}) as DesktopAudioCodecRequest;
	const settings = format === 'flac' ? { compressionLevel: 5, bitDepth: 24 as const }
		: format === 'ogg-vorbis' ? { quality: 5 }
			: format === 'wavpack' ? { compressionLevel: 2 }
				: { bitrateKbps: format === 'opus' ? 128 : 192 };
	return Object.freeze({
		operation, format, input: new Uint8Array(8), sampleRate: 48_000, channelCount: 2,
		settings: Object.freeze(settings), maximumOutputBytes: 1_024,
	}) as DesktopAudioCodecRequest;
}

function operation(format: DesktopAudioCodecRequest['format'], direction: 'decode' | 'encode') {
	const tuples = {
		flac: ['flac', 'flac', direction === 'encode' ? 's24' : 'f32'],
		mp3: ['mp3', 'mp3', direction === 'encode' ? 'f32p' : 'f32'],
		'ogg-vorbis': ['ogg', 'vorbis', 'f32p'],
		opus: ['ogg', 'opus', 'f32p'],
		wavpack: ['wavpack', 'wavpack', 'f32'],
		mp2: ['mp2', 'mp2', direction === 'encode' ? 'f32p' : 'f32'],
		'aac-m4a': ['m4a', 'aac', 'f32p'],
	} as const;
	const tuple = tuples[format];
	return Object.freeze({
		direction, mediaKind: 'audio' as const, container: tuple[0], codec: tuple[1],
		profile: format === 'aac-m4a' ? 'lc' : null, sampleFormat: tuple[2], pixelFormat: null,
		sampleRate: direction === 'encode' ? 48_000 : null,
		channelCount: direction === 'encode' ? 2 : null, width: null, height: null,
	}) satisfies DesktopCodecOperation;
}

test('isolated runtime verifies all seven identities and routes every exact tuple to its proxy', async () => {
	const verified: BundledAudioCodecId[] = [];
	const preflights: BundledAudioCodecId[] = [];
	const executions: BundledAudioCodecId[] = [];
	const runner: BundledAudioCodecOperationRunner = Object.freeze({
		async preflight(codec: BundledAudioCodecId) {
			preflights.push(codec);
			return Object.freeze({ disposition: 'supported', reason: null });
		},
		async execute(codec: BundledAudioCodecId) {
			executions.push(codec);
			return Object.freeze({ status: 'executed', output: Uint8Array.of(1) });
		},
	});
	const runtime = await loadIsolatedBundledAudioCodecRuntime({
		target: 'linux-x64', scratchRoot: '/scratch',
		verifyPayload: async (codec) => { verified.push(codec); return configuration(codec); },
		spawn: () => assert.fail('injected runner must own execution'),
		createRunner: () => runner,
	});
	assert.ok(runtime);
	assert.deepEqual(verified.sort(), [...IDS].sort());
	const cases = Object.freeze([
		['flac', 'decode', 'flac'], ['flac', 'encode', 'flac'],
		['mp3', 'decode', 'mpg123'], ['mp3', 'encode', 'lame'],
		['mp2', 'decode', 'mpg123'], ['mp2', 'encode', 'twolame'],
		['ogg-vorbis', 'decode', 'vorbis'], ['ogg-vorbis', 'encode', 'vorbis'],
		['opus', 'decode', 'opus'], ['opus', 'encode', 'opus'],
		['wavpack', 'decode', 'wavpack'], ['wavpack', 'encode', 'wavpack'],
	] as const);
	for (const [format, direction, expected] of cases) {
		const codecRequest = request(format, direction === 'decode' ? 'audio-decode' : 'audio-encode');
		const codecOperation = operation(format, direction);
		const selected: DesktopAudioCodecProviderRuntime | null | undefined
			= await runtime.selectRequestRuntime?.(codecRequest, { operation: codecOperation });
		assert.ok(selected, `${format} ${direction}`);
		assert.match(selected.provider.id, new RegExp(expected, 'u'));
		assert.deepEqual(await selected.preflightRequest?.(codecRequest, { operation: codecOperation }), {
			disposition: 'supported', reason: null,
		});
		await selected.execute(codecRequest, { operation: codecOperation });
	}
	assert.deepEqual(preflights, cases.map((entry) => entry[2]));
	assert.deepEqual(executions, cases.map((entry) => entry[2]));
	assert.equal(await runtime.selectRequestRuntime?.(
		request('aac-m4a', 'audio-decode'), { operation: operation('aac-m4a', 'decode') },
	), null);
});

test('identity failures omit only the affected codec and no loader module enters main', async () => {
	const runtime = await loadIsolatedBundledAudioCodecRuntime({
		target: 'linux-x64', scratchRoot: '/scratch',
		verifyPayload: async (codec) => {
			if (codec === 'vorbis') throw new Error('missing');
			return configuration(codec);
		},
		spawn: () => assert.fail('unused'),
		createRunner: () => Object.freeze({
			async preflight() { return Object.freeze({ disposition: 'supported', reason: null }); },
			async execute() { return Object.freeze({ status: 'failed', reason: 'unavailable', detail: 'unused' }); },
		}),
	});
	assert.ok(runtime);
	assert.equal(await runtime.selectRequestRuntime?.(
		request('ogg-vorbis', 'audio-decode'), { operation: operation('ogg-vorbis', 'decode') },
	), null);
	assert.ok(await runtime.selectRequestRuntime?.(
		request('flac', 'audio-decode'), { operation: operation('flac', 'decode') },
	));

	const source = await readFile(resolve(ROOT, 'desktop/bundled-audio-codec-isolated-runtime.ts'), 'utf8');
	for (const codec of ['flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack']) {
		assert.doesNotMatch(source, new RegExp(`bundled-${codec}-audio-codec-runtime`, 'u'));
		assert.doesNotMatch(source, new RegExp(`loadBundled.*${codec}`, 'iu'));
	}
});
