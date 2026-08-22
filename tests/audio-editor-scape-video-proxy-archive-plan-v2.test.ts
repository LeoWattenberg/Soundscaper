/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import * as archivePlanModule from '../src/common/editor/scape-video-proxy-archive-plan-v2.ts';
import {
	planScapeVideoProxyArchiveAssetsV2,
	type ScapeVideoProxyArchiveAssetDescriptorV2,
	type ScapeVideoProxyArchiveReferenceV2,
} from '../src/common/editor/scape-video-proxy-archive-plan-v2.ts';
import { SCAPE_FORMAT_VERSION } from '../src/common/editor/scape-archive-envelope.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_HEADER_BYTES,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset-reference.ts';

const ROOT = resolve(import.meta.dirname, '..');
const MODULE = 'src/common/editor/scape-video-proxy-archive-plan-v2.ts';
const TEST_MODULE = 'tests/audio-editor-scape-video-proxy-archive-plan-v2.test.ts';
const MODULE_STEM = 'scape-video-proxy-archive-plan-v2';
const PROXY_SHA = 'a'.repeat(64);
const TIMING_SHA = 'b'.repeat(64);
const FRAME_COUNT = 3;
const TIMING_BYTES = VIDEO_TIMING_ASSET_HEADER_BYTES + FRAME_COUNT * 8;

type MutableRecord = Record<PropertyKey, unknown>;

test('owns exactly two TypeScript declarations and one runtime export', async () => {
	assert.deepEqual(Object.keys(archivePlanModule), ['planScapeVideoProxyArchiveAssetsV2']);
	const source = await readSource(MODULE);
	const declarations = [...source.matchAll(
		/^export\s+(?:declare\s+)?(?:interface|type|function|class|const)\s+([A-Za-z0-9_]+)/gmu,
	)].map((match) => match[1]);
	assert.deepEqual(declarations, [
		'ScapeVideoProxyArchiveReferenceV2',
		'ScapeVideoProxyArchiveAssetDescriptorV2',
		'planScapeVideoProxyArchiveAssetsV2',
	]);
	assert.doesNotMatch(source, /export\s+(?:type\s+)?\{/u);
});

test('keeps all-null state on format 1 and maps one reference to exact format-2 assets', () => {
	assert.equal(SCAPE_FORMAT_VERSION, 1);
	const empty = planScapeVideoProxyArchiveAssetsV2([]);
	assert.deepEqual(empty, { formatVersion: 1, assets: [] });
	assert.equal(Object.isFrozen(empty), true);
	assert.equal(Object.isFrozen(empty.assets), true);

	const input = reference();
	const plan = planScapeVideoProxyArchiveAssetsV2([input]);
	assert.equal(plan.formatVersion, 2);
	assert.deepEqual(plan.assets, [proxyDescriptor(), timingDescriptor()]);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.assets), true);
	assert.ok(plan.assets.every((asset) => Object.isFrozen(asset)));
	assert.notEqual(plan.assets[0], input);
	assert.deepEqual(Object.keys(plan.assets[0]!), DESCRIPTOR_FIELDS);
	assert.deepEqual(Object.keys(plan.assets[1]!), DESCRIPTOR_FIELDS);

	(input as unknown as MutableRecord).mimeType = 'video/webm';
	(input.timingAsset as unknown as MutableRecord).timescale = 90_000;
	assert.deepEqual(plan.assets, [proxyDescriptor(), timingDescriptor()]);
});

test('deduplicates exact bodies and permits shared timing while rejecting conflicting identities', () => {
	assert.deepEqual(planScapeVideoProxyArchiveAssetsV2([reference(), reference()]).assets,
		[proxyDescriptor(), timingDescriptor()]);

	const secondSha = `c${'0'.repeat(63)}`;
	const sharedTiming = reference({
		storageKey: `video-proxy-sha256:${secondSha}`,
		sha256: secondSha,
		mimeType: 'video/webm',
		timingAsset: timing({ sourceSha256: secondSha }),
	});
	assert.deepEqual(planScapeVideoProxyArchiveAssetsV2([reference(), sharedTiming]).assets, [
		proxyDescriptor(),
		timingDescriptor(),
		proxyDescriptor({
			sourceId: `video-proxy-sha256:${secondSha}`,
			entry: `proxy/${secondSha}/body`,
			mimeType: 'video/webm',
			sha256: secondSha,
		}),
	]);

	for (const conflict of [
		reference({ byteLength: 124 }),
		reference({ mimeType: 'video/webm' }),
		reference({ timingAsset: timing({ timescale: 90_000 }) }),
	]) assert.throws(
		() => planScapeVideoProxyArchiveAssetsV2([reference(), conflict]),
		/conflict/iu,
	);
});

