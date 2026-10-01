/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseRenderStrategy, createExportPlan } from '../src/common/editor/export.js';
import { estimateExportSourceWorkingSetBytes } from '../src/common/editor/export-source-working-set.ts';

const RATE = 48_000;
const CHUNK = 65_536;
const bytes = (frames: number) => frames * 8;

function projectFixture() {
	const frames = RATE * 3_600;
	return {
		schemaVersion: 9, id: 'project', title: 'Hour', sampleRate: RATE, masterChannels: 2,
		selection: { startFrame: RATE * 60, endFrame: RATE * 70 },
		metadata: {}, loop: { enabled: false, startFrame: 0, endFrame: frames },
		sources: [{ id: 'source', storageKey: 'pcm/source', frameCount: frames,
			channelCount: 2, sampleRate: RATE, chunkFrames: CHUNK, sampleFormat: 'float32' }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: frames, sourceDurationFrames: frames }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'], effects: [] }],
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	};
}

function estimate(project = projectFixture(), start = RATE * 60, end = RATE * 70) {
	return estimateExportSourceWorkingSetBytes(project, [{ startFrame: start, endFrame: end }]);
}

test('ten-second selections from hour-long chunked audio can render offline', () => {
	const plan = createExportPlan(projectFixture(), { range: 'selection', includeTail: false, mobile: true });
	const render = plan.render as ReturnType<typeof chooseRenderStrategy>;
	assert.equal(render.strategy, 'offline');
	assert.ok(render.livePcmBytes < bytes(RATE * 20 + CHUNK * 3));
	assert.ok(render.livePcmBytes >= bytes(RATE * 20), 'includes ten seconds of pre-roll');
	assert.equal(createExportPlan(projectFixture(), { includeTail: false }).render.strategy, 'realtime-stream');
});

test('direct PCM estimates retain complete boundary chunks and transient storage reads', () => {
	const start = RATE * 50;
	const end = RATE * 70;
	const first = Math.floor(start / CHUNK);
	const last = Math.ceil(end / CHUNK);
	assert.equal(estimate(), bytes((last - first + 1) * CHUNK));
});

test('sources outside the render window add no chunk allocations', () => {
	const project = projectFixture();
	project.clips[0]!.timelineStartFrame = RATE * 100;
	assert.equal(estimate(project), 0);
});

test('small and unproven source geometries retain full decoded-size accounting', () => {
	const project = projectFixture();
	project.sources[0]!.frameCount = RATE;
	assert.equal(estimate(project, 0, RATE), bytes(RATE));
	const unproven = projectFixture();
	delete (unproven.sources[0] as { chunkFrames?: number }).chunkFrames;
	assert.equal(estimate(unproven), bytes(RATE * 3_600));
});

test('repeated clips allocate their own chunk buffers, including muted tracks', () => {
	const project = projectFixture();
	project.clips.push({ ...project.clips[0]!, id: 'second' });
	project.tracks.push({ id: 'muted', type: 'audio', clipIds: ['second'], effects: [], mute: true } as never);
	assert.equal(estimate(project), estimate() * 2);
});

test('chapter-sized ranges use the largest individual working set', () => {
	const project = projectFixture();
	assert.equal(estimateExportSourceWorkingSetBytes(project, [
		{ startFrame: RATE, endFrame: RATE * 2 },
		{ startFrame: RATE * 60, endFrame: RATE * 70 },
	]), estimate());
});

test('resampled chunk clips charge the output buffer and bounded input scratch', () => {
	const project = projectFixture();
	project.clips[0]!.sourceDurationFrames /= 2;
	const value = estimate(project);
	assert.ok(value >= bytes(RATE * 40));
	assert.ok(value < bytes(RATE * 45));
});

test('reversal stays bounded for long chunked sources', () => {
	const project = projectFixture();
	Object.assign(project.clips[0]!, { reversed: true });
	assert.ok(estimate(project) < bytes(RATE * 20 + CHUNK * 5 + 8_192));
});

test('explicit live PCM overrides still enforce the existing memory threshold', () => {
	const plan = createExportPlan(projectFixture(), {
		range: 'selection', includeTail: false, livePcmBytes: 2 * 1024 ** 3,
	});
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.reason, 'total-memory');
});


test('scalar caches outside the export range retain conservative full-source exposure', () => {
	const project = projectFixture();
	project.clips[0]!.timelineStartFrame = RATE * 100;
	Object.assign(project.clips[0]!, { pitchCents: 100 });
	assert.ok(estimate(project) >= bytes(RATE * 3_600) * 4);
});


test('source PCM and context/crop PCM share the total-memory ceiling', () => {
	const render = chooseRenderStrategy({
		mobile: true, outputBytes: 70 * 1024 ** 2, livePcmBytes: 240 * 1024 ** 2,
		offlineRenderAdmission: { admitted: true, peakUsefulBinaryBytes: 150 * 1024 ** 2 },
	});
	assert.equal(render.strategy, 'realtime-stream');
	assert.equal(render.reason, 'total-memory');
});


test('warped clips with scalar fields still account for the scalar cache preparation', () => {
	const project = projectFixture();
	project.clips[0]!.timelineStartFrame = RATE * 100;
	Object.assign(project.clips[0]!, { pitchCents: 100, warpMap: { points: [] } });
	assert.ok(estimate(project) >= bytes(RATE * 3_600) * 4);
});
