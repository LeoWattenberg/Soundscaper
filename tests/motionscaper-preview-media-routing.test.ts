/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVideoPreviewMediaLayers } from '../src/common/editor/ui/workspace/video-preview-media-layers.ts';
test('Motion composition leaves stay in the product materializer while ordinary and proxy media keep existing availability rules', () => {
	const entry = (id: string) => ({ source: { id }, clipId: id, sourceId: id });
	const visuals = { motion: { mediaKind: 'composition' as const, mediaUrl: null, available: true }, original: { mediaUrl: 'blob:original', available: true }, proxy: { mediaKind: 'proxy' as const, mediaUrl: 'blob:proxy' }, failed: { mediaUrl: 'blob:failed' } };
	const result = resolveVideoPreviewMediaLayers({ layers: [{ clips: ['motion', 'original', 'proxy', 'failed'].map(entry) }], controller: { actions: { timeline: {}, video: { getSourceVisualData: id => Reflect.get(visuals, id) as typeof visuals.original } } }, missingSourceIds: new Set(['original', 'proxy']), failedSources: new Map([['failed', 'blob:failed']]) });
	assert.deepEqual(result[0]!.clips.map(entry => [entry.sourceId, entry.available]), [['original', false], ['proxy', true], ['failed', false]]);
});