test('descriptor-snapshots the dense reference list and records with zero ordinary gets', () => {
	const referenceProbe = descriptorProbe(reference());
	const timingProbe = descriptorProbe(timing());
	const target = reference({ timingAsset: timingProbe.proxy });
	const referencesProbe = descriptorProbe([new Proxy(target, referenceProbe.handler)]);
	assert.deepEqual(planScapeVideoProxyArchiveAssetsV2(referencesProbe.proxy).assets,
		[proxyDescriptor(), timingDescriptor()]);
	assert.deepEqual(referencesProbe.hits, counts(1, 1, 2));
	assert.deepEqual(referenceProbe.hits, counts(1, 1, REFERENCE_FIELDS.length));
	assert.deepEqual(timingProbe.hits, counts(1, 1, TIMING_FIELDS.length));
});

test('refuses open, sparse, accessor, exotic, and malformed reference input', () => {
	class References extends Array<unknown> {}
	const sparse = Array(1);
	const extra = [reference()] as unknown[] & { extra?: boolean };
	extra.extra = true;
	const symbol = [reference()] as unknown as MutableRecord;
	symbol[Symbol('extra')] = true;
	for (const value of [
		null, undefined, false, 1, 'references', {}, new References(), sparse, extra, symbol,
	]) assert.throws(() => planScapeVideoProxyArchiveAssetsV2(value), TypeError);

	for (const [fields, make, consume] of [
		[REFERENCE_FIELDS, reference, (value: object) => planScapeVideoProxyArchiveAssetsV2([value])],
		[TIMING_FIELDS, timing, (value: object) => planScapeVideoProxyArchiveAssetsV2([
			reference({ timingAsset: value }),
		])],
	] as const) for (const field of fields) {
		const missing = make() as unknown as MutableRecord;
		delete missing[field];
		assert.throws(() => consume(missing), TypeError);
		const hidden = make() as unknown as MutableRecord;
		Object.defineProperty(hidden, field, { value: hidden[field], enumerable: false });
		assert.throws(() => consume(hidden), TypeError);
		let gets = 0;
		const accessor = make() as unknown as MutableRecord;
		Object.defineProperty(accessor, field, { enumerable: true,
			get() { gets += 1; return (make() as unknown as MutableRecord)[field]; } });
		assert.throws(() => consume(accessor), TypeError);
		assert.equal(gets, 0);
	}
});

test('propagates descriptor trap failures and refuses nonconforming proxy results', () => {
	for (const [target, consume] of [
		[[reference()], (value: object) => planScapeVideoProxyArchiveAssetsV2(value)],
		[reference(), (value: object) => planScapeVideoProxyArchiveAssetsV2([value])],
		[timing(), (value: object) => planScapeVideoProxyArchiveAssetsV2([
			reference({ timingAsset: value }),
		])],
	] as const) {
		for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const) {
			const proxy = new Proxy(target, {
				[trap]() { throw new Error(`${trap} failed`); },
			});
			assert.throws(() => consume(proxy), new RegExp(`${trap} failed`, 'u'));
		}
	}
	assert.throws(() => planScapeVideoProxyArchiveAssetsV2(new Proxy([reference()], {
		ownKeys() { return ['length']; },
	})), TypeError);
	assert.throws(() => planScapeVideoProxyArchiveAssetsV2([new Proxy(reference(), {
		getOwnPropertyDescriptor() { return undefined; },
	})]), TypeError);
});

test('enforces proxy identity, body bounds, timing binding, and the archive entry budget', () => {
	for (const invalid of [
		reference({ storageKey: `video-proxy-sha256:${'d'.repeat(64)}` }),
		reference({ sha256: PROXY_SHA.toUpperCase() }),
		reference({ mimeType: 'audio/mp4' }),
		reference({ mimeType: 'video/mp4;codecs=h264' }),
		reference({ byteLength: 0 }),
		reference({ byteLength: 512 * 1024 * 1024 + 1 }),
		reference({ timingAsset: timing({ sourceSha256: 'd'.repeat(64) }) }),
	]) assert.throws(() => planScapeVideoProxyArchiveAssetsV2([invalid]), /proxy|timing|digest|MIME|byte|bind/iu);

	const references = Array.from({ length: 2_048 }, (_, index) => {
		const suffix = index.toString(16).padStart(64, '0');
		const timingSuffix = (index + 2_048).toString(16).padStart(64, '0');
		return reference({
			storageKey: `video-proxy-sha256:${suffix}`,
			sha256: suffix,
			timingAsset: timing({
				storageKey: `video-timing-sha256:${timingSuffix}`,
				sha256: timingSuffix,
				sourceSha256: suffix,
			}),
		});
	});
	assert.equal(planScapeVideoProxyArchiveAssetsV2(references.slice(0, 2_047)).assets.length, 4_094);
	assert.throws(() => planScapeVideoProxyArchiveAssetsV2(references), /entry|asset|limit|many/iu);
});

