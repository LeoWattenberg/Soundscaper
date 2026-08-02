/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedVideoOriginalBinding,
	normalizeLinkedVideoOriginalBindingInput,
} from '../src/common/editor/storage/linked-video-original-binding.ts';

const SHA256 = 'ab'.repeat(32);

function binding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schemaVersion: LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId: 'project-linked-video',
		sourceId: 'source-linked-video',
		storageKey: 'storage-linked-video',
		locatorId: 'locator_01K1ZP5T8Q4V7N2M',
		locatorRevision: 'snapshot_01K1ZP5T8Q4V7N2M',
		mimeType: 'video/mp4',
		byteLength: 65_536,
		sha256: SHA256,
		sourceShape: {
			frameCount: 96_000,
			sampleRate: 48_000,
			width: 1_920,
			height: 1_080,
			frameRate: 29.97,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: true,
		},
		bindingToken: 'binding_01K1ZP5T8Q4V7N2M',
		boundAt: '2026-08-02T10:11:12.345Z',
		...overrides,
	};
}

test('linked video original binding normalizes a closed frozen v1 clone', () => {
	const input = binding();
	const normalized = normalizeLinkedVideoOriginalBinding(input);

	assert.notStrictEqual(normalized, input);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.sourceShape), true);
	assert.deepEqual(normalized, input);

	input.locatorId = 'locator_01K1ZP5T8Q4V7N2N';
	input.sha256 = 'cd'.repeat(32);
	assert.equal(normalized.locatorId, 'locator_01K1ZP5T8Q4V7N2M');
	assert.equal(normalized.sha256, SHA256);
	(input.sourceShape as Record<string, unknown>).width = 640;
	assert.equal(normalized.sourceShape.width, 1_920);
});

test('linked video original binding closes and validates exact persisted source geometry', () => {
	for (const sourceShape of [
		{ ...(binding().sourceShape as object), extra: true },
		{ ...(binding().sourceShape as object), width: 0 },
		{ ...(binding().sourceShape as object), frameRate: Number.NaN },
		{ ...(binding().sourceShape as object), videoCodec: '' },
		{ ...(binding().sourceShape as object), audioCodec: 4 },
		{ ...(binding().sourceShape as object), hasAudio: 1 },
	]) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ sourceShape })),
			/source shape|sourceShape/iu,
		);
	}
});

test('linked video original binding rejects unsupported versions and open fields', () => {
	assert.throws(
		() => normalizeLinkedVideoOriginalBinding(binding({ schemaVersion: 2 })),
		/schema.*version/iu,
	);
	for (const extra of [
		{ path: '/Users/editor/movie.mp4' },
		{ url: 'file:///Users/editor/movie.mp4' },
		{ generation: 2 },
		{ fence: 'separate-fence' },
		{ revisionToken: 'superseded-combined-token' },
	]) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding({ ...binding(), ...extra }),
			/unsupported field|closed/iu,
		);
	}
});

test('linked video original input cannot supply repository-owned fields', () => {
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = binding();
	assert.deepEqual(normalizeLinkedVideoOriginalBindingInput(input), input);
	assert.throws(
		() => normalizeLinkedVideoOriginalBindingInput({ ...input, bindingToken: 'binding_attacker_token' }),
		/unsupported field/iu,
	);
	assert.throws(
		() => normalizeLinkedVideoOriginalBindingInput({ ...input, boundAt: '2026-08-02T10:11:12.345Z' }),
		/unsupported field/iu,
	);
});

test('linked video original locator identity cannot expose paths or URLs', () => {
	for (const locatorId of [
		'/Users/editor/movie.mp4',
		'C:\\Users\\editor\\movie.mp4',
		'../media/movie.mp4',
		'file:///Volumes/media/movie.mp4',
		'https://media.example/movie.mp4',
		'video.mp4',
		'locator%2Fmovie',
	]) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ locatorId })),
			/locator.*opaque|path|URL/iu,
			locatorId,
		);
	}
});

test('linked video original binding validates exact content identity', () => {
	for (const sha256 of ['ab', 'AB'.repeat(32), 'g'.repeat(64), null]) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ sha256 })),
			/SHA-256|digest/iu,
		);
	}
	for (const byteLength of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '65536']) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ byteLength })),
			/byte.*length|positive safe integer/iu,
		);
	}
	for (const locatorRevision of ['', 'short', '../revision', 'https://example.test/revision', 4]) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ locatorRevision })),
			/locator.*revision|generation|fence/iu,
		);
	}
});

test('linked video original binding validates repository CAS fencing and timestamp', () => {
	for (const bindingToken of ['', 'short', '../binding', 'https://example.test/binding', 4]) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ bindingToken })),
			/binding.*token|CAS|fence/iu,
		);
	}
	for (const boundAt of [
		'',
		'2026-08-02',
		'2026-08-02T10:11:12Z',
		'2026-08-02T10:11:12.345+00:00',
		'2026-02-30T10:11:12.345Z',
		4,
	]) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ boundAt })),
			/boundAt|instant|timestamp/iu,
		);
	}
});

test('linked video original binding requires canonical source, storage, and video MIME identity', () => {
	for (const [field, value] of [
		['projectId', ''],
		['sourceId', ' source-linked-video'],
		['storageKey', 'storage-linked-video\u0000'],
		['mimeType', 'audio/mp4'],
		['mimeType', 'video/mp4; codecs=avc1'],
	] as const) {
		assert.throws(
			() => normalizeLinkedVideoOriginalBinding(binding({ [field]: value })),
			new RegExp(String(field), 'iu'),
		);
	}
});

test('linked video original binding accepts only plain own data fields', () => {
	assert.throws(() => normalizeLinkedVideoOriginalBinding(null), /object/iu);
	assert.throws(() => normalizeLinkedVideoOriginalBinding([]), /object/iu);

	const accessor = binding();
	Object.defineProperty(accessor, 'locatorId', {
		enumerable: true,
		get: () => 'locator_01K1ZP5T8Q4V7N2M',
	});
	assert.throws(
		() => normalizeLinkedVideoOriginalBinding(accessor),
		/data field|accessor/iu,
	);
});
