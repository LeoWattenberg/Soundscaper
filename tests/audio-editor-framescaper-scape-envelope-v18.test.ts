/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
} from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	inspectFramescaperScapeProjectEnvelopeV18,
} from '../src/framescaper/scape-project-envelope-v18.ts';

const ROOT = resolve(import.meta.dirname, '..');
const MODULE = 'src/framescaper/scape-project-envelope-v18.ts';
const TEST_MODULE = 'tests/audio-editor-framescaper-scape-envelope-v18.test.ts';
const ORIGINAL_SHA = '12'.repeat(32);
const PROXY_SHA = '34'.repeat(32);
const TIMING_SHA = '56'.repeat(32);
const PROJECT_SHA = '78'.repeat(32);

test('authenticates the exact V18 profile before manifest or project traversal', () => {
	let manifestReads = 0;
	let projectReads = 0;
	const manifest = new Proxy({}, { get() { manifestReads += 1; throw new Error('manifest read'); } });
	const project = new Proxy({}, { get() { projectReads += 1; throw new Error('project read'); } });
	for (const profile of [null, {}, structuredClone({})]) assert.throws(
		() => inspectFramescaperScapeProjectEnvelopeV18(profile, manifest, project),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.equal(manifestReads, 0);
	assert.equal(projectReads, 0);
});

test('admits all-null V18 as format 1 and exact attached V18 as format 2', () => {
	const allNull = project();
	const format1 = inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		manifest(allNull, 1, []),
		allNull,
	);
	assert.deepEqual(format1, {
		status: 'metadata-ready', formatVersion: 1, project: allNull, proxyAssets: [],
	});
	assert.equal(Object.isFrozen(format1), true);
	assert.equal(Object.isFrozen(format1.proxyAssets), true);

	const attached = attach(project());
	const expected = proxyAssets();
	const format2 = inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		manifest(attached, 2, expected),
		attached,
	);
	assert.deepEqual(format2, {
		status: 'metadata-ready', formatVersion: 2, project: attached, proxyAssets: expected,
	});
	assert.equal(Object.isFrozen(format2), true);
	assert.ok(format2.proxyAssets.every((asset) => Object.isFrozen(asset)));
});

test('enforces the complete format, schema, and attachment matrix before nested traversal', () => {
	const allNull = project();
	const attached = attach(project());
	assert.throws(() => inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		manifest(allNull, 2, []),
		allNull,
	), /format 2.*attachment|attachment.*format 2/iu);
	assert.throws(() => inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		manifest(attached, 1, proxyAssets()),
		attached,
	), /format 1.*attachment|attachment.*format 2/iu);

	let projectReads = 0;
	const hostile = new Proxy({}, { get() { projectReads += 1; throw new Error('project traversal'); } });
	assert.throws(() => inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ ...manifest(allNull, 1, []), formatVersion: 3 },
		hostile,
	), /unsupported.*format version.*3/iu);
	assert.equal(projectReads, 0);

	let nestedReads = 0;
	const v17 = { schemaVersion: 17, sources: new Proxy([], {
		get() { nestedReads += 1; throw new Error('nested traversal'); },
	}) };
	assert.throws(() => inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ ...manifest(allNull, 2, []), project: {
			...manifest(allNull, 2, []).project, schemaVersion: 17,
		} },
		v17,
	), /format 2.*schema 18|schema version.*18/iu);
	assert.equal(nestedReads, 0);
});

