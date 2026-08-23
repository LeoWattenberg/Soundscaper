/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadVideoTimingAsset } from '../src/common/editor/video-timing-storage.ts';
import { normalizeVideoProxyAttachmentV18 } from '../src/common/editor/video-proxy-attachment-v18.ts';
import {
	createFramescaperVideoProxyPreviewMediaResolverV20,
} from '../src/framescaper/editor-video-proxy-preview-media-v20.ts';
import {
	ORIGINAL_SOURCE_ID,
} from './helpers/video-proxy-relationship-fixtures.ts';
import {
	capturedProxyRequest,
	capturedVideoSource,
	createCapturedProxyFixture,
} from './helpers/framescaper-captured-video-proxy-fixture.ts';

test('selected V20 preview verifies online/adaptive and offline proxy bodies before source-domain use', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 20);
	await fixture.schedule(capturedProxyRequest(
		fixture.origin,
		ORIGINAL_SOURCE_ID,
		fixture.originalSha256,
	));
	const project = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(project);
	const source = capturedVideoSource(project, ORIGINAL_SOURCE_ID);
	const timing = source.timingAsset
		? await loadVideoTimingAsset(fixture.environment.store as never, source.timingAsset, {
			sourceSha256: String(source.contentSha256),
		})
		: null;
	const request = {
		project: project as never,
		source: source as never,
		sourceTimingIndex: timing?.index ?? null,
	};
	let mode: 'original' | 'proxy' | 'auto' = 'auto';
	let pressure = null as null | Readonly<{
		droppedFrameRatio: number; decodeQueueDepth: number; viewportScale: number;
	}>;
	const online = createFramescaperVideoProxyPreviewMediaResolverV20({
		bodyStore: fixture.environment.store,
		originalStore: fixture.controllerStore,
		getProject: () => project,
		getMode: () => mode,
		getPressure: () => pressure,
	});

	assert.equal(await online(request), null, 'Auto keeps an available original without pressure');
	pressure = { droppedFrameRatio: 0.03, decodeQueueDepth: 0, viewportScale: 1 };
	const adaptive = await online(request);
	assert.equal(adaptive?.mediaKind, 'proxy');
	assert.equal(adaptive?.body.size, fixture.relationship.candidate().size);

	mode = 'auto';
	pressure = null;
	const offline = createFramescaperVideoProxyPreviewMediaResolverV20({
		bodyStore: fixture.environment.store,
		originalStore: { loadMediaAsset: async () => null },
		getProject: () => project,
		getMode: () => mode,
		getPressure: () => pressure,
	});
	assert.equal((await offline(request))?.mediaKind, 'proxy',
		'an exact retained proxy stays usable for offline editing');
});

test('preview verification falls back instead of showing altered proxy bytes', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 20);
	await fixture.schedule(capturedProxyRequest(
		fixture.origin,
		ORIGINAL_SOURCE_ID,
		fixture.originalSha256,
	));
	const project = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(project);
	const source = capturedVideoSource(project, ORIGINAL_SOURCE_ID);
	const attachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
	const resolver = createFramescaperVideoProxyPreviewMediaResolverV20({
		bodyStore: {
			loadMediaAsset: async (storageKey) => storageKey === attachment.storageKey
				? new Blob(['altered'], { type: attachment.mimeType })
				: fixture.environment.store.loadMediaAsset(storageKey),
		},
		originalStore: fixture.controllerStore,
		getProject: () => project,
		getMode: () => 'proxy',
		getPressure: () => null,
	});
	assert.equal(await resolver({
		project: project as never, source: source as never, sourceTimingIndex: null,
	}), null);
});