test('has only closed reviewed consumers and cannot change the V17 archive owner', async () => {
	const references: string[] = [];
	for (const file of await sourceFiles(['src', 'desktop', 'scripts', 'tests'])) {
		if ((await readSource(file)).includes(MODULE_STEM)) references.push(file);
	}
	assert.deepEqual(references, [
		'src/framescaper/desktop-project-library-v10-renderer-contract.ts',
		// V25 extends the existing proxy archive relationship instead of creating a
		// parallel custody format.
		'src/framescaper/editor-project-v25-source-rebind.ts',
		'src/framescaper/scape-project-envelope-v18.ts',
		'src/framescaper/scape-project-preservation-v18-support.ts',
		'src/framescaper/scape-project-preservation-v18.ts',
		'tests/audio-editor-framescaper-scape-envelope-v18.test.ts',
		TEST_MODULE,
	]);
	const source = await readSource(MODULE);
	assert.deepEqual(importSpecifiers(source), ['./video-timing-asset-reference.ts']);
	assert.doesNotMatch(source,
		/project-runtime-profile|framescaper|soundscaper|scape-archive-envelope|SCAPE_FORMAT_VERSION|repository|storage\/|controller|desktop|productId|\bBlob\b|arrayBuffer|ReadableStream/iu);
	const v17Envelope = await readSource('src/common/editor/scape-archive-envelope.ts');
	assert.match(v17Envelope, /export const SCAPE_FORMAT_VERSION = 1;/u);
	assert.doesNotMatch(v17Envelope, /video-proxy/iu);
});

const REFERENCE_FIELDS = ['storageKey', 'mimeType', 'byteLength', 'sha256', 'timingAsset'] as const;
const TIMING_FIELDS = [
	'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength', 'frameCount',
	'timescale', 'finalFrameDurationTicks',
] as const;
const DESCRIPTOR_FIELDS = ['sourceId', 'kind', 'encoding', 'entry', 'mimeType', 'size', 'sha256'];

function reference(
	overrides: Readonly<Record<string, unknown>> = {},
): ScapeVideoProxyArchiveReferenceV2 {
	return {
		storageKey: `video-proxy-sha256:${PROXY_SHA}`,
		mimeType: 'video/mp4',
		byteLength: 123,
		sha256: PROXY_SHA,
		timingAsset: timing(),
		...overrides,
	} as ScapeVideoProxyArchiveReferenceV2;
}

function timing(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: `video-timing-sha256:${TIMING_SHA}`,
		sha256: TIMING_SHA,
		sourceSha256: PROXY_SHA,
		byteLength: TIMING_BYTES,
		frameCount: FRAME_COUNT,
		timescale: 1_000,
		finalFrameDurationTicks: '40',
		...overrides,
	};
}

function proxyDescriptor(
	overrides: Partial<ScapeVideoProxyArchiveAssetDescriptorV2> = {},
): ScapeVideoProxyArchiveAssetDescriptorV2 {
	return {
		sourceId: `video-proxy-sha256:${PROXY_SHA}`,
		kind: 'video-proxy',
		encoding: 'video-proxy-v1',
		entry: `proxy/${PROXY_SHA}/body`,
		mimeType: 'video/mp4',
		size: 123,
		sha256: PROXY_SHA,
		...overrides,
	};
}

function timingDescriptor(): ScapeVideoProxyArchiveAssetDescriptorV2 {
	return {
		sourceId: `video-timing-sha256:${TIMING_SHA}`,
		kind: 'video-timing',
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		entry: `timing/${TIMING_SHA}.scti`,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		size: TIMING_BYTES,
		sha256: TIMING_SHA,
	};
}

function counts(prototype: number, keys: number, descriptors: number) {
	return { prototype, keys, descriptors, gets: 0 };
}

function descriptorProbe<T extends object>(target: T) {
	const hits = { prototype: 0, keys: 0, descriptors: 0, gets: 0 };
	const handler: ProxyHandler<T> = {
		getPrototypeOf(value) { hits.prototype += 1; return Reflect.getPrototypeOf(value); },
		ownKeys(value) { hits.keys += 1; return Reflect.ownKeys(value); },
		getOwnPropertyDescriptor(value, key) {
			hits.descriptors += 1;
			return Reflect.getOwnPropertyDescriptor(value, key);
		},
		get() { hits.gets += 1; throw new Error('ordinary get invoked'); },
	};
	return { handler, hits, proxy: new Proxy(target, handler) };
}

async function sourceFiles(roots: readonly string[]): Promise<string[]> {
	const output: string[] = [];
	for (const root of roots) await visit(root);
	return output.sort();
	async function visit(relative: string): Promise<void> {
		for (const entry of await readdir(resolve(ROOT, relative), { withFileTypes: true })) {
			const child = `${relative}/${entry.name}`;
			if (entry.isDirectory()) await visit(child);
			else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) output.push(child);
		}
	}
}

async function readSource(relative: string): Promise<string> {
	return readFile(resolve(ROOT, relative), 'utf8');
}

function importSpecifiers(source: string): string[] {
	return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);
}
