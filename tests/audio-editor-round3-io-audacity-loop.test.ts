/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { audacityXmlAttribute, audacityXmlChildren } from '../src/common/editor/audacity-binary-xml.js';
import { normalizeAup4ExportSnapshot } from '../src/common/editor/aup4-export.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { nativeBlockFixture } from './helpers/aup4-export-harness.js';

function deliver(options: Readonly<{ offset?: number; duration?: number; period?: number; sourceRate?: number; reversed?: boolean; linked?: boolean }> = {}) {
	const sourceRate = options.sourceRate ?? 48_000;
	const period = options.period ?? 4;
	const duration = options.duration ?? period * 2;
	const source = createAudioSource({ id: 'source', sampleRate: sourceRate, frameCount: 6, channelCount: 1 });
	const base = { ...createAudioClip({ id: 'clip', sourceId: source.id, reversed: options.reversed ?? false,
		linkPitchAndTempo: options.linked ?? false }), durationFrames: period, sourceStartFrame: 1, sourceDurationFrames: 4 };
	const clip = { ...base, ...clipLoopUpdateFields(base, { periodFrames: period, durationFrames: duration, offsetFrames: options.offset ?? 0 }) };
	const project = createSoundscaperProject({ id: 'loop-project', sampleRate: 48_000, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const original = structuredClone(project);
	const snapshot = normalizeAup4ExportSnapshot(project, [{ sourceId: source.id, sampleRate: sourceRate,
		channels: [Float32Array.of(0.1, 0.2, 0.3, 0.4, 0.5, 0.6)] }]);
	assert.deepEqual(project, original, 'materialization must leave the canonical recording unchanged');
	return snapshot;
}

test('Audacity material repeats the source window without stretching one source pass', () => {
	const delivered = deliver();
	assert.deepEqual(delivered.sources[0]!.channels[0], Float32Array.of(0.2, 0.3, 0.4, 0.5, 0.2, 0.3, 0.4, 0.5));
	assert.equal(delivered.project.clips[0]!.sourceStartFrame, 0);
	assert.equal(delivered.project.clips[0]!.sourceDurationFrames, 8);
	assert.equal(delivered.project.clips[0]!.durationFrames, 8);
	assert.equal(readClipLoop(delivered.project.clips[0]!), null);
	assert.ok(delivered.compatibilityReport.items.some((item: { code: string }) => item.code === 'CLIP_LOOP_RENDERED'));
});

for (const reversed of [false, true]) test(`Audacity repeated material keeps partial-loop phase in ${reversed ? 'reversed' : 'forward'} playback`, () => {
	const delivered = deliver({ reversed, offset: 2, duration: 10 });
	const expected = reversed ? [0.3, 0.2, 0.5, 0.4] : [0.4, 0.5, 0.2, 0.3];
	assert.deepEqual(delivered.sources[0]!.channels[0], Float32Array.from([...expected, ...expected, ...expected.slice(0, 2)]));
});

test('a native-rate loop keeps its source sample clock through materialization', () => {
	const delivered = deliver({ sourceRate: 24_000, period: 8 });
	assert.equal(delivered.sources[0]!.sampleRate, 24_000);
	assert.equal(delivered.sources[0]!.channels[0]!.length, 8);
	assert.equal(delivered.project.clips[0]!.durationFrames, 16);
	assert.equal(nativeStretch(delivered), 1);
});

test('Audacity stretches the repeated PCM once for an independent stretched loop', () => {
	const delivered = deliver({ period: 8 });
	assert.equal(delivered.sources[0]!.channels[0]!.length, 8);
	assert.equal(nativeStretch(delivered), 2);
});

test('a linked loop bakes the per-repeat speed and keeps native stretching neutral', () => {
	const delivered = deliver({ period: 8, linked: true });
	const samples: Float32Array = delivered.sources[0]!.channels[0]!;
	assert.equal(samples.length, 16);
	assert.deepEqual(samples.slice(0, 8), samples.slice(8));
	assert.equal(nativeStretch(delivered), 1);
	assert.equal(delivered.project.clips[0]!.linkPitchAndTempo, false);
});

function nativeStretch(snapshot: ReturnType<typeof normalizeAup4ExportSnapshot>): unknown {
	const blocks = nativeBlockFixture(snapshot.sources);
	const tree = createAup4ProjectTree(snapshot.project, blocks.channelBlocks);
	const track = audacityXmlChildren(tree).find((node: { name: string }) => node.name === 'wavetrack');
	const clip = audacityXmlChildren(track).find((node: { name: string }) => node.name === 'waveclip');
	return audacityXmlAttribute(clip, 'clipStretchRatio');
}
