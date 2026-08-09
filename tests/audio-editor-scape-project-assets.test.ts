/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { indexScapeProjectAssets } from '../src/common/editor/scape-project-assets.ts';
import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

test('scape project assets are indexed by exact migrated source identity', () => {
	const audio = descriptor('audio-source', 'audio');
	const video = descriptor('video-source', 'video');
	const result = indexScapeProjectAssets({
		sources: [
			{ id: 'audio-source', storageKey: 'shared-content', kind: 'audio' },
			{ id: 'video-source', storageKey: 'shared-content', kind: 'video' },
		],
	}, { assets: [video, audio] });

	assert.deepEqual([...result.keys()], ['video-source', 'audio-source']);
	assert.equal(result.get('audio-source'), audio);
	assert.equal(result.get('video-source'), video);
	assert.equal(indexScapeProjectAssets({ sources: [] }, { assets: [] }).size, 0);
});

test('current Scape video assets bind archive bytes to source.contentSha256', () => {
	const sourceSha256 = '1'.repeat(64);
	const project = createAudioEditorProjectV10({
		sources: [{
			id: 'video-source', kind: 'video', storageKey: 'video-original', name: 'video.mp4',
			mimeType: 'video/mp4', frameCount: 4_800, sampleRate: 48_000, width: 16, height: 16,
			frameRate: { num: 30, den: 1 }, sourceFrameCount: 3, contentSha256: sourceSha256,
		}],
	});
	const video = { ...descriptor('video-source', 'video'), sha256: sourceSha256 };
	assert.equal(indexScapeProjectAssets(project, { assets: [video] }).get(video.sourceId), video);
	assert.throws(
		() => indexScapeProjectAssets(project, { assets: [{ ...video, sha256: '2'.repeat(64) }] }),
		/source content|content SHA-256|original.*digest/iu,
	);
});

test('current Scape projects bind every rendered fallback digest to its canonical asset', () => {
	const audio = descriptor('audio-source', 'audio');
	const video = descriptor('video-source', 'video');
	const project = featureProject(audio.sha256, [{
		id: 'shared-fallback-a',
		featureId: 'org.soundscaper.native.shared-a',
		displayName: 'Shared fallback A',
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: audio.sourceId, sha256: audio.sha256 },
	}, {
		id: 'shared-fallback-b',
		featureId: 'org.soundscaper.native.shared-b',
		displayName: 'Shared fallback B',
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: audio.sourceId, sha256: audio.sha256 },
	}, {
		id: 'video-fallback',
		featureId: 'org.soundscaper.native.video-fallback',
		displayName: 'Video fallback',
		disposition: 'rendered-fallback',
		fallback: { kind: 'video', sourceId: video.sourceId, sha256: video.sha256 },
	}], [
		{ id: audio.sourceId, kind: audio.kind },
		{ id: video.sourceId, kind: video.kind },
	]);

	const indexed = indexScapeProjectAssets(project, { assets: [video, audio] });
	assert.equal(indexed.get(audio.sourceId), audio);
	assert.equal(indexed.get(video.sourceId), video);
	assert.throws(
		() => indexScapeProjectAssets(featureProject('f'.repeat(64)), { assets: [audio] }),
		/rendered fallback.*SHA-256.*asset/iu,
	);
});

test('future Scape projects leave feature requirements opaque while indexing sources', () => {
	const audio = descriptor('audio-source', 'audio');
	const project = {
		schemaVersion: 11,
		sources: [{ id: audio.sourceId, kind: audio.kind }],
	};
	Object.defineProperty(project, 'featureRequirements', {
		get() { throw new Error('future feature requirements must remain opaque'); },
	});

	assert.equal(indexScapeProjectAssets(project, { assets: [audio] }).get(audio.sourceId), audio);
});

test('scape project assets reject non-bijective or invalid source identities', async (context) => {
	const audio = descriptor('audio-source', 'audio');
	const video = descriptor('video-source', 'video');
	const cases: readonly {
		readonly name: string;
		readonly project: unknown;
		readonly assets: readonly ScapeAssetDescriptor[];
		readonly expected: RegExp;
	}[] = [{
		name: 'missing project sources array',
		project: {},
		assets: [],
		expected: /invalid sources/iu,
	}, {
		name: 'orphan manifest descriptor',
		project: { sources: [] },
		assets: [audio],
		expected: /one-to-one mapping/iu,
	}, {
		name: 'missing manifest descriptor',
		project: { sources: [{ id: 'audio-source', kind: 'audio' }] },
		assets: [],
		expected: /one-to-one mapping/iu,
	}, {
		name: 'equal-count disjoint identities',
		project: { sources: [{ id: 'other-source', kind: 'audio' }] },
		assets: [audio],
		expected: /missing source other-source/iu,
	}, {
		name: 'duplicate project source identity',
		project: { sources: [
			{ id: 'audio-source', kind: 'audio' },
			{ id: 'audio-source', kind: 'audio' },
		] },
		assets: [audio, video],
		expected: /duplicate source audio-source/iu,
	}, {
		name: 'duplicate manifest source identity',
		project: { sources: [
			{ id: 'audio-source', kind: 'audio' },
			{ id: 'video-source', kind: 'video' },
		] },
		assets: [audio, { ...audio, entry: 'audio/duplicate.f32c' }],
		expected: /duplicate \.scape source asset/iu,
	}, {
		name: 'invalid project source record',
		project: { sources: [null] },
		assets: [audio],
		expected: /invalid source/iu,
	}, {
		name: 'invalid project source ID',
		project: { sources: [{ id: '', kind: 'audio' }] },
		assets: [audio],
		expected: /invalid source ID/iu,
	}, {
		name: 'unsupported project source kind',
		project: { sources: [{ id: 'audio-source', kind: 'future-media' }] },
		assets: [audio],
		expected: /unsupported kind/iu,
	}, {
		name: 'incompatible descriptor kind',
		project: { sources: [{ id: 'video-source', kind: 'audio' }] },
		assets: [video],
		expected: /incompatible asset kind/iu,
	}];

	for (const scenario of cases) {
		await context.test(scenario.name, () => {
			assert.throws(
				() => indexScapeProjectAssets(scenario.project, { assets: scenario.assets }),
				scenario.expected,
			);
		});
	}
});

function descriptor(sourceId: string, kind: 'audio' | 'video'): ScapeAssetDescriptor {
	return {
		sourceId,
		kind,
		entry: kind === 'video' ? `video/${sourceId}.original` : `audio/${sourceId}.f32c`,
		encoding: kind === 'video' ? 'original' : 'audio-f32le-chunks-v1',
		size: 5,
		sha256: '0'.repeat(64),
	};
}

function featureProject(
	sha256: string,
	requirements: readonly Readonly<Record<string, unknown>>[] = [{
		id: 'fallback-feature',
		featureId: 'org.soundscaper.native.fallback-feature',
		displayName: 'Fallback feature',
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'audio-source', sha256 },
	}],
	sources: readonly Readonly<Record<string, unknown>>[] = [{ id: 'audio-source', kind: 'audio' }],
): Readonly<Record<string, unknown>> {
	return {
		schemaVersion: 10,
		sources,
		featureRequirements: { schemaVersion: 1, requirements },
	};
}
