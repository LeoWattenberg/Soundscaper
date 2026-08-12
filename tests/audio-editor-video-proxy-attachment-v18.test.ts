/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	normalizeVideoProxyAttachmentV18,
	VIDEO_PROXY_MAXIMUM_BODY_BYTES,
	type VideoProxyAttachmentV18,
} from '../src/common/editor/video-proxy-attachment-v18.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_HEADER_BYTES,
} from '../src/common/editor/video-timing-asset-reference.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_SHA256 = 'a'.repeat(64);
const ORIGINAL_SHA256 = 'b'.repeat(64);
const TIMING_SHA256 = 'c'.repeat(64);
const FRAME_COUNT = 3;
const BYTE_LENGTH = VIDEO_TIMING_ASSET_HEADER_BYTES + FRAME_COUNT * 8;

test('normalizes one exact detached frozen 19-field attachment', () => {
	assert.equal(VIDEO_PROXY_MAXIMUM_BODY_BYTES, 512 * 1024 * 1024);
	const input = attachment();
	const first = normalizeVideoProxyAttachmentV18(input);
	const second = normalizeVideoProxyAttachmentV18(input);
	assert.deepEqual(first, input);
	assert.deepEqual(second, first);
	assert.notStrictEqual(first, input);
	assert.notStrictEqual(first, second);
	assert.notStrictEqual(first.timingAsset, input.timingAsset);
	assert.notStrictEqual(first.timingAsset, second.timingAsset);
	assert.equal(Object.getPrototypeOf(first), Object.prototype);
	assert.equal(Object.getPrototypeOf(first.timingAsset), Object.prototype);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.timingAsset), true);
	(input as unknown as MutableRecord).generatorId = 'mutated';
	(input.timingAsset as unknown as MutableRecord).timescale = 90_000;
	assert.equal(first.generatorId, 'generator');
	assert.equal(first.timingAsset.timescale, 1_000);
	assert.deepEqual(Object.keys(first), ATTACHMENT_FIELDS);
});

test('requires exact own enumerable data fields without invoking accessors', () => {
	for (const field of ATTACHMENT_FIELDS) {
		const input = attachment() as unknown as MutableRecord;
		delete input[field];
		assert.throws(() => normalizeVideoProxyAttachmentV18(input), /field|closed|missing|attachment/iu, field);
	}
	for (const field of TIMING_FIELDS) {
		const input = attachment();
		delete (input.timingAsset as unknown as MutableRecord)[field];
		assert.throws(() => normalizeVideoProxyAttachmentV18(input), /field|closed|missing|timing/iu, field);
	}
	for (const nested of [false, true]) {
		for (const kind of ['extra', 'symbol', 'hidden', 'accessor'] as const) {
			const input = attachment();
			const target = nested ? input.timingAsset as unknown as object : input;
			let getterCalls = 0;
			if (kind === 'extra') Object.defineProperty(target, 'extra', { value: 1, enumerable: true });
			if (kind === 'symbol') Object.defineProperty(target, Symbol('extra'), { value: 1, enumerable: true });
			if (kind === 'hidden') Object.defineProperty(target, 'hidden', { value: 1, enumerable: false });
			if (kind === 'accessor') Object.defineProperty(target, nested ? 'timescale' : 'generatorId', {
				enumerable: true,
				get() { getterCalls += 1; return nested ? 1_000 : 'generator'; },
			});
			assert.throws(() => normalizeVideoProxyAttachmentV18(input), /accessor|closed|data|extra|field/iu);
			assert.equal(getterCalls, 0);
		}
	}
});

test('accepts plain null-prototype records and refuses other graph shapes', () => {
	class AttachmentRecord { constructor() { Object.assign(this, attachment()); } }
	class TimingRecord { constructor() { Object.assign(this, timing()); } }
	for (const value of [null, undefined, 1, 'attachment', [], new AttachmentRecord()]) {
		assert.throws(() => normalizeVideoProxyAttachmentV18(value), /attachment|object|plain|record/iu);
	}
	for (const timingAsset of [null, 1, 'timing', [], new TimingRecord()]) {
		assert.throws(() => normalizeVideoProxyAttachmentV18(attachment({ timingAsset })), /timing|object|plain|record/iu);
	}
	const input = Object.assign(Object.create(null) as object, attachment()) as VideoProxyAttachmentV18;
	(input as unknown as MutableRecord).timingAsset = Object.assign(Object.create(null) as object, timing());
	assert.deepEqual(normalizeVideoProxyAttachmentV18(input), attachment());
});

