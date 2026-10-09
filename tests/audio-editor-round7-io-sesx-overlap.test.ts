/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { buildSesxProject } from '../src/common/editor/sesx-import-project.ts';
import { parseSesxDocument } from '../src/common/editor/sesx-import.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createEnvelopeValueEvaluator } from '../src/common/editor/automation.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const SESSION = '<sesx><session sampleRate="48000" audioChannelType="mono"><tracks>'
	+ '<audioTrack id="1"><trackParameters><name>Dialogue</name></trackParameters><trackAudioParameters audioChannelType="mono"/>'
	+ '<audioClip id="0" fileID="0" name="Bed" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800" zOrder="1" clipAutoCrossfade="false"/>'
	+ '<audioClip id="1" fileID="1" name="Replacement" startPoint="1200" endPoint="3600" sourceInPoint="0" sourceOutPoint="2400" zOrder="2" clipAutoCrossfade="false"/>'
	+ '</audioTrack></tracks></session><files><file id="0" relativePath="bed.wav"/><file id="1" relativePath="voice.wav"/></files></sesx>';

function ids(): (prefix: string) => string { let next = 0; return (prefix) => `${prefix}-${++next}`; }

function bounds(project: { clips: readonly object[] }) {
	return project.clips.map((clip) => {
		const { title, timelineStartFrame, sourceStartFrame, durationFrames } = clip as Readonly<Record<string, unknown>>;
		return { title, timelineStartFrame, sourceStartFrame, durationFrames };
	}).sort((a, b) => Number(a.timelineStartFrame) - Number(b.timelineStartFrame));
}

const EXPECTED = [
	{ title: 'Bed', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1200 },
	{ title: 'Replacement', timelineStartFrame: 1200, sourceStartFrame: 0, durationFrames: 2400 },
	{ title: 'Bed', timelineStartFrame: 3600, sourceStartFrame: 3600, durationFrames: 1200 },
];

test('an Audition Bring Clip to Front edit imports only its audible source spans', () => {
	const plan = buildSesxProject(parseSesxDocument(SESSION), {
		media: new Map(['0', '1'].map((id) => [id, { frameCount: 4800, channelCount: 1, sampleRate: 48_000 }])),
		createStableId: ids(),
	});
	assert.deepEqual(bounds(plan.project as { clips: Record<string, unknown>[] }), EXPECTED);
	assert.ok(plan.report.items.some(({ code }) => code === 'sesx.overlap-order-converted'));
});

test('desktop File Open preserves ordinary Audition overlap order through PCM staging', async () => {
	const audio = new Blob([encodeWav([new Float32Array(4800).fill(0.25)], { sampleRate: 48_000, float: true }) as Uint8Array<ArrayBuffer>]);
	const fixture = createFixture({
		createStableId: ids(),
		fileService: {
			isDesktop: true,
			resolveSesxMedia: async () => ({ status: 'found', descriptor: { id: 'read', name: 'audio.wav', size: audio.size, lastModified: 0, mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', url: 'soundscaper-app://bundle/_desktop/read/audio' } }),
			chooseSesxMediaFolder: async () => ({ status: 'cancelled' }),
			withReadDescriptors: async (_descriptors, _options, consume) => await consume([audio]),
			releaseSesxSession: async () => true,
		},
	});
	const file = new File([SESSION], 'Interview.sesx');
	registerDesktopReadCapability(file, 'a'.repeat(64));
	const result = await createNativeProjectService(fixture.runtime).openSesx(file);
	assert.ok(result);
	assert.deepEqual(bounds(result.project), EXPECTED);
});

test('Bring Clip to Front uses stored zOrder even when XML clip order is unchanged', () => {
	const plan = buildSesxProject(parseSesxDocument(SESSION.replace('zOrder="1"', 'zOrder="3"')), {
		media: new Map(['0', '1'].map((id) => [id, { frameCount: 4800, channelCount: 1, sampleRate: 48_000 }])),
		createStableId: ids(),
	});
	assert.deepEqual(bounds(plan.project as { clips: Record<string, unknown>[] }), [
		{ title: 'Bed', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4800 },
	]);
	assert.equal((plan.project.sources as unknown[]).length, 1);
	assert.equal(plan.media.length, 1);
});

test('an occluded clip keeps its original linear fade gain on both visible fragments', () => {
	const xml = SESSION.replace('clipAutoCrossfade="false"/>', 'clipAutoCrossfade="false"><fadeIn startPoint="0" endPoint="4000" type="linear"/><fadeOut startPoint="800" endPoint="4800" type="linear"/></audioClip>');
	const plan = buildSesxProject(parseSesxDocument(xml), {
		media: new Map(['0', '1'].map((id) => [id, { frameCount: 4800, channelCount: 1, sampleRate: 48_000 }])),
		createStableId: ids(),
	});
	for (const clip of plan.project.clips as Array<{ title: string; timelineStartFrame: number; durationFrames: number; fadeInFrames: number; fadeOutFrames: number; envelope: { frame: number; value: number }[] }>) {
		if (clip.title !== 'Bed') continue;
		assert.equal(clip.fadeInFrames, 0); assert.equal(clip.fadeOutFrames, 0);
		const evaluate = createEnvelopeValueEvaluator(clip.envelope, clip.durationFrames);
		for (let frame = 0; frame <= clip.durationFrames; frame += 17) {
			const originalFrame = clip.timelineStartFrame + frame;
			const expected = Math.min(1, originalFrame / 4000) * Math.min(1, (4800 - originalFrame) / 4000);
			assert.ok(Math.abs(evaluate(frame) - expected) <= 0.000011);
		}
	}
});
