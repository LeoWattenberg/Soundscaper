/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopAudioCodecRuntime } from '../src/common/editor/desktop-audio-codec-runtime.ts';
import {
	DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER,
	isDesktopMainAudioCodecRuntime,
} from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';

test('the main-audio renderer runtime carries the exact desktop import marker', () => {
	const runtime = createDesktopAudioCodecRuntime({
		execute() { throw new Error('not called'); },
		cancel() { throw new Error('not called'); },
	});
	assert.equal(isDesktopMainAudioCodecRuntime(runtime), true);
	assert.equal(isDesktopMainAudioCodecRuntime({
		capabilities: () => ({ profileId: 'desktop-main-audio-codecs' }),
	}), false, 'a lookalike capability profile must not change import ordering');
	runtime.dispose();
});

test('desktop standalone audio import uses the broker before Web Audio', async () => {
	const fixture = importFixture({ desktop: true });
	await assert.rejects(() => fixture.service.importFile(fixture.file), (error) => error === fixture.stop);
	assert.deepEqual(fixture.events, [
		'codec', 'context', 'buffer-from-channels', 'array-buffer', 'inspect', 'canonicalize',
	]);
});

test('a desktop broker failure is not bypassed through Web Audio', async () => {
	const brokerFailure = new Error('desktop broker failed');
	const fixture = importFixture({ desktop: true, brokerFailure });
	await assert.rejects(() => fixture.service.importFile(fixture.file), (error) => error === brokerFailure);
	assert.deepEqual(fixture.events, ['codec']);
});

test('browser standalone audio import remains Web Audio first with codec fallback', async () => {
	const native = importFixture({ desktop: false });
	await assert.rejects(() => native.service.importFile(native.file), (error) => error === native.stop);
	assert.deepEqual(native.events, ['context', 'array-buffer', 'inspect', 'native', 'canonicalize']);

	const fallback = importFixture({ desktop: false, nativeFailure: new Error('native failed') });
	await assert.rejects(() => fallback.service.importFile(fallback.file), (error) => error === fallback.stop);
	assert.deepEqual(fallback.events, [
		'context', 'array-buffer', 'inspect', 'native', 'codec', 'buffer-from-channels', 'canonicalize',
	]);
});

function importFixture(options: Readonly<{
	desktop: boolean;
	brokerFailure?: Error;
	nativeFailure?: Error;
}>) {
	const events: string[] = [];
	const stop = new Error('stop after decode routing');
	const decoded = Object.freeze({
		length: 2,
		numberOfChannels: 1,
		sampleRate: 48_000,
	});
	const codecRuntime = {
		...(options.desktop ? { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true } : {}),
		async decode() {
			events.push('codec');
			if (options.brokerFailure) throw options.brokerFailure;
			return { channels: [Float32Array.of(0.25, -0.25)], sampleRate: 48_000 };
		},
	};
	const members: Record<string, unknown> = {
		SOURCE_CHUNK_FRAMES: 1_024,
		bufferFromChannels: async () => { events.push('buffer-from-channels'); return decoded; },
		canonicalizeBuffer: async () => { events.push('canonicalize'); throw stop; },
		copy: {
			timelineFramesFinite: 'Frames must be finite.',
			audioTrackNotFound: 'Audio track not found.',
		},
		engine: {
			getAudioContext: async () => { events.push('context'); return {}; },
			decodeAudioData: async () => {
				events.push('native');
				if (options.nativeFailure) throw options.nativeFailure;
				return decoded;
			},
		},
		ffmpeg: codecRuntime,
		getProject: () => ({ tracks: [], sources: [] }),
		inspectEncodedAudioSampleRate: () => { events.push('inspect'); return 44_100; },
		isAudioEditorVideoFile: () => false,
		isLegacyAupFile: () => false,
		isLegacyBlockFile: () => false,
		isWavFile: () => false,
		preflightStorage: async () => undefined,
		projectSampleRate: () => 48_000,
		store: {},
	};
	const noop = () => undefined;
	const runtime = new Proxy(members, {
		get(target, property) {
			return typeof property === 'string' && Object.hasOwn(target, property)
				? target[property]
				: noop;
		},
	}) as ProjectImportRuntime;
	const file = {
		name: 'voice.mp3',
		type: 'audio/mpeg',
		size: 4,
		async arrayBuffer() {
			events.push('array-buffer');
			return Uint8Array.of(0x49, 0x44, 0x33, 0).buffer;
		},
	};
	return { events, file, service: createProjectImportService(runtime), stop };
}
