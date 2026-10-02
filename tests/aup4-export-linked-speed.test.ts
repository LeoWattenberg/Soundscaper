/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audacityXmlAttribute, audacityXmlChildren, createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { createAup3ProjectDocument } from '../src/common/editor/aup3-profile.ts';
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';
import { normalizeAup4ExportSnapshot } from '../src/common/editor/aup4-export.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { nativeBlockFixture } from './helpers/aup4-export-harness.js';

for (const generation of ['aup3', 'aup4'] as const) {
	for (const reversed of [false, true]) {
		test(`${generation} bakes linked sample speed into PCM and preserves ${reversed ? 'reversed' : 'forward'} trims`, async () => {
			const project = fixture({ reversed, speedRatio: 1.5 });
			const before = structuredClone(project);
			const snapshot = normalizeAup4ExportSnapshot(project, [tone()]);
			const exported = snapshot.project.clips[0]!;
			assert.equal(exported.pitchCents, 0, 'retained independent pitch is not part of linked playback');
			assert.equal(exported.speedRatio, 1);
			assert.equal(exported.linkPitchAndTempo, false);
			assert.equal(exported.stretchToTempo, false);
			assert.equal(exported.sourceStartFrame, reversed ? 600 : 1200);
			assert.equal(exported.sourceDurationFrames, 12000);
			assert.equal(exported.trimStartFrames, reversed ? 600 : 1200);
			assert.equal(exported.trimEndFrames, reversed ? 1200 : 600);
			assert.equal(snapshot.sources[0]!.channels[0]!.length, 13800);
			assertFrequency(snapshot.sources[0]!.channels[0]!, 24000, 600);
			assert.ok(snapshot.compatibilityReport.items.some((item: { code: string; disposition: string; data?: { playbackRate?: number } }) =>
				item.code === 'LINKED_PITCH_TEMPO_RENDERED' && item.disposition === 'converted' && item.data?.playbackRate === 2));
			assert.deepEqual(project, before, 'native export leaves the authored clip and hidden independent pitch alone');

			const blocks = nativeBlockFixture(snapshot.sources);
			let tree = createAup4ProjectTree(snapshot.project, blocks.channelBlocks);
			if (generation === 'aup3') {
				const document = createAup3ProjectDocument(snapshot.project, blocks.channelBlocks).document;
				const root = document.roots.find(entry => entry.kind === 'node');
				assert.ok(root?.kind === 'node');
				tree = root.node;
			}
			const nativeTrack = audacityXmlChildren(tree).find((node: { name: string }) => node.name === 'wavetrack');
			const nativeClip = audacityXmlChildren(nativeTrack).find((node: { name: string }) => node.name === 'waveclip');
			assert.equal(audacityXmlAttribute(nativeClip, 'centShift'), 0);
			assert.equal(audacityXmlAttribute(nativeClip, 'clipStretchRatio'), 1);
			assert.equal(audacityXmlAttribute(nativeClip, 'clipTempo'), undefined);
			assert.equal(audacityXmlAttribute(nativeClip, 'rawAudioTempo'), generation === 'aup3' ? 0 : undefined);
			let nextId = 0;
			const reopened = await decodeAup4ProjectTree(tree, async (blockId: number) => blocks.sampleBlocks.get(blockId), {
				idFactory: (prefix: string) => `${prefix}-${++nextId}`, sourceGeneration: generation,
			});
			const clip = reopened.project.clips[0]!;
			assert.equal(clip.timelineStartFrame, 9600);
			assert.equal(clip.durationFrames, 24000);
			assert.equal(clip.sourceDurationFrames, 12000);
			assert.equal(clip.sourceStartFrame, exported.sourceStartFrame);
			assert.equal(clip.pitchCents, 0);
			assert.equal(clip.speedRatio, 1);
			assertFrequency(reopened.sources[0]!.channels[0]!, Number(reopened.sources[0]!.sampleRate), 600);
		});
	}
}

test('unity linked native export ignores independent pitch without changing PCM', () => {
	const project = fixture({ sourceStartFrame: 0, sourceDurationFrames: 48000, durationFrames: 96000,
		trimStartFrames: 0, trimEndFrames: 0, speedRatio: 4 });
	const input = tone();
	const snapshot = normalizeAup4ExportSnapshot(project, [input]);
	assert.deepEqual(snapshot.sources[0]!.channels[0], input.channels[0]);
	assert.equal(snapshot.project.clips[0]!.pitchCents, 0);
	assert.equal(snapshot.project.clips[0]!.speedRatio, 1);
	assertFrequency(snapshot.sources[0]!.channels[0]!, 24000, 300);
});