test('descriptor-snapshots each raw record once and never performs ordinary gets', () => {
	const outer = trapAudit(attachment());
	const nested = trapAudit(timing());
	const target = attachment({ timingAsset: nested.proxy });
	const normalized = normalizeVideoProxyAttachmentV18(new Proxy(target, outer.handler));
	assert.deepEqual(normalized, attachment());
	assert.deepEqual(outer.counts, {
		getPrototypeOf: 1,
		ownKeys: 1,
		getOwnPropertyDescriptor: ATTACHMENT_FIELDS.length,
		get: 0,
	});
	assert.deepEqual(nested.counts, {
		getPrototypeOf: 1,
		ownKeys: 1,
		getOwnPropertyDescriptor: TIMING_FIELDS.length,
		get: 0,
	});
	for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const) {
		const failing = trapAudit(attachment(), trap);
		assert.throws(() => normalizeVideoProxyAttachmentV18(failing.proxy), /trap failure/iu, trap);
		const nestedFailing = trapAudit(timing(), trap);
		assert.throws(() => normalizeVideoProxyAttachmentV18(attachment({ timingAsset: nestedFailing.proxy })),
			/trap failure/iu, `nested ${trap}`);
	}
	const wrongKeys = new Proxy(attachment(), { ownKeys: () => ['kind'] });
	assert.throws(() => normalizeVideoProxyAttachmentV18(wrongKeys), /closed|field|key/iu);
	const invalidDescriptor = new Proxy(attachment(), {
		getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, get: () => 'value' }),
	});
	assert.throws(() => normalizeVideoProxyAttachmentV18(invalidDescriptor), /accessor|data|descriptor/iu);
});

test('rejects every attachment scalar and local cross-field violation', () => {
	const cases: ReadonlyArray<readonly [string, (value: MutableRecord) => void]> = [
		['kind', (value) => { value.kind = 'proxy'; }],
		['version', (value) => { value.version = 2; }],
		['rule', (value) => { value.rule = 'other'; }],
		['storage key', (value) => { value.storageKey = `video-proxy-sha256:${'d'.repeat(64)}`; }],
		['zero bytes', (value) => { value.byteLength = 0; }],
		['fractional bytes', (value) => { value.byteLength = 1.5; }],
		['unsafe bytes', (value) => { value.byteLength = Number.MAX_SAFE_INTEGER + 1; }],
		['over bytes', (value) => { value.byteLength = VIDEO_PROXY_MAXIMUM_BODY_BYTES + 1; }],
		['proxy digest', (value) => { value.sha256 = PROXY_SHA256.toUpperCase(); }],
		['nonhex proxy digest', (value) => { value.sha256 = 'g'.repeat(64); }],
		['original digest', (value) => { value.originalSha256 = 'x'; }],
		['authority', (value) => { value.originalAuthorityKind = 'remote'; }],
		['fractional generator version', (value) => { value.generatorVersion = 1.5; }],
		['generator version', (value) => { value.generatorVersion = 0; }],
		['recipe version', (value) => { value.recipeVersion = Number.MAX_SAFE_INTEGER + 1; }],
		['timing rule', (value) => { value.timingRule = 'nearest-boundary'; }],
		['frame count', (value) => { value.frameCount = 0; }],
		['boundary count', (value) => { value.boundaryCount = FRAME_COUNT + 2; }],
		['unsafe boundary', (value) => { value.frameCount = Number.MAX_SAFE_INTEGER; value.boundaryCount = 1; }],
		['audio policy', (value) => { value.audioPolicy = 'use-proxy-audio'; }],
	];
	for (const [name, mutate] of cases) assertInvalid(name, mutate);
	assert.equal(normalizeVideoProxyAttachmentV18(attachment({ byteLength: VIDEO_PROXY_MAXIMUM_BODY_BYTES })).byteLength,
		VIDEO_PROXY_MAXIMUM_BODY_BYTES);
	assert.equal(normalizeVideoProxyAttachmentV18(attachment({ byteLength: 1 })).byteLength, 1);
	assert.equal(normalizeVideoProxyAttachmentV18(attachment({ originalAuthorityKind: 'linked' })).originalAuthorityKind,
		'linked');
});

