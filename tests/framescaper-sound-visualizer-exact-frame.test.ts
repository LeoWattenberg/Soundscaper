/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from '../src/common/editor/chunk-stream.js';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { createFramescaperVideoExportExactExecutionFinishing } from '../src/framescaper/video-export-exact-execution-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority, visualFreshness } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;

test('exact picture execution reads audio PCM and changes consecutive visualizer frames', async () => {
	const options = framescaperV20Options();
	options.videoTransitionsByTrackId = { 'video-track': [] };
	(options.clips as Data[]).push({
		schemaVersion: 1, kind: 'generator', id: 'visualizer-clip', sourceId: 'visualizer-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	((options.tracks as Data[])[0]!.clipIds as string[]).push('visualizer-clip');
	options.visualModel = {
		stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
		generatorSources: [{
			schemaVersion: 1, kind: 'generator', id: 'visualizer-source', name: 'Sound visualizer',
			width: 32, height: 16, frameRate: { num: 10, den: 1 }, frameCount: 10,
			generator: {
				kind: 'sound-visualizer', mode: 'waveform', sourceIds: ['audio-source'],
				windowSeconds: 0.05, foregroundColor: '#ffffffff', backgroundColor: '#000000ff',
			},
		}],
	};
	const project = createFramescaperProjectFinishing(PROFILE, options as never);
	const authority = renderAuthority(project, 10);
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...authority,
		canvas: { ...authority.canvas, width: 32, height: 16 },
		visualFreshnessByModelId: visualFreshness(project as never),
	});
	const pcm = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 31));
	const reads: number[] = [];
	const signal = new AbortController().signal;
	const store = {
		loadMediaAsset: () => Promise.resolve(null),
		readSourceChunk(sourceId: string, chunkIndex: number) {
			assert.equal(sourceId, 'audio-source');
			reads.push(chunkIndex);
			const start = chunkIndex * AUDIO_EDITOR_STORAGE_CHUNK_FRAMES;
			return Promise.resolve({ index: chunkIndex, frames: pcm.length - start,
				channels: [pcm.slice(start)] });
		},
	};
	const exact = await createFramescaperSelectedExactFrameExecutionFinishing({
		project, plan,
		timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, authority.timingViews),
		store,
		signal, assertCurrent() {},
	});
	try {
		const first = new Uint8Array(32 * 16 * 4);
		const second = new Uint8Array(first.length);
		const render = (position: number, target: Uint8Array<ArrayBuffer>) => exact.render({
			sequencePosition: { num: position, den: 1 }, timelineSample: position * 4_800,
			outputOrdinal: position, layers: [], width: 32, height: 16, target, signal,
		});
		const firstResult = await render(0, first);
		await render(1, second);
		assert.ok(reads.length > 0, 'audio PCM reaches the picture renderer');
		assert.notDeepEqual(first, second, 'the generated picture advances with the audio timeline');
		assert.ok(firstResult.consumedNodeIds.includes('render:visual:visualizer-clip'));
		const canvas = {
			width: 32, height: 16, fit: 'contain', backgroundColor: '#000000',
			frameRate: { num: 10, den: 1 },
		};
		const frameSource = createVideoExactPictureExportFrameSource({
			sampleRate: 48_000, startFrame: 4_800, endFrame: 9_600, canvas,
		} as never);
		const exportExecution = await createFramescaperVideoExportExactExecutionFinishing({
			profile: PROFILE, project, store,
			request: {
				canonicalProject: project, videoBlobs: new Map(),
				timingViewsBySourceId: authority.timingViews,
				plan: { format: 'mp4', quality: 'balanced',
					range: { startFrame: 4_800, durationFrames: 4_800 }, canvas },
				signal, assertCurrent() {},
			} as never,
		});
		try {
			const exported = new Uint8Array(second.length);
			await exportExecution.compositor({
				frame: frameSource.frame(0), layers: [], width: 32, height: 16,
				rgba: exported, signal,
			});
			assert.deepEqual(exported, second,
				'a range-local export frame keeps the preview animation phase');
		} finally {
			await exportExecution.dispose();
		}
		const fractionalCanvas = { ...canvas, frameRate: { num: 30_000, den: 1_001 } };
		const fractionalFrame = createVideoExactPictureExportFrameSource({
			sampleRate: 48_000, startFrame: 0, endFrame: 4_800, canvas: fractionalCanvas,
		} as never).frame(1);
		assert.equal(Number.isInteger(fractionalFrame.timelineSample), false);
		const fractionalExport = await createFramescaperVideoExportExactExecutionFinishing({
			profile: PROFILE, project, store,
			request: {
				canonicalProject: project, videoBlobs: new Map(),
				timingViewsBySourceId: authority.timingViews,
				plan: { format: 'mp4', quality: 'balanced',
					range: { startFrame: 0, durationFrames: 4_800 }, canvas: fractionalCanvas },
				signal, assertCurrent() {},
			} as never,
		});
		try {
			const exported = new Uint8Array(second.length);
			await fractionalExport.compositor({
				frame: fractionalFrame, layers: [], width: 32, height: 16,
				rgba: exported, signal,
			});
			assert.ok(exported.some((byte) => byte !== 0), 'fractional NTSC time reaches PCM rendering');
		} finally {
			await fractionalExport.dispose();
		}
	} finally {
		await exact.dispose();
	}
});
