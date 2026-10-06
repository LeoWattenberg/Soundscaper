/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function deliver(options: Readonly<{ sourceStart?: number; period?: number; offset?: number }> = {}) {
	const sampleRate = 48_000;
	const period = options.period ?? 38_400;
	const source = createAudioSource({ id: 'recording', name: 'Take.wav', sampleRate: 44_100,
		frameCount: 44_100, channelCount: 1 });
	const base = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 38_400,
		sourceStartFrame: options.sourceStart ?? 0, sourceDurationFrames: 35_280 });
	assert.equal(typeof base.durationFrames, 'number');
	assert.equal(typeof base.sourceStartFrame, 'number');
	assert.equal(typeof base.sourceDurationFrames, 'number');
	const loopable = { ...base, durationFrames: Number(base.durationFrames),
		sourceStartFrame: Number(base.sourceStartFrame), sourceDurationFrames: Number(base.sourceDurationFrames) };
	const clip = { ...base, ...clipLoopUpdateFields(loopable, {
		periodFrames: period, durationFrames: period * 2, offsetFrames: options.offset ?? 0,
	}) };
	const project = createSoundscaperProject({ id: 'looped-recording', sampleRate, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'audio', name: 'Audio', clipIds: [clip.id] })] });
	const deliveredProject = projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>>;
	const result = createDawprojectExport({ project: deliveredProject });
	const elements = [...walkXml(result.document)];
	const delivered = elements.find(({ name }) => name === 'Clip');
	assert.ok(delivered);
	return { result, delivered, elements };
}

test('a loop extension keeps the source rate and repeats instead of becoming a stretch', () => {
	const { result, delivered, elements } = deliver();
	assert.equal(delivered.attributes.duration, '1.6');
	assert.equal(delivered.attributes.loopStart, '0');
	assert.equal(delivered.attributes.loopEnd, '0.8');
	assert.equal(delivered.attributes.playStart, '0');
	assert.equal(elements.some(({ name }) => name === 'Warps'), false);
	assert.equal(result.report.items.some(({ code }) => code === 'dawproject.speed-change-converted'), false);
});

test('a split loop keeps its trimmed source window and advancing phase', () => {
	const { delivered } = deliver({ sourceStart: 4_410, offset: 9_600 });
	assert.equal(delivered.attributes.loopStart, '0.1');
	assert.equal(Number(delivered.attributes.loopEnd), 0.9);
	assert.ok(Math.abs(Number(delivered.attributes.playStart) - 0.3) < 1e-12);
});

test('a rate-stretched loop warps one period and repeats that delivered period', () => {
	const { delivered, elements } = deliver({ sourceStart: 4_410, period: 76_800, offset: 19_200 });
	assert.equal(delivered.attributes.duration, '3.2');
	assert.equal(delivered.attributes.loopStart, '0');
	assert.equal(delivered.attributes.loopEnd, '1.6');
	assert.equal(delivered.attributes.playStart, '0.4');
	assert.deepEqual(elements.filter(({ name }) => name === 'Warp').map(({ attributes }) => (
		{ time: attributes.time, contentTime: attributes.contentTime }
	)), [{ time: '0', contentTime: '0.1' }, { time: '1.6', contentTime: '0.9' }]);
});
