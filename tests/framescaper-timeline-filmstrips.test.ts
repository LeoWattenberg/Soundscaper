/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as FINISHING_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectFinishing,
} from '../src/framescaper/editor-project-finishing.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as IMAGE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperSelectedTimelineFilmstripFinishing as finishingFilmstrip,
} from '../src/framescaper/editor-selected-finishing-timeline-filmstrip.ts';
import {
	createFramescaperSelectedTimelineFilmstripTimelineImage as imageFilmstrip,
} from '../src/framescaper/editor-selected-timeline-image-image-filmstrip.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function store(): never {
	return { loadSource: async () => null } as unknown as never;
}

function finishingProject(): Data {
	return createFramescaperProjectFinishing(FINISHING_PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	} as never) as unknown as Data;
}

function imageProject(): Data {
	return createFramescaperProjectTimelineImage(
		IMAGE_PROFILE, framescaperV20Options() as never,
	) as unknown as Data;
}

function frame(overrides: Data = {}): Data {
	return {
		key: 'frame-1',
		clipId: 'video-clip',
		sourceId: 'video-source',
		timelineSample: 0,
		sourceUrl: 'blob:filmstrip',
		...overrides,
	};
}

function finishing(overrides: Data = {}): Promise<unknown> {
	return finishingFilmstrip({
		profile: FINISHING_PROFILE, project: finishingProject(), store: store(),
		width: 64, height: 36, frames: [], ...overrides,
	} as never);
}

function image(overrides: Data = {}): Promise<unknown> {
	return imageFilmstrip({
		profile: IMAGE_PROFILE, project: imageProject(), store: store(),
		width: 64, height: 36, frames: [], ...overrides,
	} as never);
}

test('an empty filmstrip request resolves to no frames in either product', async () => {
	assert.deepEqual(await finishing(), []);
	assert.deepEqual(await image(), []);
});

test('a filmstrip frame list must be a bounded array', async () => {
	await assert.rejects(() => finishing({ frames: 'nope' }), /frames must be an array/u);
	await assert.rejects(
		() => finishing({ frames: Array.from({ length: 257 }, (_, index) => frame({ key: `frame-${index}` })) }),
		/limited to 256 frames/u,
	);
	await assert.rejects(() => image({ frames: 'nope' }), /must be a bounded array/u);
});

test('filmstrip frame keys must be present and unique', async () => {
	await assert.rejects(() => finishing({ frames: [frame({ key: '' })] }), /key must be non-empty/u);
	await assert.rejects(
		() => finishing({ frames: [frame(), frame()] }),
		/frame key frame-1 is duplicated/u,
	);
});

test('a filmstrip frame sample must be non-negative', async () => {
	await assert.rejects(
		() => finishing({ frames: [frame({ timelineSample: -1 })] }),
		/sample must be non-negative/u,
	);
});

test('filmstrip canvas dimensions must be positive', async () => {
	await assert.rejects(
		() => finishing({ frames: [frame()], width: 0 }),
		/filmstrip width must be positive/u,
	);
	await assert.rejects(
		() => finishing({ frames: [frame()], height: 0 }),
		/filmstrip height must be positive/u,
	);
});

test('an empty request is answered before its dimensions are validated', async () => {
	assert.deepEqual(
		await finishing({ width: 0 }),
		[],
		'no frames means no canvas is needed, so none is demanded',
	);
	assert.deepEqual(await image({ width: 0 }), []);
});

test('a cancelled filmstrip surfaces the caller abort reason in either product', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the filmstrip');
	controller.abort(reason);

	for (const build of [finishing, image]) {
		await assert.rejects(() => build({ signal: controller.signal }), (error: unknown) => {
			assert.equal(error, reason);
			return true;
		});
	}
});

test('an image filmstrip requires the authenticated runtime profile', async () => {
	await assert.rejects(() => image({ profile: {} }), TypeError);
});

test('the finishing filmstrip receives the same selected OpenFX execution as the main preview', async () => {
	const [filmstripSource, controllerSource] = await Promise.all([
		readFile(new URL('../src/framescaper/editor-selected-finishing-timeline-filmstrip.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/framescaper/editor-selected-assistance-visual-preview-controller.ts', import.meta.url), 'utf8'),
	]);
	assert.match(filmstripSource,
		/createFramescaperSelectedVisualPreviewSessionFinishing\(\{[\s\S]*createOpenFxExecution: options\.createOpenFxExecution/u);
	assert.match(controllerSource,
		/createFramescaperSelectedTimelineFilmstripFinishing\(\{[\s\S]*createOpenFxExecution/u);
});
