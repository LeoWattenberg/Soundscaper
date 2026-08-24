/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { OfxFrozenFallbackV26 } from '../src/common/editor/native-ofx-state-v26.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	framescaperSelectedOpenFxFrozenFrameResolverV28,
	materializeFramescaperSelectedOpenFxVisualsV28,
} from '../src/framescaper/selected-v28-openfx-visual-inputs.ts';

const ASSET_SHA256 = '12'.repeat(32);

test('selected V28 General and Generator establish their plane before built-in materialization', async () => {
	for (const context of ['general', 'generator'] as const) {
		const observed: string[] = [];
		const frames = await materializeFramescaperSelectedOpenFxVisualsV28(
			[externalGeneratorEntry()], new Map(), 2, 1, new AbortController().signal,
			{
				has(candidate: string, targetId: string) {
					observed.push(`${candidate}:${targetId}`);
					return candidate === context && targetId === 'external-source';
				},
			} as never,
		);
		assert.deepEqual([...frames.get('external-clip')!.pixels], new Array(8).fill(0));
		assert.strictEqual(frames.get('external-source'), frames.get('external-clip'));
		assert.ok(observed.includes(`${context}:external-source`));
	}
	await assert.rejects(
		materializeFramescaperSelectedOpenFxVisualsV28(
			[externalGeneratorEntry()], new Map(), 2, 1, new AbortController().signal, null,
		),
		/external generator requires an exact selected V28 OpenFX node/iu,
	);
});

test('selected V28 frozen continuity reopens only the exact digest-bound source frame', async () => {
	const sourcePixels = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]);
	const requests: unknown[] = [];
	let unavailable = false;
	const resolver = framescaperSelectedOpenFxFrozenFrameResolverV28({
		sources: [{ sourceId: 'frozen-source', contentSha256: ASSET_SHA256,
			timing: { kind: 'cfr', frameCount: 2 } }],
		output: { canvas: { width: 2, height: 1 } },
	} as never, {
		async resolve(request) {
			requests.push(request);
			if (unavailable) throw new Error('asset unavailable');
			return { width: 2, height: 1, pixels: sourcePixels };
		},
		async dispose() {},
	});
	const fallback: OfxFrozenFallbackV26 = {
		externalMediaSourceId: 'frozen-source', renderedAssetSha256: ASSET_SHA256,
		frameCount: 2, freshness: {
			authoredStateSha256: '56'.repeat(32), inputIdentitiesSha256: '78'.repeat(32),
			renderPlanFingerprintSha256: '9a'.repeat(32), nativeEffectFingerprintSha256: 'bc'.repeat(32),
		},
	};
	const signal = new AbortController().signal;
	const recovered = await resolver(fallback, {} as never, 1, signal);
	assert.deepEqual(recovered, { width: 2, height: 1, pixels: sourcePixels });
	assert.notStrictEqual(recovered!.pixels, sourcePixels, 'custody returns an owned pixel copy');
	assert.deepEqual(requests, [{
		sourceId: 'frozen-source', sourceFrame: 1, width: 2, height: 1, signal,
	}]);
	assert.equal(await resolver({ ...fallback, renderedAssetSha256: '34'.repeat(32) }, {} as never, 1, signal), null);
	unavailable = true;
	assert.equal(await resolver(fallback, {} as never, 1, signal), null,
		'a missing previously-authenticated body becomes truthful bypass at the graph boundary');
});

function externalGeneratorEntry(): UnifiedExactRenderVisualFrameEntryV13 {
	return {
		nodeId: 'render:visual:external-generator:external-clip', modelId: 'external-clip',
		modelKind: 'external-generator', trackId: 'video-track',
		authoredState: {
			source: {
				schemaVersion: 1, kind: 'generator', id: 'external-source', name: 'External',
				width: 2, height: 1, frameRate: { num: 25, den: 1 }, frameCount: 2,
				generator: { kind: 'external-generator', bindingId: 'effect-instance',
					inputs: [{ name: 'Background', sourceRef: 'video-source' }] },
			},
			clip: {
				schemaVersion: 1, kind: 'generator', id: 'external-clip', sourceId: 'external-source',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 2,
				sourceInFrame: 0, sourceFrameCount: 2,
			},
		},
		opacity: 1, blendMode: 'normal', masks: [],
	};
}
