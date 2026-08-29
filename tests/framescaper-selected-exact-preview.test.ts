/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectFinishing,
} from '../src/framescaper/editor-project-finishing.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanFinishing as createPlan,
} from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import {
	createFramescaperSelectedExactPreviewFinishing as createPreview,
} from '../src/framescaper/editor-selected-finishing-exact-preview.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';
import { bindCfrTiming } from './helpers/video-retime-export-fixtures.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
	} as never) as unknown as Data;
}

function plan(source: Data): Data {
	return createPlan(PROFILE, source, {
		...renderAuthority(source as never, 10),
		visualFreshnessByModelId: new Map(),
	} as never) as unknown as Data;
}

function timingViews(source: Data): Map<string, unknown> {
	const video = (source.sources as Data[]).find(({ kind }) => kind === 'video')!;
	return new Map([[
		String(video.id),
		bindCfrTiming(
			String(video.id),
			Number(video.sourceFrameCount),
			video.frameRate as never,
		),
	]]);
}

function harness(overrides: Data = {}): Readonly<{
	options: never;
	written: number[];
	disposals: number[];
}> {
	const source = project();
	const built = plan(source);
	const canvas = (built.output as Data).canvas as Data;
	const drawable = { width: canvas.width, height: canvas.height };
	const written: number[] = [];
	const disposals: number[] = [];
	const views = timingViews(source);
	return {
		written,
		disposals,
		options: {
			profile: PROFILE,
			project: source,
			plan: built,
			store: { loadSource: async () => null },
			timingViews: views,
			boundTimingViews: views,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			createOutput: () => ({
				drawable,
				write: (pixels: Uint8Array) => { written.push(pixels.byteLength); },
				dispose: () => { disposals.push(1); },
			}),
			...overrides,
		} as unknown as never,
	};
}

function frameRequest(built: Data, timelineSample: number): Data {
	const canvas = (built.output as Data).canvas as Data;
	return {
		timelineSample,
		mediaLayers: [],
		frame: { width: canvas.width, height: canvas.height },
	};
}

test('an exact preview composes against an injected output rather than a canvas', async () => {
	const { options } = harness();

	const preview = await createPreview(options) as unknown as Data;

	assert.equal(typeof preview.render, 'function');
	assert.equal(typeof preview.dispose, 'function');
	(preview.dispose as () => void)();
});

test('rendering writes exactly one full canvas of pixels', async () => {
	const { options, written } = harness();
	const preview = await createPreview(options) as unknown as Data;
	const built = (options as unknown as Data).plan as Data;
	const canvas = (built.output as Data).canvas as Data;

	await (preview.render as (request: unknown) => Promise<unknown>)(frameRequest(built, 0))
		.catch(() => undefined);

	assert.deepEqual(
		written,
		[Number(canvas.width) * Number(canvas.height) * 4],
		'one render must publish exactly one RGBA canvas',
	);
	(preview.dispose as () => void)();
});

test('a negative timeline sample is refused before any pixels are produced', async () => {
	const { options, written } = harness();
	const preview = await createPreview(options) as unknown as Data;
	const built = (options as unknown as Data).plan as Data;

	await assert.rejects(
		() => (preview.render as (request: unknown) => Promise<unknown>)(frameRequest(built, -1)),
		/timeline sample must be non-negative/u,
	);
	assert.deepEqual(written, []);
	(preview.dispose as () => void)();
});

test('a disposed preview refuses further renders', async () => {
	const { options } = harness();
	const preview = await createPreview(options) as unknown as Data;
	const built = (options as unknown as Data).plan as Data;

	(preview.dispose as () => void)();

	await assert.rejects(
		() => (preview.render as (request: unknown) => Promise<unknown>)(frameRequest(built, 0)),
		/exact preview is disposed/u,
	);
});

test('disposal releases the output exactly once however often it is called', async () => {
	const { options, disposals } = harness();
	const preview = await createPreview(options) as unknown as Data;

	(preview.dispose as () => void)();
	(preview.dispose as () => void)();

	assert.deepEqual(disposals, [1]);
});

test('a cancelled composition surfaces the caller abort reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the preview');
	controller.abort(reason);
	const { options } = harness({
		signal: controller.signal,
		assertCurrent: () => { throw reason; },
	});

	await assert.rejects(() => createPreview(options), (error: unknown) => {
		assert.equal(error, reason);
		return true;
	});
});
