/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedExactRenderFinishingNode, UnifiedExactRenderPlanV13 } from '../src/common/editor/unified-exact-render-plan.ts';
import type { FramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { loadFramescaperVideoExportVisualAssetsFinishing } from '../src/framescaper/video-export-visual-assets-finishing.ts';
import { loadFramescaperVideoExportFinishingAssetsFinishing } from '../src/framescaper/video-export-finishing-finishing.ts';

const THRESHOLD = 512 * 1024 * 1024;

test('visual export confirms a large stored body before reading it and can cancel without materialization', async () => {
	const source = { id: 'still', storageKey: 'still-body', contentSha256: '1'.repeat(64), mimeType: 'image/png', width: 1, height: 1 };
	const plan = { nodes: [{ kind: 'visual', modelKind: 'still', modelId: 'still', authoredState: { source } }] } as unknown as UnifiedExactRenderPlanV13;
	const finishing = { visualPresentations: [] } as unknown as UnifiedExactRenderFinishingNode;
	for (const accept of [true, false]) {
		let reads = 0;
		let warnings = 0;
		const sentinel = new Error('Confirmed body read');
		const blob = new Blob(['x']);
		Object.defineProperty(blob, 'size', { value: THRESHOLD + 1 });
		Object.defineProperty(blob, 'arrayBuffer', { value: () => { reads++; throw sentinel; } });
		await assert.rejects(loadFramescaperVideoExportVisualAssetsFinishing({
			signal: new AbortController().signal, assertCurrent() {}, store: { async loadMediaAsset() { return blob; } },
			async confirmFileSizeWarning(warning) {
				warnings++;
				assert.equal(reads, 0);
				assert.equal(warning.thresholdBytes, THRESHOLD);
				return accept;
			},
		}, plan, finishing), accept ? sentinel : { name: 'AbortError' });
		assert.equal(warnings, 1);
		assert.equal(reads, accept ? 1 : 0);
	}
});

test('finishing export can override the combined asset threshold before fetching its first body', async () => {
	const finishing = {
		visualPresentations: [{ enabled: true, grade: { lut: { storageKey: 'lut', sha256: '1'.repeat(64), byteLength: THRESHOLD + 1 } }, processorStackId: null }],
		processorStacks: [], motionAnalyses: [],
	} as unknown as UnifiedExactRenderFinishingNode;
	for (const accept of [true, false]) {
		let loads = 0;
		let warnings = 0;
		const sentinel = new Error('Confirmed asset fetch');
		await assert.rejects(loadFramescaperVideoExportFinishingAssetsFinishing({
			project: { sources: [] } as unknown as FramescaperProjectFinishing,
			signal: new AbortController().signal, assertCurrent() {},
			store: { async loadMediaAsset() { loads++; throw sentinel; } },
			async confirmFileSizeWarning(warning) {
				warnings++;
				assert.equal(loads, 0);
				assert.equal(warning.byteLength, THRESHOLD + 1);
				return accept;
			},
		}, finishing), accept ? sentinel : { name: 'AbortError' });
		assert.equal(warnings, 1);
		assert.equal(loads, accept ? 1 : 0);
	}
});
