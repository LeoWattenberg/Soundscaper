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
	createFramescaperVideoExportExactExecutionFinishing,
} from '../src/framescaper/video-export-exact-execution-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

test('exact export startup cleanup retains its construction failure when frame disposal rejects', async () => {
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	} as never) as unknown as Data;
	const video = (project.sources as Data[]).find(({ kind }) => kind === 'video')!;
	const primary = new Error('exact execution construction failed');
	const cleanup = new Error('frame decoder disposal failed');
	const NativeMap = globalThis.Map;
	let videoBlobs!: Map<string, Blob>;
	let timingViews!: Map<string, never>;
	let sawSources = false;
	let sawTiming = false;
	let injected = false;

	class RejectingCleanupMap<Key, Value> extends NativeMap<Key, Value> {
		static [Symbol.hasInstance](value: unknown): boolean {
			return value instanceof NativeMap;
		}
		get size(): number {
			return Reflect.getOwnPropertyDescriptor(NativeMap.prototype, 'size')!.get!.call(this) as number;
		}

		constructor(iterable?: Iterable<readonly [Key, Value]> | null) {
			super(iterable);
			if (iterable === videoBlobs) sawSources = true;
			else if (sawSources && iterable === timingViews) sawTiming = true;
			else if (sawTiming && iterable === undefined && !injected) {
				injected = true;
				super.set('rejecting-decoder' as Key, {
					capture: () => { throw new Error('unused'); },
					dispose: async () => { throw cleanup; },
				} as Value);
			}
		}
	}

	(globalThis as unknown as { Map: MapConstructor }).Map = RejectingCleanupMap as unknown as MapConstructor;
	try {
		videoBlobs = new Map([[String(video.id), new Blob(['source'])]]);
		timingViews = new Map([[String(video.id), {
			kind: 'cfr', rate: video.frameRate, frameCount: video.sourceFrameCount,
		} as never]]);
		const signal = new AbortController().signal;
		await assert.rejects(
			() => createFramescaperVideoExportExactExecutionFinishing({
				profile: PROFILE,
				project: project as never,
				request: {
					plan: {
						format: 'mp4', quality: 'balanced',
						range: { startFrame: 0, durationFrames: 10 },
						canvas: {
							width: 640, height: 360, fit: 'contain',
							backgroundColor: '#000000', frameRate: video.frameRate,
						},
					},
					canonicalProject: project, videoBlobs, timingViewsBySourceId: timingViews,
					signal, assertCurrent: () => undefined,
				} as never,
				createOpenFxExecution: () => { throw primary; },
			}),
			(error: unknown) => {
				assert.ok(error instanceof AggregateError);
				assert.equal(error.cause, primary);
				assert.equal(error.errors[0], primary);
				assert.ok(error.errors[1] instanceof AggregateError);
				assert.equal((error.errors[1] as AggregateError).errors[0], cleanup);
				return true;
			},
		);
		assert.equal(injected, true, 'the regression must exercise rejecting frame-address cleanup');
	} finally {
		(globalThis as unknown as { Map: MapConstructor }).Map = NativeMap;
	}
});
