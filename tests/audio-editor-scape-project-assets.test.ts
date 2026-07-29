/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { indexScapeProjectAssets } from '../src/common/editor/scape-project-assets.ts';

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
