/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectFramescaperDurableScapeAssetReferences, planFramescaperDurableScapeExportAssets } from '../src/framescaper/editor-scape-durable-asset-plan-core.ts';
import { validateFramescaperDesktopBodyDescriptor } from '../src/framescaper/desktop-project-library-body-contract.ts';
import { prepareFramescaperDesktopPublicationBodies, type FramescaperDesktopBodyStore } from '../src/framescaper/desktop-project-library-body-transfer.ts';
import type { FramescaperProject } from '../src/framescaper/editor-project.ts';

const THRESHOLD = 512 * 1024 * 1024;
const SHA = '1'.repeat(64);

test('Scape still export asks from stored metadata and preserves accepted size in its exact asset plan', async () => {
	const references = collectFramescaperDurableScapeAssetReferences({
		sources: [{ kind: 'still', id: 'still', storageKey: 'still-body', contentSha256: SHA, mimeType: 'image/png' }],
		freezeRenderedSourceIds: new Set(), luts: () => [], processorStacks: () => [], motionAnalyses: () => [],
	}, 'Framescaper');
	for (const accept of [true, false]) {
		let warnings = 0;
		const planning = planFramescaperDurableScapeExportAssets(references, {
			getMediaAssetMetadata: () => ({ size: THRESHOLD + 1, sha256: SHA, mimeType: 'image/png' }),
		}, 'Framescaper', undefined, {
			async confirmFileSizeWarning(warning) {
				warnings++;
				assert.equal(warning.thresholdBytes, THRESHOLD);
				return accept;
			},
		});
		if (accept) assert.equal((await planning)[0]?.size, THRESHOLD + 1);
		else await assert.rejects(planning, { name: 'AbortError' });
		assert.equal(warnings, 1);
	}
	assert.equal(references[0]?.maximumBytes, Number.MAX_SAFE_INTEGER);
});

test('desktop body descriptors retain canonical MIME and safe-integer checks for large admitted stills', () => {
	const descriptor = { kind: 'framescaper-still', encoding: 'still-image-v1', sourceId: 'still-body', storageKey: 'still-body',
		mimeType: 'image/png', byteLength: 65 * 1024 ** 3 + 1, sha256: SHA };
	assert.equal(validateFramescaperDesktopBodyDescriptor(descriptor).byteLength, descriptor.byteLength);
	assert.throws(() => validateFramescaperDesktopBodyDescriptor({ ...descriptor, mimeType: 'text/plain' }), /image role/u);
	assert.throws(() => validateFramescaperDesktopBodyDescriptor({ ...descriptor, byteLength: Number.MAX_SAFE_INTEGER + 1 }), /length/u);
});

test('desktop publication confirms a large exact body inventory before reading selected bodies', async () => {
	const project = { sources: [{ kind: 'still', id: 'still', storageKey: 'still-body', contentSha256: SHA, mimeType: 'image/png' }],
		videoVisualPresentations: [], videoFreezeFallbacks: [], videoFinishingPresets: [], videoProcessorStacks: [],
		videoMotionAnalyses: [], assistanceAssets: [] } as unknown as FramescaperProject;
	const byteLength = 65 * 1024 ** 3 + 1;
	for (const accept of [true, false]) {
		let warnings = 0;
		const prepared = prepareFramescaperDesktopPublicationBodies(project, SHA, {
			getMediaAssetMetadata: () => ({ sourceId: 'still-body', size: byteLength, sha256: SHA, mimeType: 'image/png' }),
			loadMediaAsset: () => { throw new Error('inventory admission does not load bodies'); },
		} as unknown as FramescaperDesktopBodyStore, undefined, () => false, {
			async confirmFileSizeWarning(warning) {
				warnings++;
				assert.equal(warning.byteLength, byteLength);
				assert.equal(warning.thresholdBytes, 64 * 1024 ** 3);
				return accept;
			},
		});
		if (accept) assert.equal((await prepared)[0]?.descriptor.byteLength, byteLength);
		else await assert.rejects(prepared, { name: 'AbortError' });
		assert.equal(warnings, 1);
	}
});
