/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import {
	LinkedAudioOriginalSourceReader,
	LINKED_AUDIO_ORIGINAL_SOURCE_STORAGE_TYPE,
} from '../src/common/editor/storage/linked-audio-original-source-reader.ts';
import {
	LinkedOriginalResolver,
	type LinkedOriginalPort,
} from '../src/common/editor/storage/linked-original-resolver.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const NOW = '2026-08-02T10:11:12.345Z';
const LOCATOR_ID = 'locator_audio_000000000001';
const LOCATOR_REVISION = 'snapshot_audio_0000000001';

test('linked WAV source reads synthesize canonical metadata and bounded Float32 chunks', async () => {
	const body = waveBlob([
		Float32Array.of(-1, -0.5, 0, 0.5, 1),
		Float32Array.of(1, 0.5, 0, -0.5, -1),
	]);
	const loads: unknown[] = [];
	const fixture = linkedFixture({
		load(kind, locatorId, request) {
			loads.push({ kind, locatorId, request });
			return { blob: body, locatorRevision: LOCATOR_REVISION };
		},
	});
	const source = audioSource({
		frameCount: 5,
		channelCount: 2,
		chunkFrames: 2,
	});
	await fixture.resolver.bind('project-audio', source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
	});
	const reader = new LinkedAudioOriginalSourceReader({
		bindings: fixture.bindings,
		resolver: fixture.resolver,
	});

	assert.deepEqual(await reader.getMetadata(source.storageKey), {
		id: source.storageKey,
		sourceId: source.storageKey,
		storage: LINKED_AUDIO_ORIGINAL_SOURCE_STORAGE_TYPE,
		sourceToken: `linked-audio-v1:${LOCATOR_REVISION}:${fixture.bindingSha256()}`,
		baseSourceId: null,
		path: null,
		committedAt: NOW,
		kind: 'audio',
		mimeType: 'audio/wav',
		size: body.size,
		sha256: fixture.bindingSha256(),
		frameCount: 5,
		frameLength: 5,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
		chunkCount: 3,
	});
	assert.equal(loads.length, 1, 'metadata lookup must not materialize the original body');

	const middle = await reader.chunk(source.storageKey, 1);
	assert.deepEqual(chunkShape(middle), { index: 1, frames: 2 });
	assert.deepEqual([...middle.channels[0]], [0, 0.5]);
	assert.deepEqual([...middle.channels[1]], [0, -0.5]);
	assert.equal(loads.length, 2);

	const chunks = [];
	for await (const chunk of reader.chunks(source.storageKey)) chunks.push(chunk);
	assert.deepEqual(chunks.map(chunkShape), [
		{ index: 0, frames: 2 },
		{ index: 1, frames: 2 },
		{ index: 2, frames: 1 },
	]);
	assert.deepEqual([...chunks[2].channels[0]], [1]);
	assert.deepEqual([...chunks[2].channels[1]], [-1]);
	assert.equal(loads.length, 3, 'one sequential read must reuse one verified materialized body');
	assert.ok(loads.slice(1).every((load) => (
		(load as { kind: unknown }).kind === 'audio'
	)));
});

test('linked audio reads reject WAV geometry drift after exact body verification', async () => {
	const body = waveBlob([Float32Array.of(-1, 0, 1)]);
	const fixture = linkedFixture(stablePort(body));
	const source = audioSource({ frameCount: 4, channelCount: 1, chunkFrames: 2 });
	await fixture.resolver.bind('project-audio', source, LOCATOR_ID);
	const reader = new LinkedAudioOriginalSourceReader({
		bindings: fixture.bindings,
		resolver: fixture.resolver,
	});

	await assert.rejects(
		reader.chunk(source.storageKey, 0),
		/WAV.*geometry|geometry.*WAV|frame count/iu,
	);
});

test('linked audio reads enforce exact MIME and the maintained RIFF/RF64 dialects', async (context) => {
	await context.test('materialized MIME', async () => {
		const encoded = await waveBlob([Float32Array.of(-1, 0, 1)]).arrayBuffer();
		const body = new Blob([encoded], { type: 'audio/x-wav' });
		const fixture = linkedFixture(stablePort(body));
		const source = audioSource();
		await fixture.resolver.bind('project-audio', source, LOCATOR_ID);
		const reader = new LinkedAudioOriginalSourceReader({
			bindings: fixture.bindings,
			resolver: fixture.resolver,
		});
		await assert.rejects(reader.chunk(source.storageKey, 0), /MIME type.*changed/iu);
	});

	await context.test('BW64 dialect', async () => {
		const bytes = new Uint8Array(await waveBlob([Float32Array.of(-1, 0, 1)]).arrayBuffer());
		bytes.set(new TextEncoder().encode('BW64'), 0);
		const body = new Blob([bytes], { type: 'audio/wav' });
		const fixture = linkedFixture(stablePort(body));
		const source = audioSource();
		await fixture.resolver.bind('project-audio', source, LOCATOR_ID);
		const reader = new LinkedAudioOriginalSourceReader({
			bindings: fixture.bindings,
			resolver: fixture.resolver,
		});
		await assert.rejects(reader.chunk(source.storageKey, 0), /RIFF and RF64/iu);
	});
});

