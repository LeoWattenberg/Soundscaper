/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeCarrierSourceResolverNativeMedia,
} from '../src/framescaper/editor-native-render-source-resolver.ts';

type Data = Record<string, unknown>;

const PACK_SHA256 = 'ab'.repeat(32);
const INVENTORY_SHA256 = 'cd'.repeat(32);
const REQUEST = Object.freeze({ signal: new AbortController().signal });

const IMAGE_SEQUENCE: Data = Object.freeze({
	kind: 'video', sourceType: 'image-sequence', version: 1,
	id: 'sequence-1', name: 'Sequence', stem: 'shot.', extension: 'png',
	frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 2, frameCount: 2,
	frameRate: { num: 24, den: 1 },
	inventory: {
		kind: 'image-sequence-inventory', version: 1,
		storageKey: `image-sequence-inventory-sha256:${INVENTORY_SHA256}`,
		sha256: INVENTORY_SHA256, byteLength: 256,
		frameCount: 2, firstFrameNumber: 1, lastFrameNumber: 2,
	},
	sourcePack: {
		kind: 'image-sequence-source-pack',
		storageKey: `image-sequence-pack-sha256:${PACK_SHA256}`,
		sha256: PACK_SHA256, byteLength: 512,
	},
	characteristics: {
		backend: 'framescaper-media-host', codedWidth: 2, codedHeight: 2, hasAlpha: false,
		videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgb24', chromaFormat: '4:4:4',
		alphaMode: null, alphaInterpretation: null,
		colour: {
			primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full',
			masteringDisplay: null, contentLight: null,
		},
	},
});

const PROJECT: Data = Object.freeze({
	id: 'project-1',
	revision: 2,
	sources: [{ kind: 'video', id: 'sequence-1', imageSequence: IMAGE_SEQUENCE }],
});

const SEQUENCE_ASSET: Data = Object.freeze({
	sourceId: 'sequence-1', identity: PACK_SHA256, clipIds: ['clip-1'],
	decodedWidth: 2, decodedHeight: 2, displayWidth: 2, displayHeight: 2,
	presentationForEntry: () => ({}),
});

const ORDINARY_ASSET: Data = Object.freeze({
	sourceId: 'plain-video', identity: 'plain-identity', clipIds: ['clip-2'],
	decodedWidth: 8, decodedHeight: 8, displayWidth: 8, displayHeight: 8,
	presentationForEntry: () => ({}),
});

const BRIDGE: Data = Object.freeze({
	decodeImageSequenceSource: () => undefined,
	cancelImageSequenceDecode: () => undefined,
	readImageSequenceDecode: () => undefined,
	releaseImageSequenceDecode: () => undefined,
});

function dependencies(overrides: Data = {}, disposed: string[] = []): never {
	return {
		createHtmlResolver: () => ({
			resolveSource: () => 'html',
			dispose: () => { disposed.push('html'); },
		}),
		createImageSequenceResolver: () => ({
			resolveSource: () => 'sequence',
			dispose: () => { disposed.push('sequence'); },
		}),
		nativeBridge: () => BRIDGE,
		createCanvas: () => ({}),
		assertCurrent: () => undefined,
		...overrides,
	} as unknown as never;
}

function resolver(assets: readonly Data[], overrides: Data = {}, disposed: string[] = []): Data {
	return createFramescaperNativeCarrierSourceResolverNativeMedia(
		assets as never,
		PROJECT as never,
		dependencies(overrides, disposed),
	) as unknown as Data;
}

function resolve(carrier: Data, sourceId: string): unknown {
	return (carrier.resolveSource as (entry: Data, request: Data) => unknown)(
		{ sourceId },
		REQUEST as unknown as Data,
	);
}

test('a custom image-sequence source is never handed to the HTML video resolver', () => {
	const carrier = resolver([ORDINARY_ASSET, SEQUENCE_ASSET]);

	assert.equal(resolve(carrier, 'sequence-1'), 'sequence');
	assert.equal(resolve(carrier, 'plain-video'), 'html');
});

