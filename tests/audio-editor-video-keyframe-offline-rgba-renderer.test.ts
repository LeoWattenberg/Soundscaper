/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	createVideoKeyframeOfflineRgbaRenderer,
} from '../src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import {
	type VideoKeyframeOfflineSourcePresentation,
} from '../src/common/editor/ui/video-keyframe-offline-rgba-source.ts';

test('offline renderer consumes an owned frame, flips RGBA in place, and cleans resources', async () => {
	const frameSource = source();
	const fixture = rendererFixture();
	const media = presentation();
	const renderer = createVideoKeyframeOfflineRgbaRenderer({
		frameSource,
		canvas: fixture.canvas,
		resolveSource: () => media.value,
		createCompositor: fixture.createCompositor,
	});
	assert.deepEqual({ width: renderer.width, height: renderer.height, bytes: renderer.byteLength }, {
		width: 2, height: 2, bytes: 16,
	});
	assert.equal(Object.isFrozen(renderer), true);
	for (const key of ['produce', 'dispose']) {
		assert.equal(Object.getOwnPropertyDescriptor(renderer, key)?.enumerable, true);
	}
	const output = new Uint8Array(16).fill(99);
	const result = await renderer.produce(
		frameSource.frame(0), output, { signal: new AbortController().signal },
	);
	assert.equal(result, undefined);
	assert.deepEqual([...output], [
		9, 10, 11, 12, 13, 14, 15, 16,
		1, 2, 3, 4, 5, 6, 7, 8,
	]);
	assert.equal(fixture.renderedEntries(), 1);
	assert.equal(fixture.renderOptions()?.outputColorModel, 'rgba');
	await renderer.dispose();
	await renderer.dispose();
	assert.equal(fixture.disposals(), 1);
	assert.equal(media.disposals(), 1);
});

test('offline renderer rejects forged and foreign frames before source work', async () => {
	const frameSource = source();
	const foreign = source();
	const fixture = rendererFixture();
	let resolutions = 0;
	const renderer = createVideoKeyframeOfflineRgbaRenderer({
		frameSource,
		canvas: fixture.canvas,
		resolveSource: () => { resolutions += 1; return presentation().value; },
		createCompositor: fixture.createCompositor,
	});
	const output = new Uint8Array(16).fill(77);
	await assert.rejects(
		renderer.produce(foreign.frame(0), output, { signal: new AbortController().signal }),
		/owned by the requested.*frame source/u,
	);
	assert.equal(resolutions, 0);
	assert.deepEqual([...output], new Array(16).fill(77));
	await renderer.dispose();
});

test('offline renderer rejects a forged frame source before cache or GL work', () => {
	const authentic = source();
	const fixture = rendererFixture();
	let compositorCreations = 0;
	let resolutions = 0;
	assert.throws(() => createVideoKeyframeOfflineRgbaRenderer({
		frameSource: { ...authentic },
		canvas: fixture.canvas,
		resolveSource: () => { resolutions += 1; return presentation().value; },
		createCompositor: () => {
			compositorCreations += 1;
			return fixture.createCompositor();
		},
	}), /authenticated video keyframe export frame source/u);
	assert.equal(compositorCreations, 0);
	assert.equal(resolutions, 0);
});

test('offline renderer rejects duplicate source IDs before presentation mutation', async () => {
	const frameSource = source({ duplicateSource: true });
	const fixture = rendererFixture();
	const media = presentation();
	let resolutions = 0;
	const renderer = createVideoKeyframeOfflineRgbaRenderer({
		frameSource,
		canvas: fixture.canvas,
		resolveSource: () => { resolutions += 1; return media.value; },
		createCompositor: fixture.createCompositor,
	});
	const output = new Uint8Array(16).fill(55);
	await assert.rejects(
		renderer.produce(frameSource.frame(0), output, { signal: new AbortController().signal }),
		/duplicate source ID/u,
	);
	assert.equal(resolutions, 0);
	assert.equal(fixture.renderedEntries(), 0);
	assert.deepEqual([...output], new Array(16).fill(0));
	await renderer.dispose();
	assert.equal(media.disposals(), 0);
});

test('offline renderer clears reusable output on omission and post-read GL failure', async () => {
	for (const mode of ['fallback', 'read-error'] as const) {
		const frameSource = source();
		const fixture = rendererFixture(mode);
		const renderer = createVideoKeyframeOfflineRgbaRenderer({
			frameSource,
			canvas: fixture.canvas,
			resolveSource: () => presentation().value,
			createCompositor: fixture.createCompositor,
		});
		const output = new Uint8Array(16).fill(91);
		await assert.rejects(
			renderer.produce(frameSource.frame(0), output, { signal: new AbortController().signal }),
			mode === 'fallback' ? /omitted requested frame content/u : /failed with/u,
		);
		assert.deepEqual([...output], new Array(16).fill(0));
		await renderer.dispose();
	}
});

