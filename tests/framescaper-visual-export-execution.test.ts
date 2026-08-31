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
	createFramescaperVideoExportVisualExecutionFinishing as createExecution,
} from '../src/framescaper/video-export-visual-execution-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	} as never) as unknown as Data;
}

function projectWithStill(): Data {
	const options = framescaperV20Options();
	const still = {
		schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
		mimeType: 'image/png', storageKey: 'still-body',
		contentSha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
		width: 1, height: 1, hasAlpha: true,
	};
	const clip = {
		schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: still.id,
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
	};
	return createFramescaperProjectFinishing(PROFILE, {
		...options,
		clips: [...options.clips as Data[], clip],
		tracks: (options.tracks as Data[]).map((track) => track.id === 'video-track'
			? { ...track, clipIds: [...track.clipIds as string[], clip.id] } : track),
		visualModel: { stillSources: [still] },
		videoTransitionsByTrackId: { 'video-track': [] },
	} as never) as unknown as Data;
}

function harness(overrides: Data = {}): never {
	const source = project();
	const video = (source.sources as Data[]).find(({ kind }) => kind === 'video')!;
	return {
		profile: PROFILE,
		project: source,
		plan: {
			format: 'mp4',
			quality: 'balanced',
			range: { startFrame: 0, durationFrames: 10 },
			canvas: {
				width: 640, height: 360, fit: 'contain',
				backgroundColor: '#000000', frameRate: video.frameRate,
			},
		},
		timingViewsBySourceId: new Map([[
			String(video.id),
			{ kind: 'cfr', rate: video.frameRate, frameCount: video.sourceFrameCount },
		]]),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		...overrides,
	} as unknown as never;
}

async function execution(overrides: Data = {}): Promise<Data> {
	return await createExecution(harness(overrides)) as unknown as Data;
}

test('a visual export execution compiles its own exact render plan', async () => {
	const built = await execution();

	assert.deepEqual(Object.keys(built), [
		'exactPlan', 'timingSidecars', 'accountFrame', 'disposition', 'dispose',
	]);
	assert.equal((built.exactPlan as Data).version, 13);
	(built.dispose as () => void)();
});

test('the compiled plan carries the clip and finishing nodes the project describes', async () => {
	const built = await execution();

	assert.deepEqual(
		((built.exactPlan as Data).nodes as Data[]).map(({ kind }) => kind),
		['clip', 'finishing'],
	);
	(built.dispose as () => void)();
});

test('an execution reports a disposition naming every node it accounted for', async () => {
	const built = await execution();

	const disposition = (built.disposition as () => Data)();

	assert.deepEqual(Object.keys(disposition), [
		'exactPlanVersion', 'nodeDispositions', 'captionDisposition', 'captionTrackIds',
		'audioDisposition', 'originalSourceIds', 'unexplainedOmittedNodeIds',
	]);
	assert.equal(disposition.exactPlanVersion, 13);
	(built.dispose as () => void)();
});

test('ledger setup leaves still decoding to the selected exact frame executor', async () => {
	let loads = 0;
	const built = await execution({
		project: projectWithStill(),
		store: {
			loadMediaAsset: async () => { loads += 1; return new Blob(['x']); },
			decodeStillAsset: async () => ({ width: 1, height: 1, pixels: new Uint8Array(4) }),
		},
	});

	assert.equal(loads, 0);
	(built.dispose as () => void)();
});

test('an already-cancelled export never compiles a plan', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the export');
	controller.abort(reason);

	await assert.rejects(() => execution({ signal: controller.signal }), (error: unknown) => {
		assert.equal(error, reason);
		return true;
	});
});

test('a stale project is refused before any plan work begins', async () => {
	const stale = new RangeError('the project advanced under the export');

	await assert.rejects(
		() => execution({ assertCurrent: () => { throw stale; } }),
		(error: unknown) => {
			assert.equal(error, stale);
			return true;
		},
	);
});

test('disposal is idempotent and still answers for its disposition', async () => {
	const built = await execution();

	(built.dispose as () => void)();
	(built.dispose as () => void)();

	assert.equal((built.disposition as () => Data)().exactPlanVersion, 13);
});