test('every resolution first reasserts that the carrier is still current', () => {
	let asserted = 0;
	const carrier = resolver([ORDINARY_ASSET], { assertCurrent: () => { asserted += 1; } });

	resolve(carrier, 'plain-video');
	resolve(carrier, 'plain-video');

	assert.equal(asserted, 2);
});

test('a carrier entry must carry its own enumerable source identity', () => {
	const carrier = resolver([ORDINARY_ASSET]);
	const resolveSource = carrier.resolveSource as (entry: unknown, request: unknown) => unknown;

	assert.throws(() => resolveSource({}, REQUEST), TypeError);
	assert.throws(() => resolveSource(Object.create({ sourceId: 'plain-video' }), REQUEST), TypeError);
	assert.throws(
		() => resolveSource(
			Object.defineProperty({}, 'sourceId', { get: () => 'plain-video', enumerable: true }),
			REQUEST,
		),
		TypeError,
	);
});

test('a carrier with no ordinary assets refuses an ordinary source outright', () => {
	const carrier = resolver([SEQUENCE_ASSET]);

	assert.throws(() => resolve(carrier, 'plain-video'), ReferenceError);
});

test('a sequence asset whose geometry or pack identity drifted is refused at admission', () => {
	assert.throws(
		() => resolver([{ ...SEQUENCE_ASSET, decodedWidth: 99 }]),
		/geometry or pack identity changed/u,
	);
	assert.throws(
		() => resolver([{ ...SEQUENCE_ASSET, identity: 'ef'.repeat(32) }]),
		/geometry or pack identity changed/u,
	);
});

test('a sequence carrier requires both a decode bridge and a valid project identity', () => {
	assert.throws(
		() => resolver([SEQUENCE_ASSET], { nativeBridge: () => null }),
		/image-sequence decode bridge is unavailable/u,
	);
	assert.throws(
		() => createFramescaperNativeCarrierSourceResolverNativeMedia(
			[SEQUENCE_ASSET] as never,
			{ ...PROJECT, revision: -1 } as never,
			dependencies(),
		),
		TypeError,
	);
});

test('a failed sequence setup disposes the HTML resolver it already built', () => {
	const disposed: string[] = [];
	const failure = new Error('sequence setup failed');

	assert.throws(
		() => resolver(
			[ORDINARY_ASSET, SEQUENCE_ASSET],
			{ createImageSequenceResolver: () => { throw failure; } },
			disposed,
		),
		(error: unknown) => {
			assert.equal(error, failure);
			return true;
		},
	);
	assert.deepEqual(disposed, ['html'], 'a half-built carrier must not leak its HTML resolver');
});

test('a cleanup that also fails reports both errors while keeping the setup cause', () => {
	const setupFailure = new Error('sequence setup failed');
	const cleanupFailure = new Error('html close failed');

	assert.throws(() => resolver([ORDINARY_ASSET, SEQUENCE_ASSET], {
		createHtmlResolver: () => ({
			resolveSource: () => 'html',
			dispose: () => { throw cleanupFailure; },
		}),
		createImageSequenceResolver: () => { throw setupFailure; },
	}), (error: AggregateError) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [setupFailure, cleanupFailure]);
		assert.equal(error.cause, setupFailure);
		return true;
	});
});

test('disposal closes both resolvers', async () => {
	const disposed: string[] = [];
	const carrier = resolver([ORDINARY_ASSET, SEQUENCE_ASSET], {}, disposed);

	await (carrier.dispose as () => Promise<void>)();

	assert.deepEqual([...disposed].sort(), ['html', 'sequence']);
});

test('disposal reports every resolver that refused to close', async () => {
	const carrier = resolver([ORDINARY_ASSET], {
		createHtmlResolver: () => ({
			resolveSource: () => 'html',
			dispose: () => { throw new Error('html close failed'); },
		}),
	});

	await assert.rejects(
		() => (carrier.dispose as () => Promise<void>)(),
		(error: AggregateError) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors.map((value: Error) => value.message), ['html close failed']);
			return true;
		},
	);
});

test('a carrier with no resolvers at all disposes cleanly', async () => {
	const carrier = resolver([]);

	await assert.doesNotReject(() => (carrier.dispose as () => Promise<void>)());
});