test('offline renderer refuses overlap, wrong reusable geometry, and active disposal', async () => {
	const frameSource = source();
	const fixture = rendererFixture();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const media = presentation({ present: () => gate });
	const renderer = createVideoKeyframeOfflineRgbaRenderer({
		frameSource,
		canvas: fixture.canvas,
		resolveSource: () => media.value,
		createCompositor: fixture.createCompositor,
	});
	await assert.rejects(
		renderer.produce(frameSource.frame(0), new Uint8Array(15), {
			signal: new AbortController().signal,
		}),
		/exact whole reusable/u,
	);
	const active = renderer.produce(frameSource.frame(0), new Uint8Array(16), {
		signal: new AbortController().signal,
	});
	await assert.rejects(
		renderer.produce(frameSource.frame(0), new Uint8Array(16), {
			signal: new AbortController().signal,
		}),
		/cannot overlap frames/u,
	);
	await assert.rejects(renderer.dispose(), /rendering a frame/u);
	release();
	await active;
	await renderer.dispose();
});

function source(options: Readonly<{ duplicateSource?: boolean }> = {}) {
	const trackIds = options.duplicateSource ? ['track-1', 'track-2'] : ['track-1'];
	const clips = [{
		id: 'clip-1', kind: 'video', sourceId: 'source-1', sequenceId: 'sequence-1',
		timelineStartFrame: 0, durationFrames: 1, sourceStartFrame: 0, sourceDurationFrames: 1,
		videoEffects: [],
	}, ...(options.duplicateSource ? [{
		id: 'clip-2', kind: 'video', sourceId: 'source-1', sequenceId: 'sequence-1',
		timelineStartFrame: 0, durationFrames: 1, sourceStartFrame: 0, sourceDurationFrames: 1,
		videoEffects: [],
	}] : [])];
	const project = {
		schemaVersion: 9,
		sampleRate: 1,
		primarySequenceId: 'sequence-1',
		sequences: [{ id: 'sequence-1', type: 'samples', trackIds }],
		sources: [{ id: 'source-1', kind: 'video', sampleRate: 1, width: 2, height: 2 }],
		clips,
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			...(options.duplicateSource
				? [{ id: 'track-2', type: 'video', clipIds: ['clip-2'] }]
				: []),
		],
		projectBin: { clips: [] },
	};
	return createVideoKeyframeExportFrameSource({
		project,
		canvas: { width: 2, height: 2, frameRate: 1 },
	});
}

function presentation(options: Readonly<{ present?: () => PromiseLike<void> | void }> = {}) {
	let disposeCalls = 0;
	const value: VideoKeyframeOfflineSourcePresentation = Object.freeze({
		sourceId: 'source-1',
		identity: 'sha256:source-1',
		drawable: {} as TexImageSource,
		decodedWidth: 2,
		decodedHeight: 2,
		displayWidth: 2,
		displayHeight: 2,
		present: () => options.present?.(),
		dispose: () => { disposeCalls += 1; },
	});
	return { value, disposals: () => disposeCalls };
}

function rendererFixture(mode: 'rendered' | 'fallback' | 'read-error' = 'rendered') {
	let disposeCalls = 0;
	let renderEntryCount = 0;
	let errorCalls = 0;
	let lastRenderOptions: Readonly<Record<string, unknown>> | null = null;
	const gl = {
		RGBA: 1,
		UNSIGNED_BYTE: 2,
		NO_ERROR: 0,
		finish() {},
		isContextLost: () => false,
		getError: () => mode === 'read-error' && errorCalls++ > 0 ? 1 : 0,
		readPixels(_x: number, _y: number, _width: number, _height: number,
			_format: number, _type: number, output: Uint8Array) {
			output.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
		},
	} as unknown as WebGL2RenderingContext;
	const createCompositor = () => ({
		gl,
		render(layers: Readonly<Record<string, unknown>>[], options: Readonly<Record<string, unknown>>) {
			lastRenderOptions = options;
			renderEntryCount = layers.reduce(
				(count, layer) => count + (layer.entries as readonly unknown[]).length,
				0,
			);
			return {
				status: mode === 'fallback' ? 'fallback' as const : 'rendered' as const,
				rendererStatus: 'available' as const,
				renderedEntryCount: mode === 'fallback' ? 0 : renderEntryCount,
			};
		},
		dispose() { disposeCalls += 1; },
	});
	return {
		canvas: { getContext() {} } as unknown as HTMLCanvasElement,
		createCompositor,
		disposals: () => disposeCalls,
		renderedEntries: () => renderEntryCount,
		renderOptions: () => lastRenderOptions,
	};
}