test('enforces canonical video MIME and printable pathless provenance identifiers', () => {
	for (const mimeType of [
		'', 'Video/mp4', 'audio/mp4', 'video/', 'video/-mp4', 'video/.mp4', 'video/mp4;codecs=h264',
		'video/mp4@', 12, `video/${'a'.repeat(123)}`,
	]) assertInvalid(`mime ${mimeType}`, (value) => { value.mimeType = mimeType; });
	for (const field of ['generatorId', 'recipeId', 'timingBackendId'] as const) {
		for (const id of ['', ' leading', 'trailing ', 'path/name', 'path\\name', 'line\nbreak',
			'nonascii-é', `del-${String.fromCharCode(0x7f)}`, 'x'.repeat(129), 12]) {
			assertInvalid(`${field} ${JSON.stringify(id)}`, (value) => { value[field] = id; });
		}
	}
	assert.equal(normalizeVideoProxyAttachmentV18(attachment({ mimeType: 'video/x-matroska' })).mimeType,
		'video/x-matroska');
	const maxMime = `video/${'a'.repeat(122)}`;
	assert.equal(maxMime.length, 128);
	assert.equal(normalizeVideoProxyAttachmentV18(attachment({ mimeType: maxMime })).mimeType, maxMime);
	assert.equal(normalizeVideoProxyAttachmentV18(attachment({ mimeType: 'video/a!#$&^_.+-9' })).mimeType,
		'video/a!#$&^_.+-9');
	for (const field of ['generatorId', 'recipeId', 'timingBackendId'] as const) {
		const maxId = 'x'.repeat(128);
		assert.equal(normalizeVideoProxyAttachmentV18(attachment({ [field]: maxId }))[field], maxId);
		assert.equal(normalizeVideoProxyAttachmentV18(attachment({ [field]: 'valid interior space' }))[field],
			'valid interior space');
	}
});

test('descriptor-snapshots and validates the complete nested timing reference', () => {
	const cases: ReadonlyArray<readonly [string, (value: MutableRecord) => void]> = [
		['encoding', (value) => { value.encoding = 'timing-v2'; }],
		['storageKey', (value) => { value.storageKey = `video-timing-sha256:${'d'.repeat(64)}`; }],
		['sha256', (value) => { value.sha256 = 'z'; }],
		['sourceSha256', (value) => { value.sourceSha256 = ORIGINAL_SHA256; }],
		['byteLength', (value) => { value.byteLength = BYTE_LENGTH + 1; }],
		['frameCount', (value) => { value.frameCount = FRAME_COUNT + 1; }],
		['timescale', (value) => { value.timescale = 0; }],
		['final duration', (value) => { value.finalFrameDurationTicks = '0'; }],
	];
	for (const [name, mutate] of cases) {
		const input = attachment();
		mutate(input.timingAsset as unknown as MutableRecord);
		assert.throws(() => normalizeVideoProxyAttachmentV18(input), /attachment|timing|digest|frame|summary|source|storage/iu, name);
	}
	const frameMismatch = attachment({ frameCount: FRAME_COUNT + 1, boundaryCount: FRAME_COUNT + 2 });
	assert.throws(() => normalizeVideoProxyAttachmentV18(frameMismatch), /frame|timing/iu);
});

