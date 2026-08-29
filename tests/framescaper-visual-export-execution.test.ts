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
		'exactPlan', 'timingSidecars', 'postprocess', 'accountFrame',
		'createProducer', 'disposition', 'dispose',
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

test('postprocessing refuses a frame that arrives on a foreign signal', async () => {
	const built = await execution();

	await assert.rejects(
		() => (built.postprocess as (value: unknown) => Promise<unknown>)({
			frame: 0, width: 640, height: 360,
			rgba: new Uint8ClampedArray(640 * 360 * 4),
			signal: new AbortController().signal,
		}),
		/requires its exact signal/u,
	);
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
