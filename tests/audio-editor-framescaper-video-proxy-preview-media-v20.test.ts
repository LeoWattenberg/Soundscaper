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
	const trust: string[] = [];
	const online = createFramescaperVideoProxyPreviewMediaResolverV20({
		bodyStore: fixture.environment.store,
		originalStore: fixture.controllerStore,
		getProject: () => project,
		getMode: () => mode,
		getPressure: () => pressure,
		onTrustStatus: (_sourceId, _attachment, status) => { trust.push(status); },
	});

	assert.equal(await online(request), null, 'Auto keeps an available original without pressure');
	assert.equal(trust.at(-1), 'unverified');
	pressure = { droppedFrameRatio: 0.03, decodeQueueDepth: 0, viewportScale: 1 };
	const adaptive = await online(request);
	assert.equal(adaptive?.mediaKind, 'proxy');
	assert.equal(adaptive?.body.size, fixture.relationship.candidate().size);
	assert.equal(trust.at(-1), 'verified');

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

test('explicit Proxy refuses altered bytes while Auto alone may fall back to the original', async (context) => {
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
	let mode: 'proxy' | 'auto' = 'proxy';
	const trust: string[] = [];
	const resolver = createFramescaperVideoProxyPreviewMediaResolverV20({
		bodyStore: {
			loadMediaAsset: async (storageKey) => storageKey === attachment.storageKey
				? new Blob(['altered'], { type: attachment.mimeType })
				: fixture.environment.store.loadMediaAsset(storageKey),
		},
		originalStore: fixture.controllerStore,
		getProject: () => project,
		getMode: () => mode,
		getPressure: () => null,
		onTrustStatus: (_sourceId, _attachment, status) => { trust.push(status); },
	});
	const request = {
		project: project as never, source: source as never, sourceTimingIndex: null,
	};
	await assert.rejects(resolver(request), (error: unknown) => (
		(error as { code?: unknown }).code === 'FRAMESCAPER_PROXY_PREVIEW_UNAVAILABLE'
			&& /validation|verified|unavailable/iu.test(String((error as Error).message))
	));
	assert.equal(trust.at(-1), 'unavailable');
	mode = 'auto';
	assert.equal(await resolver(request), null);
});

test('explicit Proxy refuses a missing attachment while Original and Auto keep their own policy', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 20);
	const project = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(project);
	const source = capturedVideoSource(project, ORIGINAL_SOURCE_ID);
	let mode: 'original' | 'proxy' | 'auto' = 'proxy';
	const resolver = createFramescaperVideoProxyPreviewMediaResolverV20({
		bodyStore: fixture.environment.store,
		originalStore: fixture.controllerStore,
		getProject: () => project,
		getMode: () => mode,
		getPressure: () => null,
	});
	const request = { project: project as never, source: source as never, sourceTimingIndex: null };
	await assert.rejects(resolver(request), (error: unknown) => {
		const failure = error as Error & { code?: unknown; reason?: unknown };
		assert.equal(failure.code, 'FRAMESCAPER_PROXY_PREVIEW_UNAVAILABLE');
		assert.equal(failure.reason, 'attachment-unavailable');
		assert.equal(failure.cause, undefined);
		assert.equal(Object.hasOwn(failure, 'cause'), false);
		return true;
	});
	mode = 'original';
	assert.equal(await resolver(request), null);
	mode = 'auto';
	assert.equal(await resolver(request), null);
});
