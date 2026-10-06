/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroStagedRenderer } from '../src/common/editor/controller/effects/internal/macro/macro-staged-renderer.ts';
import { createExportSnapshotRenderer } from '../src/common/editor/controller/export/export-snapshot-renderer.ts';
import { admitTimePitchCacheProject } from '../src/common/editor/controller/source/internal/time-pitch-cache-project-admission.ts';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';

test('staged macro audio renders without entering committed-document cache admission', async () => {
	const project = createAudioPreviewProject({ sampleRate: 44_100, sources: [], clips: [], tracks: [] });
	const sources = new Map<string, unknown>();
	const rendered = { channels: [new Float32Array([0.2, -0.3])] };
	let loaded = false;
	let disposed = false;
	let preparations = 0;
	const renderer = createExportSnapshotRenderer({
		options: {}, sourceBuffers: new Map(), taskProgress: null,
		prepareCommittedTimePitchCaches: async (snapshot: unknown) => {
			preparations += 1;
			admitTimePitchCacheProject(snapshot);
		},
		createCacheAwareRenderEngine: () => ({
			loadProject(snapshot: unknown, buffers: unknown) {
				assert.equal(snapshot, project);
				assert.equal(buffers, sources);
				loaded = true;
			},
			renderMix: () => Promise.resolve(rendered),
			dispose: () => { disposed = true; },
		}),
		throwIfAborted: () => undefined, updateExportProgress: () => undefined,
	});
	assert.equal(await createMacroStagedRenderer(renderer.renderSnapshot)(project, {}, sources), rendered);
	assert.equal(preparations, 0);
	assert.equal(loaded, true);
	assert.equal(disposed, true);
});
