/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { serialize } from 'node:v8';

import {
	AUDIO_EDITOR_HISTORY_LIMIT,
	createEditorHistory,
	executeEditorCommand,
} from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const WORKLOAD_ID = 'm3-longform-editorial-2h-v1';
const METRIC_ID = 'editorial.retainedHeapDeltaBytes';
const CHILD_FLAG = 'SOUNDSCAPER_MEASURE_M3_FOUNDATION_HISTORY';

if (process.env[CHILD_FLAG] === '1') {
	const result = measureFoundationHistory();
	process.stdout.write(`FOUNDATION_HISTORY_MEASUREMENT=${JSON.stringify(result)}\n`);
} else {
	test('current-schema snapshot history stays within the milestone-3 long-form retained-heap budget', async () => {
		const budget = JSON.parse(await readFile(new URL('../config/quality-budgets.json', import.meta.url), 'utf8'));
		const fixture = budget.fixtures.find(({ id }: { id: string }) => id === WORKLOAD_ID);
		const workload = budget.workloads.find(({ id }: { id: string }) => id === 'm3-longform-editorial');
		const threshold = workload.thresholds.find(({ metricId }: { metricId: string }) => metricId === METRIC_ID);
		assert.deepEqual(fixture.specification, {
			localDiagnosticCommand: 'npm run quality:collect:m3-longform',
			routineBrowserTestBehavior: 'skip-with-explicit-collector',
			qualificationPublication: 'accepted-only-after-qualified-environment-and-digest-bound-verification',
			generatorRevision: 1,
			seed: 1_554_098_974,
			durationSeconds: 7_200,
			sampleRate: 48_000,
			videoFrameRate: { num: 30, den: 1 },
			audioTrackCount: 24,
			proxyVideoTrackCount: 2,
			editCount: 10_000,
			commandsPerTransaction: 250,
			operationCounts: {
				audioClipMoves: 2_500,
				proxyVideoClipMoves: 2_500,
				selectionChanges: 2_500,
				trackMixChanges: 2_500,
			},
			seekCheckpointsSamples: [0, 2_880_000, 86_400_000, 172_800_000, 345_552_000],
			scrollFrameIntervalSampleCount: 240,
			projectSha256: '4c96e2405d63ff282a28a6577c9da32d3598183e5ad59131cb3ca1977df34427',
			editPlanSha256: '2167cb31e4ff5454c6443c40904aadc12ae9cb2ca7cb22addee906f71a1fcadf',
		});
		assert.deepEqual(threshold, {
			metricId: METRIC_ID,
			comparison: 'lte',
			value: 268_435_456,
			unit: 'bytes',
		});

		const child = spawnSync(process.execPath, [
			'--expose-gc',
			'--import',
			'tsx',
			new URL(import.meta.url).pathname,
		], {
			cwd: new URL('..', import.meta.url).pathname,
			encoding: 'utf8',
			env: { ...process.env, [CHILD_FLAG]: '1' },
			maxBuffer: 4 * 1024 * 1024,
		});
		assert.equal(child.status, 0, child.stderr || child.stdout);
		const line = child.stdout.split('\n').find((value) => value.startsWith('FOUNDATION_HISTORY_MEASUREMENT='));
		assert.ok(line, child.stdout);
		const measurement = JSON.parse(line.slice('FOUNDATION_HISTORY_MEASUREMENT='.length));
		assert.equal(measurement.editCount, fixture.specification.editCount);
		assert.equal(measurement.retainedSnapshots, AUDIO_EDITOR_HISTORY_LIMIT + 1);
		assert.ok(measurement.retainedHeapDeltaBytes <= threshold.value, JSON.stringify(measurement));
		assert.ok(measurement.serializedHistoryBytes <= threshold.value, JSON.stringify(measurement));
	});
}

function measureFoundationHistory() {
	const editCount = 10_000;
	const project = createLongFormFoundationProject(editCount - AUDIO_EDITOR_HISTORY_LIMIT);
	globalThis.gc?.();
	const before = process.memoryUsage().heapUsed;
	let history = createEditorHistory(project);
	for (let index = editCount - AUDIO_EDITOR_HISTORY_LIMIT; index < editCount; index += 1) {
		history = executeEditorCommand(history, {
			type: 'project/rename',
			title: `Long-form editorial ${String(index + 1)}`,
		}, { now: '2026-08-09T12:00:00.000Z' });
	}
	globalThis.gc?.();
	return {
		editCount,
		retainedSnapshots: history.undoStack.length + 1,
		retainedHeapDeltaBytes: Math.max(0, process.memoryUsage().heapUsed - before),
		serializedHistoryBytes: serialize(history).byteLength,
	};
}

function createLongFormFoundationProject(revision: number) {
	const sampleRate = 48_000;
	const frameCount = 7_200 * sampleRate;
	const sources: Array<Record<string, unknown>> = [];
	const clips: Array<Record<string, unknown>> = [];
	const tracks: Array<Record<string, unknown>> = [];
	for (let index = 0; index < 24; index += 1) {
		const sourceId = `long-audio-source-${String(index)}`;
		const clipId = `long-audio-clip-${String(index)}`;
		sources.push({
			kind: 'audio', id: sourceId, storageKey: sourceId, name: sourceId,
			mimeType: 'audio/x-scape-f32', frameCount, channelCount: 2, sampleRate,
			originalSampleRate: sampleRate, sampleFormat: 'float32', chunkFrames: 65_536,
		});
		clips.push({
			kind: 'audio', id: clipId, sourceId, title: clipId, timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: frameCount, durationFrames: frameCount,
		});
		tracks.push({ type: 'audio', id: `long-audio-track-${String(index)}`, clipIds: [clipId] });
	}
	for (let index = 0; index < 2; index += 1) {
		const sourceId = `long-video-source-${String(index)}`;
		const clipId = `long-video-clip-${String(index)}`;
		sources.push({
			kind: 'video', id: sourceId, storageKey: sourceId, name: sourceId,
			mimeType: 'video/mp4', sampleFrameCount: frameCount, sampleRate,
			width: 1_280, height: 720, frameRate: { num: 30, den: 1 },
			sourceFrameCount: 216_000, videoCodec: 'h264', audioCodec: null, hasAudio: false,
			timingAsset: null, timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 30, den: 1 } },
		});
		clips.push({
			kind: 'video', id: clipId, sourceId, title: clipId, sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 216_000,
			sourceInFrame: 0, sourceFrameCount: 216_000,
		});
		tracks.push({ type: 'video', id: `long-video-track-${String(index)}`, clipIds: [clipId] });
	}
	return createCurrentAudioEditorProject({
		id: 'm3-longform-editorial-foundation',
		title: 'Long-form editorial foundation',
		now: '2026-08-09T12:00:00.000Z',
		revision,
		sampleRate,
		sources,
		clips,
		tracks,
	});
}