test('refuses missing, duplicate, tampered, conflicting, and orphan proxy descriptors', () => {
	const attached = attach(project());
	const expected = proxyAssets();
	const inspect = (assets: readonly Record<string, unknown>[]) =>
		inspectFramescaperScapeProjectEnvelopeV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			manifest(attached, 2, assets),
			attached,
		);
	for (const index of [0, 1] as const) for (const [field, replacement] of [
		['sourceId', 'tampered-source'],
		['kind', 'video'],
		['encoding', 'tampered-encoding'],
		['entry', 'tampered/entry'],
		['mimeType', 'application/octet-stream'],
		['size', 999],
		['sha256', 'ab'.repeat(32)],
	] as const) {
		const assets = structuredClone(expected) as Record<string, unknown>[];
		assets[index]![field] = replacement;
		assert.throws(() => inspect(assets), /proxy|timing|descriptor|missing|orphan|conflict/iu,
			`${expected[index]?.kind}.${field}`);
	}
	assert.throws(() => inspect(expected.slice(1)), /missing.*proxy|descriptor/iu);
	assert.throws(() => inspect([...expected, { ...expected[0]! }]), /duplicate|conflict/iu);
	assert.throws(() => inspect([...expected, orphanProxy()]), /orphan|unexpected|descriptor/iu);
	assert.throws(() => inspect([...expected, orphanTiming()]), /orphan|unexpected|descriptor/iu);
});

test('rejects descriptor accessors without running them and cancellation exposes zero body I/O', async () => {
	const attached = attach(project());
	const assets = structuredClone(proxyAssets()) as Record<string, unknown>[];
	let getterCalls = 0;
	Object.defineProperty(assets[0], 'size', {
		enumerable: true,
		get() { getterCalls += 1; return 123; },
	});
	assert.throws(() => inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		manifest(attached, 2, assets),
		attached,
	), /data property|descriptor/iu);
	assert.equal(getterCalls, 0);
	const probedManifest = manifest(attached, 2, proxyAssets());
	let ordinaryGets = 0;
	probedManifest.assets = new Proxy(probedManifest.assets as unknown[], {
		get(target, key, receiver) {
			ordinaryGets += 1;
			return Reflect.get(target, key, receiver);
		},
	});
	assert.equal(inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		probedManifest,
		attached,
	).status, 'metadata-ready');
	assert.equal(ordinaryGets, 0);

	const coherent = proxyAssets();
	const cancelled = inspectFramescaperScapeProjectEnvelopeV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		manifest(attached, 2, coherent),
		attached,
		'cancel',
	);
	assert.deepEqual(cancelled, {
		status: 'cancelled', formatVersion: 2, project: attached, proxyAssets: coherent,
	});
	const source = await readFile(resolve(ROOT, MODULE), 'utf8');
	assert.doesNotMatch(source,
		/\b(?:getData|readBody|writeBody|beginMediaAssetWrite|loadMediaAsset|saveProject|store|repository|Blob|ReadableStream|WritableStream)\b/u);
});

test('stays within the dormant V18 preservation path and leaves the V17 archive envelope unchanged', async () => {
	const references: string[] = [];
	for (const file of await sourceFiles(['src', 'desktop', 'scripts', 'tests'])) {
		if ((await readFile(resolve(ROOT, file), 'utf8')).includes('scape-project-envelope-v18')) {
			references.push(file);
		}
	}
	assert.deepEqual(references, [
		'src/framescaper/scape-project-file-envelope-v18.ts',
		'src/framescaper/scape-project-preservation-v18.ts',
		'tests/audio-editor-framescaper-project-runtime-profile.test.ts',
		TEST_MODULE,
		'tests/audio-editor-scape-video-proxy-archive-plan-v2.test.ts',
		'tests/audio-editor-video-proxy-attachment-v18.test.ts',
	]);
	const source = await readFile(resolve(ROOT, MODULE), 'utf8');
	assert.match(source, /assertFramescaperProjectV18Profile/u);
	assert.match(source, /validateFramescaperProjectV18/u);
	assert.match(source, /planScapeVideoProxyArchiveAssetsV2/u);
	assert.doesNotMatch(source, /productId|selector|bootstrap|controller|desktop|scape-archive-envelope/iu);
	const v17Envelope = await readFile(resolve(ROOT, 'src/common/editor/scape-archive-envelope.ts'), 'utf8');
	assert.match(v17Envelope, /export const SCAPE_FORMAT_VERSION = 1;/u);
	assert.doesNotMatch(v17Envelope, /video-proxy/iu);
});

