/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BrowserAacM4aValidationError,
	encodeBrowserAacM4a,
	probeBrowserAacEncoding,
	validateBrowserAacM4aOutput,
} from '../src/common/editor/browser-webcodecs-aac.ts';
import { browserAacMetadataTags } from '../src/common/editor/browser-aac-metadata.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

const EXPECTED_M4A_GEOMETRY = Object.freeze({
	frameCount: 2_400,
	sampleRate: 48_000,
	channelCount: 2,
});

test('AAC capability uses the browser exact WebCodecs configuration probe', async () => {
	const seen: unknown[] = [];
	const available = await probeBrowserAacEncoding({
		async isConfigSupported(config: unknown) {
			seen.push(config);
			return { supported: true };
		},
	}, { sampleRate: 48_000, channelCount: 2, bitrate: 192_000 });
	assert.equal(available, true);
	assert.deepEqual(seen, [{
		codec: 'mp4a.40.2',
		sampleRate: 48_000,
		numberOfChannels: 2,
		bitrate: 192_000,
	}]);
});

test('AAC capability fails closed when WebCodecs is absent or refuses the tuple', async () => {
	assert.equal(await probeBrowserAacEncoding(undefined, {
		sampleRate: 48_000, channelCount: 2, bitrate: 192_000,
	}), false);
	assert.equal(await probeBrowserAacEncoding({
		async isConfigSupported() { return { supported: false }; },
	}, { sampleRate: 48_000, channelCount: 2, bitrate: 192_000 }), false);
	assert.equal(await probeBrowserAacEncoding({
		async isConfigSupported() { throw new Error('not implemented'); },
	}, { sampleRate: 48_000, channelCount: 2, bitrate: 192_000 }), false);
});

test('AAC metadata maps only fields the MP4 muxer can state exactly', () => {
	assert.deepEqual(browserAacMetadataTags({
		title: 'Complete file', artist: 'Soundscaper', trackNumber: '2',
		year: '2026', comments: 'Browser generated',
	}), {
		title: 'Complete file', artist: 'Soundscaper', trackNumber: 2,
		date: new Date('2026-01-01T00:00:00.000Z'), comment: 'Browser generated',
	});
	assert.throws(
		() => browserAacMetadataTags({ copyright: 'Example' }),
		/metadata fields: copyright/iu,
	);
	assert.throws(
		() => browserAacMetadataTags({ trackNumber: 'side A' }),
		/positive integer/iu,
	);
});

test('AAC output validation demuxes an exact AAC-LC audio-only MP4', async () => {
	assert.deepEqual(await validateBrowserAacM4aOutput(
		aacLcM4a48_000Fixture(), EXPECTED_M4A_GEOMETRY,
	), {
		codec: 'aac', codecProfile: 'mp4a.40.2', sampleRate: 48_000,
		channelCount: 2, durationSeconds: 0.05,
	});
});

test('AAC output validation rejects unreadable bytes and non-LC profiles', async () => {
	await assert.rejects(
		() => validateBrowserAacM4aOutput(
			Uint8Array.of(0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70), EXPECTED_M4A_GEOMETRY,
		),
		(error) => error instanceof BrowserAacM4aValidationError,
	);
	const highEfficiency = aacLcM4a48_000Fixture();
	const audioSpecificConfig = Buffer.from(highEfficiency).indexOf(Buffer.from('119056e500', 'hex'));
	assert.equal(audioSpecificConfig, 528);
	highEfficiency[audioSpecificConfig] = 0x29;
	await assert.rejects(
		() => validateBrowserAacM4aOutput(highEfficiency, EXPECTED_M4A_GEOMETRY),
		/AAC-LC.*mp4a\.40\.2/iu,
	);
});

test('AAC output validation binds sample rate, channels, and duration to the request', async () => {
	const bytes = aacLcM4a48_000Fixture();
	await assert.rejects(
		() => validateBrowserAacM4aOutput(bytes, { ...EXPECTED_M4A_GEOMETRY, sampleRate: 44_100 }),
		/sample rate.*requested/iu,
	);
	await assert.rejects(
		() => validateBrowserAacM4aOutput(bytes, { ...EXPECTED_M4A_GEOMETRY, channelCount: 1 }),
		/channel count.*requested/iu,
	);
	await assert.rejects(
		() => validateBrowserAacM4aOutput(bytes, { ...EXPECTED_M4A_GEOMETRY, frameCount: 4_800 }),
		/duration.*requested/iu,
	);
});

test('AAC output validation observes cancellation before demux', async () => {
	const controller = new AbortController();
	const reason = new DOMException('AAC validation cancelled.', 'AbortError');
	controller.abort(reason);
	await assert.rejects(
		() => validateBrowserAacM4aOutput(aacLcM4a48_000Fixture(), {
			...EXPECTED_M4A_GEOMETRY, signal: controller.signal,
		}),
		(error) => error === reason,
	);
});

test('AAC file generation rejects an already-aborted request before probing WebCodecs', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioEncoder');
	let probes = 0;
	Object.defineProperty(globalThis, 'AudioEncoder', {
		configurable: true,
		value: {
			async isConfigSupported() { probes += 1; return { supported: true }; },
		},
	});
	try {
		const controller = new AbortController();
		const reason = new DOMException('AAC export cancelled.', 'AbortError');
		controller.abort(reason);
		await assert.rejects(() => encodeBrowserAacM4a({
			input: new Uint8Array(new Float32Array([0]).buffer),
			frameCount: 1,
			channelCount: 1,
			sampleRate: 48_000,
			bitrate: 192_000,
			maximumOutputBytes: 1_024,
			signal: controller.signal,
		}), (error) => error === reason);
		assert.equal(probes, 0);
	} finally {
		restoreGlobalProperty('AudioEncoder', previous);
	}
});

test('AAC file generation observes cancellation while its exact support probe is pending', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioEncoder');
	let releaseProbe: ((value: { supported: boolean }) => void) | undefined;
	let announceProbe: (() => void) | undefined;
	const probeStarted = new Promise<void>((resolve) => { announceProbe = resolve; });
	Object.defineProperty(globalThis, 'AudioEncoder', {
		configurable: true,
		value: {
			isConfigSupported() {
				announceProbe?.();
				return new Promise<{ supported: boolean }>((resolve) => { releaseProbe = resolve; });
			},
		},
	});
	try {
		const controller = new AbortController();
		const reason = new DOMException('AAC support probe cancelled.', 'AbortError');
		const encoding = encodeBrowserAacM4a({
			input: new Uint8Array(new Float32Array([0]).buffer),
			frameCount: 1,
			channelCount: 1,
			sampleRate: 48_000,
			bitrate: 192_000,
			maximumOutputBytes: 1_024,
			signal: controller.signal,
		});
		await probeStarted;
		controller.abort(reason);
		releaseProbe?.({ supported: true });
		await assert.rejects(encoding, (error) => error === reason);
	} finally {
		restoreGlobalProperty('AudioEncoder', previous);
	}
});

function restoreGlobalProperty(key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
