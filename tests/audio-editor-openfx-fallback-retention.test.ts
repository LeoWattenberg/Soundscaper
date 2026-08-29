/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A frozen OpenFX fallback is the rendered stand-in an effect falls back to when
 * its native plugin cannot run, and it lives in the document as external video
 * media that no clip names. Loading the project verifies that media exists and
 * that its digest still matches, so a retention sweep that does not count the
 * fallback as a reference deletes it and leaves a project that no longer opens.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { collectProjectSourceIds } from '../src/common/editor/retention.js';
import { openFxProject } from './helpers/framescaper-unified-render-project-fixture.ts';

const FALLBACK_SOURCE_ID = 'ofx-frozen-source';

interface ProjectSource { readonly id: string; readonly storageKey?: string; readonly contentSha256?: string }

/** The fixture project with a frozen fallback bound to media of its own. */
function projectWithFrozenFallback() {
	const project = openFxProject('video-source') as Record<string, unknown>;
	const sources = project.sources as readonly ProjectSource[];
	const video = sources.find((source) => source.id === 'video-source');
	assert.ok(video, 'the fixture provides a video source to clone');
	return {
		...project,
		sources: [...sources, { ...video, id: FALLBACK_SOURCE_ID, storageKey: 'ofx-frozen-storage' }],
		ofxEffects: (project.ofxEffects as readonly Record<string, unknown>[]).map((effect) => ({
			...effect,
			frozenFallback: {
				externalMediaSourceId: FALLBACK_SOURCE_ID,
				renderedAssetSha256: video.contentSha256 ?? '0'.repeat(64),
				frameCount: 240,
				freshness: effect.freshness,
			},
		})),
	};
}

test('a frozen OpenFX fallback keeps the media it names', () => {
	const project = projectWithFrozenFallback();
	const clipSourceIds = (project.clips as readonly { sourceId?: string }[]).map((clip) => clip.sourceId);

	assert.equal(clipSourceIds.includes(FALLBACK_SOURCE_ID), false, 'no clip names the fallback media');
	// Storage keys are derived from the retained source ids, so keeping the id is
	// what keeps the blob.
	assert.equal(collectProjectSourceIds(project).has(FALLBACK_SOURCE_ID), true);
});

test('an effect without a frozen fallback keeps nothing extra', () => {
	const project = openFxProject('video-source') as Record<string, unknown>;

	assert.deepEqual(
		[...collectProjectSourceIds(project)].sort(),
		[...new Set((project.clips as readonly { sourceId?: string }[]).map((clip) => clip.sourceId))].sort(),
	);
});
