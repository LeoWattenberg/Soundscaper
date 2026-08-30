/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	acquireFramescaperDesktopBodies,
} from '../src/framescaper/desktop-project-library-body-transfer.ts';
import {
	FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES as MAXIMUM_CHUNK_BYTES,
	prepareFramescaperDesktopCorePublicationBodies as prepareBodies,
	validateFramescaperDesktopCoreBodies as validateBodies,
} from '../src/framescaper/desktop-project-library-core-body-transfer.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;

const SHA256 = 'ab'.repeat(32);

function project(): never {
	return createFramescaperProject(PROFILE, {} as never) as unknown as never;
}

function body(overrides: Data = {}): Data {
	return {
		kind: 'video-original',
		encoding: 'framescaper-video-original-v1',
		sourceId: 'video-source',
		storageKey: `media-sha256:${SHA256}`,
		mimeType: 'video/mp4',
		byteLength: 1_024,
		sha256: SHA256,
		...overrides,
	};
}

function validate(bodies: unknown): readonly unknown[] {
	return validateBodies(project(), SHA256, bodies);
}

test('the maximum body chunk is published as a bounded transfer unit', () => {
	assert.ok(Number.isSafeInteger(MAXIMUM_CHUNK_BYTES));
	assert.ok(MAXIMUM_CHUNK_BYTES > 0);
});

test('a project with no durable bodies validates and prepares an empty inventory', async () => {
	assert.deepEqual(validate([]), []);
	assert.deepEqual(
		await prepareBodies(project(), SHA256, { loadSource: async () => null } as never),
		[],
	);
});

test('a body inventory must be a bounded dense array', () => {
	assert.throws(() => validate('bodies'), /must be a bounded dense array/u);

	const sparse: unknown[] = [];
	sparse.length = 2;
	assert.throws(() => validate(sparse), /must be a bounded dense array/u);
});

test('a body kind outside the three durable kinds is refused', () => {
	assert.throws(() => validate([body({ kind: 'project-document' })]), /body kind is unsupported/u);
});

test('each durable kind is bound to its own encoding', () => {
	assert.throws(
		() => validate([body({ encoding: 'video-proxy-v1' })]),
		/body encoding is unsupported/u,
	);
	assert.throws(
		() => validate([body({ kind: 'video-timing', encoding: 'framescaper-video-original-v1' })]),
		/body encoding is unsupported/u,
	);
});

test('a body descriptor must carry a positive byte length', () => {
	assert.throws(() => validate([body({ byteLength: 0 })]), /body length is invalid/u);
	assert.throws(() => validate([body({ byteLength: -1 })]), /body length is invalid/u);
});

test('a body the project never referenced is refused as unbound', () => {
	assert.throws(() => validate([body()]), /body identity is invalid/u);
});

test('a proxy body carries a binding identity the other kinds do not', () => {
	assert.throws(
		() => validate([body({ kind: 'video-proxy', encoding: 'video-proxy-v1' })]),
		/missing or unsupported fields/u,
	);
	assert.throws(
		() => validate([body({ bindingId: 'binding-1' })]),
		/missing or unsupported fields/u,
	);
});

test('acquisition does not fetch a body that was already verified locally', async () => {
	const bytes = new TextEncoder().encode('already retained video body');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const storageKey = `media-sha256:${sha256}`;
	const source = createVideoSource({
		id: 'retained-video', name: 'retained.mp4', storageKey, mimeType: 'video/mp4',
		contentSha256: sha256, sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 640, height: 360, videoCodec: 'h264',
	});
	const candidate = createFramescaperProject(PROFILE, { sources: [source] } as never);
	const descriptor = Object.freeze({
		kind: 'video-original', encoding: 'framescaper-video-original-v1',
		sourceId: storageKey, storageKey, mimeType: 'video/mp4',
		byteLength: bytes.byteLength, sha256,
	});
	let readCount = 0;
	await acquireFramescaperDesktopBodies(candidate, SHA256, [descriptor], {
		async readBodyChunk() {
			readCount += 1;
			throw new Error('an already retained body must not cross the desktop bridge');
		},
	}, {
		getMediaAssetMetadata: () => ({
			sourceId: storageKey, mimeType: descriptor.mimeType,
			size: bytes.byteLength, sha256,
		}),
		loadMediaAsset: () => new Blob([bytes]),
		beginMediaAssetWrite: async () => {
			throw new Error('an already retained body must not be rewritten');
		},
	} as never);
	assert.equal(readCount, 0);
});
