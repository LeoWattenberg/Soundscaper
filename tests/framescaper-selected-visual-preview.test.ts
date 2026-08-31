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
	createFramescaperSelectedProjectBinThumbnailFinishing as createThumbnail,
	createFramescaperSelectedVisualPreviewSessionFinishing as createSession,
} from '../src/framescaper/editor-selected-finishing-visual-preview.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function store(): never {
	return { loadSource: async () => null } as unknown as never;
}

function visualProject(): Data {
	return createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
	} as never) as unknown as Data;
}

function plainProject(): Data {
	return createFramescaperProjectFinishing(PROFILE, {} as never) as unknown as Data;
}

function session(overrides: Data = {}): Promise<unknown> {
	return createSession({
		profile: PROFILE, project: plainProject(), store: store(),
		width: 320, height: 180, ...overrides,
	} as never);
}

function thumbnail(overrides: Data = {}): Promise<unknown> {
	return createThumbnail({
		profile: PROFILE, project: visualProject(), store: store(),
		clipId: 'bin-video', width: 64, height: 36, ...overrides,
	} as never);
}

test('a project with no executable visual state composes no preview session', async () => {
	assert.equal(await session(), null);
});

test('orphaned finishing state without a picture range composes no preview session', async () => {
	const options = framescaperV20Options() as Data;
	options.clips = [];
	for (const track of options.tracks as Data[]) track.clipIds = [];
	const project = createFramescaperProjectFinishing(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [], generatorSources: [], presets: [], maskMattes: [], freezeFallbacks: [],
			adjustmentLayers: [{
				schemaVersion: 1, kind: 'adjustment-layer', id: 'orphaned-adjustment',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				targetTrackIds: ['video-track'], effectIds: [],
			}],
		},
	} as never);
	assert.equal(await session({ project }), null);
});

test('a preview session refuses a non-positive or fractional canvas dimension', async () => {
	const visual = { project: visualProject() };

	await assert.rejects(() => session({ ...visual, width: 0 }), /preview width must be positive/u);
	await assert.rejects(() => session({ ...visual, height: -1 }), /preview height must be positive/u);
	await assert.rejects(() => session({ ...visual, width: 320.5 }), /preview width must be positive/u);
});

test('a project with nothing to draw is answered before its canvas is validated', async () => {
	assert.equal(
		await session({ width: 0 }),
		null,
		'an absent preview costs nothing, so it must not be gated behind canvas validation',
	);
});

test('a preview session requires the authenticated finishing runtime profile', async () => {
	await assert.rejects(() => session({ profile: {} }), TypeError);
});

test('a preview session refuses a project outside the finishing domain', async () => {
	await assert.rejects(
		() => session({ project: { schemaFamily: 'soundscaper' } }),
		TypeError,
	);
});

test('a legal adjustment beyond the selected picture range does not poison preview freshness', async () => {
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [], generatorSources: [], presets: [], maskMattes: [], freezeFallbacks: [],
			adjustmentLayers: [{
				schemaVersion: 1, kind: 'adjustment-layer', id: 'late-adjustment',
				sequenceId: 'main-sequence', sequenceStartFrame: 20, sequenceFrameCount: 10,
				targetTrackIds: ['video-track'], effectIds: [],
			}],
		},
	} as never);

	const root = globalThis as unknown as Data;
	const previousDocument = root.document;
	root.document = {
		createElement: () => ({
			width: 0, height: 0,
			getContext: () => ({ putImageData() {}, clearRect() {} }),
		}),
	};
	try {
		const preview = await session({ project });
		assert.ok(preview);
		(preview as Readonly<{ dispose(): void }>).dispose();
	} finally {
		if (previousDocument === undefined) delete root.document;
		else root.document = previousDocument;
	}
});

test('a Project Bin thumbnail is absent for a clip the bin does not hold', async () => {
	assert.equal(await thumbnail({ clipId: 'clip-that-is-not-in-the-bin' }), null);
});

test('a Project Bin thumbnail is absent for a clip that is not a visual', async () => {
	assert.equal(
		await thumbnail({ clipId: 'bin-video' }),
		null,
		'only still and generator clips carry an authored visual to draw',
	);
});

test('a Project Bin thumbnail requires a stable clip identity and exact profile', async () => {
	await assert.rejects(() => thumbnail({ clipId: '' }), /must be a stable ID/u);
	await assert.rejects(() => thumbnail({ profile: {} }), TypeError);
});

test('a Project Bin thumbnail is absent when the project has no bin contents', async () => {
	assert.equal(await thumbnail({ project: plainProject(), clipId: 'anything' }), null);
});