test('linked and independent clips sharing media receive separate native PCM variants', () => {
	const project = fixture();
	project.clips.push({ ...project.clips[0]!, id: 'independent', timelineStartFrame: 100000, linkPitchAndTempo: false });
	project.tracks[0]!.clipIds.push('independent');
	const snapshot = normalizeAup4ExportSnapshot(project, [tone()]);
	assert.equal(snapshot.sources.length, 2);
	assert.notEqual(snapshot.project.clips[0]!.sourceId, snapshot.project.clips[1]!.sourceId);
	assert.equal(snapshot.project.clips[1]!.pitchCents, 700);
	assertFrequency(snapshot.sources[0]!.channels[0]!, 24000, 600);
	assertFrequency(snapshot.sources[1]!.channels[0]!, 24000, 300);
});

test('linked variants keep fractional effective input rates and mixed-rate trim boundaries', () => {
	const project = fixture({ sourceStartFrame: 2401, sourceDurationFrames: 24001, durationFrames: 32001,
		trimStartFrames: 1201, trimEndFrames: 601 });
	project.sources.push({ ...project.sources[0]!, id: 'other', storageKey: 'other', sampleRate: 48000, frameCount: 48000 });
	project.clips.push({ ...project.clips[0]!, id: 'other', sourceId: 'other', timelineStartFrame: 100000,
		sourceStartFrame: 0, sourceDurationFrames: 48000, durationFrames: 48000, trimStartFrames: 0, trimEndFrames: 0,
		linkPitchAndTempo: false });
	project.tracks[0]!.clipIds.push('other');
	const snapshot = normalizeAup4ExportSnapshot(project, [tone(), { ...tone(), sourceId: 'other', sampleRate: 48000 }]);
	const exported = snapshot.project.clips[0]!;
	const ratio = 32001 / 24001;
	const scaled = (frame: number) => Math.round(frame * ratio);
	assert.equal(exported.sourceStartFrame, scaled(2401) - scaled(1200));
	assert.equal(exported.sourceDurationFrames, scaled(26402) - scaled(2401));
	assert.equal(exported.trimStartFrames, scaled(2401) - scaled(1200));
	assert.equal(exported.trimEndFrames, scaled(27003) - scaled(26402));
	assert.equal(snapshot.sources[0]!.channels[0]!.length, scaled(27003) - scaled(1200));
	assert.equal(snapshot.sources[0]!.sampleRate, 48000);
	assertFrequency(snapshot.sources[0]!.channels[0]!, 48000, 300 * (24001 / 24000) / (32001 / 48000));
});

function fixture(overrides: Record<string, unknown> = {}) {
	return {
		id: 'project', title: 'Linked native export', sampleRate: 48000, tempo: 180,
		selection: { startFrame: 0, endFrame: 0, trackIds: [] }, metadata: {}, master: { effects: [] },
		sources: [{ id: 'source', name: 'Source', storageKey: 'source', mimeType: 'audio/wav',
			sampleRate: 24000, originalSampleRate: 24000, frameCount: 48000, channelCount: 1, sampleFormat: 'float32' }],
		clips: [{ id: 'clip', sourceId: 'source', title: 'Clip', timelineStartFrame: 9600,
			sourceStartFrame: 4800, sourceDurationFrames: 24000, durationFrames: 24000,
			trimStartFrames: 2400, trimEndFrames: 1200, envelope: [], reversed: false,
			linkPitchAndTempo: true, pitchCents: 700, speedRatio: 2, stretchToTempo: true,
			tempo: 240, rawAudioTempo: 90, opaqueExtensions: { aup4WaveClip: { node: createAudacityXmlNode('waveclip', [
				{ kind: 'attribute', name: 'clipTempo', type: 'double', value: 160 },
				{ kind: 'attribute', name: 'rawAudioTempo', type: 'double', value: 80 },
			]) } }, ...overrides }],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effects: [] }],
	};
}

function tone() {
	return { sourceId: 'source', sampleRate: 24000,
		channels: [Float32Array.from({ length: 48000 }, (_, frame) => 0.5 * Math.sin(2 * Math.PI * 300 * frame / 24000))] };
}

function assertFrequency(samples: Float32Array, sampleRate: number, expected: number): void {
	const crossings: number[] = [];
	for (let index = 100; index < samples.length - 100; index++) {
		if (samples[index - 1]! <= 0 && samples[index]! > 0) crossings.push(index);
	}
	assert.ok(crossings.length > 3);
	const frequency = (crossings.length - 1) * sampleRate / (crossings.at(-1)! - crossings[0]!);
	assert.ok(Math.abs(frequency - expected) < 1, `Expected ${expected} Hz; got ${frequency} Hz`);
}
