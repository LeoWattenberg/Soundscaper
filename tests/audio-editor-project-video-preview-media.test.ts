/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectVisualService } from '../src/common/editor/controller/project-visual-service.ts';

test('an authenticated product proxy makes an offline video visual available without reading it as an original', async () => {
	const source = Object.freeze({ id: 'video', kind: 'video', storageKey: 'original' });
	const project = Object.freeze({
		id: 'project', schemaVersion: 20,
		sources: Object.freeze([source]),
		clips: Object.freeze([{
			id: 'clip', kind: 'video', sourceId: 'video', timelineStartFrame: 0, durationFrames: 10,
		}]),
		tracks: Object.freeze([{ id: 'track', clipIds: Object.freeze(['clip']) }]),
	});
	let originalReads = 0;
	let proxyRequests = 0;
	const service = createProjectVisualService({
		getProject: () => project,
		captureProject: () => project,
		assertProject: (token) => { assert.equal(token, project); },
		missingSourceIds: new Set(['video']),
		sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => { originalReads += 1; return null; },
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
		},
		resolveProductVideoPreviewMedia: async (request) => {
			proxyRequests += 1;
			assert.equal(request.project, project);
			assert.equal(request.source, source);
			return Object.freeze({ body: new Blob(['proxy'], { type: 'video/mp4' }), mediaKind: 'proxy' });
		},
		projectDurationFrames: () => 10,
		url: { createObjectURL: () => 'blob:proxy', revokeObjectURL() {} },
	});

	const visual = await service.activateVideoSource(source);
	assert.equal(proxyRequests, 1);
	assert.equal(originalReads, 0);
	assert.deepEqual(visual, {
		mediaUrl: 'blob:proxy', posterUrl: null, thumbnails: [], mediaKind: 'proxy',
	});
	assert.equal(service.getClipVisualData('clip')?.available, true);
	assert.deepEqual(service.getVideoSourceVisualData('video'), {
		source, available: true, mediaUrl: 'blob:proxy', posterUrl: null, thumbnails: [], mediaKind: 'proxy',
	});
});