function project(): ReturnType<typeof createFramescaperProjectV18> {
	return createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v18-archive', title: 'Framescaper archive', now: '2026-08-13T10:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: ORIGINAL_SHA, frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
}

function attach(value: ReturnType<typeof project>): ReturnType<typeof project> {
	const attached = structuredClone(value) as unknown as Record<string, unknown>;
	((attached.sources as Record<string, unknown>[])[0]!).proxyAttachment = attachment();
	const baselineRequirements = attached.featureRequirements as {
		schemaVersion: 2;
		requirements: Record<string, unknown>[];
	};
	attached.featureRequirements = {
		schemaVersion: baselineRequirements.schemaVersion,
		requirements: [...baselineRequirements.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return attached as unknown as ReturnType<typeof project>;
}

function attachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA}`, mimeType: 'video/mp4', byteLength: 123,
		sha256: PROXY_SHA, originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${TIMING_SHA}`,
			sha256: TIMING_SHA, sourceSha256: PROXY_SHA, byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function manifest(
	value: Readonly<Record<string, unknown>>,
	formatVersion: number,
	proxy: readonly Record<string, unknown>[],
): Record<string, unknown> & { project: Record<string, unknown> } {
	return {
		format: 'scape-project', formatVersion, createdAt: '2026-08-13T10:00:00.000Z',
		project: {
			entry: 'project.json', mimeType: 'application/json', schemaVersion: value.schemaVersion,
			size: 4_096, sha256: PROJECT_SHA,
		},
		assets: [originalAsset(), ...proxy],
	};
}

function originalAsset(): Record<string, unknown> {
	return {
		sourceId: 'video-source', kind: 'video', encoding: 'original',
		entry: 'media/video-source/original', mimeType: 'video/mp4', size: 1_024,
		sha256: ORIGINAL_SHA,
	};
}

function proxyAssets(): Record<string, unknown>[] {
	return [{
		sourceId: `video-proxy-sha256:${PROXY_SHA}`, kind: 'video-proxy',
		encoding: 'video-proxy-v1', entry: `proxy/${PROXY_SHA}/body`, mimeType: 'video/mp4',
		size: 123, sha256: PROXY_SHA,
	}, {
		sourceId: `video-timing-sha256:${TIMING_SHA}`, kind: 'video-timing',
		encoding: 'soundscaper-video-timing-v1', entry: `timing/${TIMING_SHA}.scti`,
		mimeType: 'application/vnd.soundscaper.video-timing', size: 112, sha256: TIMING_SHA,
	}];
}

function orphanProxy(): Record<string, unknown> {
	const sha256 = '9a'.repeat(32);
	return {
		sourceId: `video-proxy-sha256:${sha256}`, kind: 'video-proxy', encoding: 'video-proxy-v1',
		entry: `proxy/${sha256}/body`, mimeType: 'video/mp4', size: 7, sha256,
	};
}

function orphanTiming(): Record<string, unknown> {
	const sha256 = 'bc'.repeat(32);
	return {
		sourceId: `video-timing-sha256:${sha256}`, kind: 'video-timing',
		encoding: 'soundscaper-video-timing-v1', entry: `timing/${sha256}.scti`,
		mimeType: 'application/vnd.soundscaper.video-timing', size: 112, sha256,
	};
}

async function sourceFiles(directories: readonly string[]): Promise<string[]> {
	const files: string[] = [];
	for (const directory of directories) {
		for (const entry of await readdir(resolve(ROOT, directory), { withFileTypes: true })) {
			const relative = `${directory}/${entry.name}`;
			if (entry.isDirectory()) files.push(...await sourceFiles([relative]));
			else if (/\.(?:[cm]?[jt]sx?|md)$/u.test(entry.name)) files.push(relative);
		}
	}
	return files.sort();
}
