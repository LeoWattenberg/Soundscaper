/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedOriginalBinding,
	normalizeLinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';

const SHA256 = 'ab'.repeat(32);

test('linked original bindings normalize closed discriminated audio and video declarations', () => {
	const audio = binding({
		kind: 'audio',
		mimeType: 'audio/wav',
		sourceShape: audioShape(),
	});
	const normalizedAudio = normalizeLinkedOriginalBinding(audio);
	assert.deepEqual(normalizedAudio, audio);
	assert.equal(normalizedAudio.kind, 'audio');
	assert.equal(Object.isFrozen(normalizedAudio), true);
	assert.equal(Object.isFrozen(normalizedAudio.sourceShape), true);

	const video = binding();
	const normalizedVideo = normalizeLinkedOriginalBinding(video);
	assert.deepEqual(normalizedVideo, video);
	assert.equal(normalizedVideo.kind, 'video');
	assert.equal(Object.isFrozen(normalizedVideo.sourceShape), true);
});

test('linked original binding reads schema-v1 rows as discriminated video without mutating them', () => {
	const legacy = legacyVideoBinding();
	const normalized = normalizeLinkedOriginalBinding(legacy);

	assert.deepEqual(normalized, {
		...legacy,
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'video',
	});
	assert.equal(Object.hasOwn(legacy, 'kind'), false);
	assert.equal(legacy.schemaVersion, 1);
});

test('linked original input excludes repository-owned fields and requires schema v2', () => {
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = binding({
		kind: 'audio',
		mimeType: 'audio/wav',
		sourceShape: audioShape(),
	});
	assert.deepEqual(normalizeLinkedOriginalBindingInput(input), input);
	assert.throws(
		() => normalizeLinkedOriginalBindingInput({ ...input, bindingToken: 'binding_attacker_token' }),
		/unsupported field/iu,
	);
	assert.throws(
		() => normalizeLinkedOriginalBindingInput({ ...input, schemaVersion: 1 }),
		/schema.*version/iu,
	);
});

test('linked original binding enforces kind-specific MIME and exact source geometry', () => {
	for (const candidate of [
		binding({ kind: 'audio', mimeType: 'video/mp4', sourceShape: audioShape() }),
		binding({ kind: 'video', mimeType: 'audio/wav' }),
		binding({ kind: 'audio', mimeType: 'audio/wav', sourceShape: videoShape() }),
		binding({ kind: 'video', sourceShape: audioShape() }),
	]) {
		assert.throws(() => normalizeLinkedOriginalBinding(candidate), /kind|media type|mimeType|source shape/iu);
	}
});

test('linked audio originals retain canonical project PCM geometry, not container encoding', () => {
	for (const sourceShape of [
		{ ...audioShape(), channelCount: 0 },
		{ ...audioShape(), frameCount: Number.MAX_SAFE_INTEGER + 1 },
		{ ...audioShape(), sampleRate: 0 },
		{ ...audioShape(), originalSampleRate: 1.5 },
		{ ...audioShape(), sampleFormat: 'int24' },
		{ ...audioShape(), chunkFrames: 0 },
		{ ...audioShape(), bitsPerSample: 24 },
	]) {
		assert.throws(
			() => normalizeLinkedOriginalBinding(binding({
				kind: 'audio',
				mimeType: 'audio/wav',
				sourceShape,
			})),
			/source shape|sourceShape|positive safe integer|float32/iu,
		);
	}
});

test('linked original bindings reject open rows, unknown kinds, and unsupported versions', () => {
	assert.throws(
		() => normalizeLinkedOriginalBinding({ ...binding(), path: '/private/original.mov' }),
		/unsupported field/iu,
	);
	assert.throws(
		() => normalizeLinkedOriginalBinding(binding({ kind: 'image' })),
		/kind/iu,
	);
	assert.throws(
		() => normalizeLinkedOriginalBinding(binding({ schemaVersion: 3 })),
		/schema.*version/iu,
	);
});

function binding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'video',
		projectId: 'project-linked-original',
		sourceId: 'source-linked-original',
		storageKey: 'storage-linked-original',
		locatorId: 'locator_01K1ZP5T8Q4V7N2M',
		locatorRevision: 'snapshot_01K1ZP5T8Q4V7N2M',
		mimeType: 'video/mp4',
		byteLength: 65_536,
		sha256: SHA256,
		sourceShape: videoShape(),
		bindingToken: 'binding_01K1ZP5T8Q4V7N2M',
		boundAt: '2026-08-02T10:11:12.345Z',
		...overrides,
	};
}

function legacyVideoBinding(): Record<string, unknown> {
	const { kind: _kind, ...legacy } = binding({ schemaVersion: 1 });
	return legacy;
}

function audioShape(): Record<string, unknown> {
	return {
		frameCount: 96_000,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 96_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	};
}

function videoShape(): Record<string, unknown> {
	return {
		frameCount: 96_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 29.97,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	};
}