test('remains an isolated dormant scalar owner', () => {
	const sourceFile = 'src/common/editor/video-proxy-attachment-v18.ts';
	const source = fs.readFileSync(path.join(ROOT, sourceFile), 'utf8');
	assert.match(source, /from ['"]\.\/video-timing-asset-reference\.ts['"]/u);
	assert.deepEqual(
		[...source.matchAll(/export (?:const|interface|function)\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
		['VIDEO_PROXY_MAXIMUM_BODY_BYTES', 'VideoProxyAttachmentV18', 'normalizeVideoProxyAttachmentV18'],
	);
	assert.doesNotMatch(source,
		/video-timing-asset\.ts|video-timing-storage|candidate-observation|proxy-relationship|project-|storage\/|controller\/|ui\/|repository|capabilit|scape-|desktop|app\./u);
	for (const root of ['src', 'desktop', 'scripts']) for (const file of sourceFiles(path.join(ROOT, root))) {
		const relative = path.relative(ROOT, file).replaceAll(path.sep, '/');
		if (relative === sourceFile) continue;
		assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /video-proxy-attachment-v18/u, relative);
	}
});

const ATTACHMENT_FIELDS = [
	'kind', 'version', 'rule', 'storageKey', 'mimeType', 'byteLength', 'sha256',
	'originalSha256', 'originalAuthorityKind', 'generatorId', 'generatorVersion',
	'recipeId', 'recipeVersion', 'timingBackendId', 'timingRule', 'frameCount',
	'boundaryCount', 'timingAsset', 'audioPolicy',
] as const;
const TIMING_FIELDS = [
	'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength', 'frameCount',
	'timescale', 'finalFrameDurationTicks',
] as const;
type MutableRecord = Record<string, unknown>;

function attachment(overrides: Readonly<Record<string, unknown>> = {}): VideoProxyAttachmentV18 {
	return {
		kind: 'video-proxy-attachment',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA256}`,
		mimeType: 'video/mp4',
		byteLength: 123,
		sha256: PROXY_SHA256,
		originalSha256: ORIGINAL_SHA256,
		originalAuthorityKind: 'owned',
		generatorId: 'generator',
		generatorVersion: 1,
		recipeId: 'recipe',
		recipeVersion: 1,
		timingBackendId: 'exact-probe',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: FRAME_COUNT,
		boundaryCount: FRAME_COUNT + 1,
		timingAsset: timing(),
		audioPolicy: 'ignore-proxy-container-audio-v1',
		...overrides,
	} as VideoProxyAttachmentV18;
}

function timing(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: `video-timing-sha256:${TIMING_SHA256}`,
		sha256: TIMING_SHA256,
		sourceSha256: PROXY_SHA256,
		byteLength: BYTE_LENGTH,
		frameCount: FRAME_COUNT,
		timescale: 1_000,
		finalFrameDurationTicks: '40',
		...overrides,
	};
}

function assertInvalid(name: string, mutate: (value: MutableRecord) => void): void {
	const input = attachment() as unknown as MutableRecord;
	mutate(input);
	assert.throws(() => normalizeVideoProxyAttachmentV18(input), /attachment|invalid|must|require|unsupported|mismatch|exceed/iu, name);
}

function trapAudit<T extends object>(target: T, failing?: keyof TrapCounts) {
	const counts: TrapCounts = { getPrototypeOf: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, get: 0 };
	const hit = (trap: keyof TrapCounts): void => {
		counts[trap] += 1;
		if (trap === failing) throw new Error(`trap failure: ${trap}`);
	};
	const handler: ProxyHandler<T> = {
		getPrototypeOf(value) { hit('getPrototypeOf'); return Reflect.getPrototypeOf(value); },
		ownKeys(value) { hit('ownKeys'); return Reflect.ownKeys(value); },
		getOwnPropertyDescriptor(value, key) {
			hit('getOwnPropertyDescriptor');
			return Reflect.getOwnPropertyDescriptor(value, key);
		},
		get(value, key, receiver) { hit('get'); return Reflect.get(value, key, receiver); },
	};
	return { counts, handler, proxy: new Proxy(target, handler) };
}

interface TrapCounts {
	getPrototypeOf: number;
	ownKeys: number;
	getOwnPropertyDescriptor: number;
	get: number;
}

function sourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const resolved = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...sourceFiles(resolved));
		else if (/\.(?:js|jsx|ts|tsx)$/u.test(entry.name)) files.push(resolved);
	}
	return files;
}
