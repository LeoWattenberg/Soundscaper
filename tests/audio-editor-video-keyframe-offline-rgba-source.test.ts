/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VideoKeyframeOfflineSourceCache,
	type VideoKeyframeOfflineSourcePresentation,
} from '../src/common/editor/ui/video-keyframe-offline-rgba-source.ts';

test('offline source cache reuses one exact lifecycle and disposes it once', async () => {
	const fixture = presentation();
	const cache = new VideoKeyframeOfflineSourceCache(() => fixture.value);
	const signal = new AbortController().signal;
	const first = await cache.present({ sourceId: 'source-1', sourceTimeSeconds: 0 }, signal);
	const second = await cache.present({ sourceId: 'source-1', sourceTimeSeconds: 1 }, signal);
	assert.equal(first, second);
	assert.equal(first.readyState, 4);
	assert.equal(first.videoWidth, 64);
	assert.equal(first.videoHeight, 32);
	assert.equal(first.displayWidth, 48);
	assert.equal(first.displayHeight, 32);
	assert.deepEqual(fixture.presented, [0, 1]);
	await cache.dispose();
	await cache.dispose();
	assert.equal(fixture.disposals(), 1);
});

test('offline source cache rejects identity drift and disposes only the unretained candidate', async () => {
	const first = presentation({ identity: 'sha256:first' });
	const second = presentation({ identity: 'sha256:second' });
	let current = first.value;
	const cache = new VideoKeyframeOfflineSourceCache(() => current);
	const signal = new AbortController().signal;
	await cache.present({ sourceId: 'source-1' }, signal);
	current = second.value;
	await assert.rejects(
		cache.present({ sourceId: 'source-1' }, signal),
		/source identity changed/u,
	);
	assert.equal(first.disposals(), 0);
	assert.equal(second.disposals(), 1);
	await cache.dispose();
	assert.equal(first.disposals(), 1);
});

test('first-presentation failure evicts and disposes before a fresh retry', async () => {
	const broken = presentation({ failure: new Error('decoder failed') });
	const recovered = presentation();
	let current = broken.value;
	const cache = new VideoKeyframeOfflineSourceCache(() => current);
	const signal = new AbortController().signal;
	await assert.rejects(cache.present({ sourceId: 'source-1' }, signal), /decoder failed/u);
	assert.equal(broken.disposals(), 1);
	current = recovered.value;
	await cache.present({ sourceId: 'source-1' }, signal);
	await cache.dispose();
	assert.equal(recovered.disposals(), 1);
});

test('cached lifecycle failure retires the decoder before a fresh authenticated retry', async () => {
	let calls = 0;
	const cached = presentation({
		present: () => {
			calls += 1;
			if (calls === 2) throw new Error('later decode failed');
		},
	});
	const recovered = presentation();
	let current = cached.value;
	const cache = new VideoKeyframeOfflineSourceCache(() => current);
	const signal = new AbortController().signal;
	await cache.present({ sourceId: 'source-1' }, signal);
	await assert.rejects(cache.present({ sourceId: 'source-1' }, signal), /later decode failed/u);
	assert.equal(cached.disposals(), 1);
	current = recovered.value;
	await cache.present({ sourceId: 'source-1' }, signal);
	await cache.dispose();
	assert.equal(cached.disposals(), 1);
	assert.equal(recovered.disposals(), 1);
});

test('aborted admission does not resolve or retain a source lifecycle', async () => {
	let resolutions = 0;
	const cache = new VideoKeyframeOfflineSourceCache(() => {
		resolutions += 1;
		return presentation().value;
	});
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(cache.present({ sourceId: 'source-1' }, controller.signal), {
		name: 'AbortError',
	});
	assert.equal(resolutions, 0);
	await cache.dispose();
});

function presentation(options: Readonly<{
	identity?: string;
	failure?: Error;
	present?: () => void;
}> = {}) {
	let disposeCalls = 0;
	const presented: unknown[] = [];
	const drawable = {} as TexImageSource;
	const value: VideoKeyframeOfflineSourcePresentation = Object.freeze({
		sourceId: 'source-1',
		identity: options.identity ?? 'sha256:stable',
		drawable,
		decodedWidth: 64,
		decodedHeight: 32,
		displayWidth: 48,
		displayHeight: 32,
		present(entry: Readonly<Record<string, unknown>>) {
			options.present?.();
			if (options.failure) throw options.failure;
			presented.push(entry.sourceTimeSeconds);
		},
		dispose() { disposeCalls += 1; },
	});
	return { value, presented, disposals: () => disposeCalls };
}
