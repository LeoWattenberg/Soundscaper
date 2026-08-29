/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperSelectedProjectBinThumbnailTimelineImage as createThumbnail,
	createFramescaperSelectedVisualPreviewSessionTimelineImage as createSession,
} from '../src/framescaper/editor-selected-timeline-image-image-preview.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function project(options: Data = {}): Data {
	return createFramescaperProjectTimelineImage(
		PROFILE,
		options as never,
	) as unknown as Data;
}

function mediaProject(): Data {
	return project(framescaperV20Options() as unknown as Data);
}

function store(): never {
	return { loadSource: async () => null } as unknown as never;
}

function inheritedSession(disposals: number[] = []): () => Data {
	return () => ({ resolve: () => null, dispose: () => { disposals.push(1); } });
}

async function session(overrides: Data = {}): Promise<Data> {
	return await createSession({
		profile: PROFILE,
		project: project(),
		store: store(),
		width: 320,
		height: 180,
		fit: 'contain',
		createInheritedSession: inheritedSession(),
		...overrides,
	} as never) as unknown as Data;
}

function thumbnail(overrides: Data = {}): Promise<unknown> {
	return createThumbnail({
		profile: PROFILE, project: mediaProject(), store: store(),
		clipId: 'bin-video', width: 64, height: 36, ...overrides,
	} as never);
}

test('a preview session exposes its resolve, transition and disposal ports', async () => {
	const preview = await session({ project: mediaProject() });

	assert.deepEqual(
		Object.keys(preview),
		['resolve', 'resolveTransitionWeight', 'dispose'],
	);
	(preview.dispose as () => void)();
});

test('resolving a sample returns the composed layer ledger', async () => {
	const preview = await session({ project: mediaProject() });

	const resolved = (preview.resolve as (sample: number) => Data)(0);

	assert.deepEqual(
		Object.keys(resolved),
		['layers', 'adjustments', 'activeFreezeNodeIds', 'availablePresetIds', 'ledger'],
	);
	(preview.dispose as () => void)();
});

test('a negative preview sample is refused', async () => {
	const preview = await session({ project: mediaProject() });

	assert.throws(
		() => (preview.resolve as (sample: number) => unknown)(-1),
		/preview sample must be non-negative/u,
	);
	(preview.dispose as () => void)();
});

test('a transition weight needs a stable clip identity', async () => {
	const preview = await session({ project: mediaProject() });

	assert.throws(
		() => (preview.resolveTransitionWeight as (value: unknown) => unknown)(0),
		/transition clip ID must be a stable ID/u,
	);
	(preview.dispose as () => void)();
});

test('a disposed session refuses further resolution and disposes only once', async () => {
	const disposals: number[] = [];
	const preview = await session({ createInheritedSession: inheritedSession(disposals) });

	(preview.dispose as () => void)();
	(preview.dispose as () => void)();

	assert.throws(
		() => (preview.resolve as (sample: number) => unknown)(0),
		/image preview session is disposed/u,
	);
	assert.deepEqual(disposals, [1], 'the inherited session must be released exactly once');
});

test('a preview canvas must carry positive bounded dimensions', async () => {
	await assert.rejects(() => session({ width: 0 }), /width must be a positive bounded dimension/u);
	await assert.rejects(() => session({ height: -5 }), /height must be a positive bounded dimension/u);
});

test('a preview session requires the authenticated profile and its own project domain', async () => {
	await assert.rejects(() => session({ profile: {} }), TypeError);
	await assert.rejects(() => session({ project: { schemaFamily: 'soundscaper' } }), TypeError);
});

test('a cancelled composition surfaces the caller abort reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the preview');
	controller.abort(reason);

	await assert.rejects(() => session({ signal: controller.signal }), (error: unknown) => {
		assert.equal(error, reason);
		return true;
	});
});

test('a Project Bin thumbnail is absent for a clip that carries no image', async () => {
	assert.equal(await thumbnail({ clipId: 'clip-not-in-the-bin' }), null);
	assert.equal(await thumbnail({ clipId: 'bin-video' }), null);
});

test('a Project Bin thumbnail needs a stable clip identity', async () => {
	await assert.rejects(() => thumbnail({ clipId: '' }), /must be a stable ID/u);
});