test('linked audio reads fail closed when an alias disappears during materialization', async () => {
	const body = waveBlob([Float32Array.of(-1, 0, 1)]);
	let loads = 0;
	let removeAlias: (() => Promise<boolean>) | null = null;
	let aliasToken = '';
	const fixture = linkedFixture({
		async load() {
			loads += 1;
			if (loads === 3) {
				assert.equal(await removeAlias?.(), true);
			}
			return { blob: body, locatorRevision: LOCATOR_REVISION };
		},
	});
	const first = audioSource({ id: 'source-a', storageKey: 'physical-audio', frameCount: 3 });
	const alias = audioSource({ id: 'source-z', storageKey: 'physical-audio', frameCount: 3 });
	await fixture.resolver.bind('project-a', first, LOCATOR_ID);
	aliasToken = (await fixture.resolver.bind('project-z', alias, LOCATOR_ID)).bindingToken;
	removeAlias = () => fixture.bindings.deleteIfCurrent('project-z', 'source-z', aliasToken);
	const reader = new LinkedAudioOriginalSourceReader({
		bindings: fixture.bindings,
		resolver: fixture.resolver,
	});

	await assert.rejects(
		reader.chunk(first.storageKey, 0),
		/alias.*changed|changed.*alias/iu,
	);
});

test('linked source fallback ignores video bindings and rejects over-limit materialized audio', async () => {
	const fixture = linkedFixture({ load: () => null });
	assert.ok(await fixture.bindings.putIfCurrent(videoBindingInput(), null));
	const reader = new LinkedAudioOriginalSourceReader({
		bindings: fixture.bindings,
		resolver: fixture.resolver,
	});
	assert.equal(await reader.getMetadata('physical-video'), null);

	assert.ok(await fixture.bindings.putIfCurrent(audioBindingInput({
		projectId: 'project-over-limit',
		sourceId: 'source-over-limit',
		storageKey: 'physical-over-limit',
		byteLength: 512 * 1024 ** 2 + 1,
	}), null));
	await assert.rejects(
		reader.getMetadata('physical-over-limit'),
		/materialized.*limit|limit.*materialized/iu,
	);
});

function linkedFixture(port: LinkedOriginalPort) {
	let token = 0;
	const memory = getMemoryDatabase(`linked-audio-reader-${Date.now()}-${Math.random()}`);
	const bindings = new LinkedOriginalRepository({ memory, database: async () => null }, {
		now: () => new Date(NOW),
		createBindingToken: () => `binding_token_${String(++token).padStart(8, '0')}`,
	});
	const resolver = new LinkedOriginalResolver(bindings, port);
	return {
		bindings,
		resolver,
		bindingSha256() {
			const records = [...memory.linkedVideoOriginalBindings.values()] as ReadonlyArray<{
				readonly binding: Readonly<{ readonly sha256: string }>;
			}>;
			return records[0]?.binding.sha256 ?? '';
		},
	};
}

function stablePort(body: Blob): LinkedOriginalPort {
	return {
		load(_kind, _locatorId, { expectedRevision }) {
			return { blob: body, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
		},
	};
}

function waveBlob(channels: readonly Float32Array[]): Blob {
	const encoded = encodeWav(channels, {
		float: true,
		dither: false,
		sampleRate: 48_000,
	});
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return new Blob([bytes], { type: 'audio/wav' });
}

function audioSource(overrides: Readonly<Record<string, unknown>> = {}) {
	return Object.freeze({
		kind: 'audio' as const,
		id: 'source-audio',
		storageKey: 'physical-audio',
		mimeType: 'audio/wav',
		frameCount: 3,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 2,
		...overrides,
	});
}

function audioBindingInput(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		schemaVersion: 2 as const,
		kind: 'audio' as const,
		projectId: 'project-audio',
		sourceId: 'source-audio',
		storageKey: 'physical-audio',
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
		mimeType: 'audio/wav',
		byteLength: 128,
		sha256: 'ab'.repeat(32),
		sourceShape: {
			frameCount: 3,
			channelCount: 1,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32' as const,
			chunkFrames: 2,
		},
		...overrides,
	};
}

function videoBindingInput() {
	return {
		schemaVersion: 2 as const,
		kind: 'video' as const,
		projectId: 'project-video',
		sourceId: 'source-video',
		storageKey: 'physical-video',
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_video_0000000001',
		mimeType: 'video/mp4',
		byteLength: 128,
		sha256: 'cd'.repeat(32),
		sourceShape: {
			frameCount: 1,
			sampleRate: 48_000,
			width: 1920,
			height: 1080,
			frameRate: 30,
			videoCodec: 'avc1',
			audioCodec: null,
			hasAudio: false,
		},
	};
}

function chunkShape(chunk: Readonly<{ index: unknown; frames: number }>) {
	return { index: chunk.index, frames: chunk.frames };
}
