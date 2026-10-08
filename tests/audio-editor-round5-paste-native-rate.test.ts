/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPasteIntoExistingClipCommand, type ExistingClipPasteDerivedSourcesPort }
	from '../src/common/editor/controller/edit/paste-existing-clip-service.ts';
import type { AudioEditorClipboard, AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { ControllerProject, ControllerSource }
	from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';

function amplitude(samples: Float32Array, frequency: number, first: number, last: number) {
	let real = 0, imaginary = 0;
	for (let frame = first; frame < last; frame++) {
		const angle = 2 * Math.PI * frequency * frame / 48_000;
		real += samples[frame]! * Math.cos(angle);
		imaginary += samples[frame]! * Math.sin(angle);
	}
	return 2 * Math.hypot(real, imaginary) / (last - first);
}

async function join(nativeSide: 'copied' | 'existing' | 'neutral', reversed = false, options: Readonly<{
	sampleRate?: number; frequency?: number; loop?: boolean;
}> = {}) {
	const frames = 4800;
	const nativeRate = options.sampleRate ?? 32_000, frequency = options.frequency ?? 12_000;
	const sources = ['existing', 'copied'].map(id => createAudioSource({ id, storageKey: id, name: id,
		mimeType: 'audio/wav', sampleRate: nativeSide === id ? nativeRate : 48_000,
		frameCount: nativeSide === id ? nativeRate / 10 : frames, channelCount: 1 }));
	const channels = new Map(sources.map(source => [source.id, Float32Array.from({ length: source.frameCount },
		(_value, frame) => source.id === (nativeSide === 'neutral' ? 'copied' : nativeSide)
			? Math.sin(2 * Math.PI * frequency * frame / source.sampleRate) * 0.35 : 0)]));
	const before = [...channels.values()].map(values => values.slice());
	const existing = sources[0]!, copied = sources[1]!;
	const document = createCurrentAudioEditorProject({ id: 'native-paste', now: '2026-10-08T10:00:00Z',
		sources, clips: [createAudioClip({ id: 'clip', sourceId: existing.id, sourceDurationFrames: existing.frameCount,
			durationFrames: frames })], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const project = projectForCommand(document) as ControllerProject;
	const durationFrames = options.loop ? frames * 2 : frames;
	const clipboard: AudioEditorClipboard = { schemaVersion: 2, sampleRate: 48_000, durationFrames,
		tracks: [{ sourceTrackId: 'copied-track', sourceTrackName: 'Copied', sourceTrackType: 'audio',
			clips: [{ key: 'copy', kind: 'audio', sourceId: copied.id, offsetFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: copied.frameCount, durationFrames, reversed,
				...(options.loop ? { opaqueExtensions: { 'org.soundscaper.clip-loop/v1': {
					periodFrames: frames, offsetFrames: 0 } } } : {}) }] }] };
	const command: Extract<AudioEditorCommand, { type: 'clipboard/paste' }> = {
		type: 'clipboard/paste', clipboard, atFrame: 2400, mode: 'overlap', pasteIntoExistingClip: true,
		trackMap: { 'copied-track': 'track' }, clipIds: { copy: 'pasted' }, collisionClipIds: ['clip'],
		collisionTrackIds: ['track'], splitClipIds: { clip: 'right' } };
	const rendered: Float32Array[][] = [], commits: AudioEditorCommand[] = [];
	const derivedSources: ExistingClipPasteDerivedSourcesPort = {
		sourceChannelsForEdit: source => Promise.resolve([channels.get(source.id)!.slice()]),
		persistDerivedSource(template: ControllerSource, values, name) {
			rendered.push(values);
			return Promise.resolve({ source: { ...template, id: 'joined', storageKey: 'joined', name,
				frameCount: values[0]!.length }, buffer: null, channels: values });
		},
		rollbackDerivedSources: () => Promise.resolve(),
	};
	await commitPasteIntoExistingClipCommand({ command, project, derivedSources,
		preflightStorage: () => Promise.resolve(), assertCurrent: () => undefined,
		commit(prepared) { commits.push(prepared); return applyEditorCommand(document, prepared); } });
	assert.equal(commits.length, 1);
	assert.equal(rendered.length, 1);
	assert.deepEqual([...channels.values()], before, 'the original immutable PCM remains intact');
	assert.equal(rendered[0]![0]!.length, frames + durationFrames);
	return rendered[0]![0]!;
}

for (const side of ['copied', 'existing'] as const) {
	test(`native-rate ${side} audio is bandlimited before joined-paste publication`, async () => {
		const samples = await join(side);
		const first = side === 'copied' ? 3000 : 600;
		assert.ok(amplitude(samples, 20_000, first, first + 1200) < 0.003,
			'joining must not add a strong resampling image to the stored audio');
		assert.ok(amplitude(samples, 12_000, first, first + 1200) > 0.34);
	});
}

test('reversed native-rate clipboard audio preserves its spectrum', async () => {
	const samples = await join('copied', true);
	assert.ok(amplitude(samples, 20_000, 3000, 4200) < 0.003);
	assert.ok(amplitude(samples, 12_000, 3000, 4200) > 0.34);
});

test('same-rate neutral samples retain their exact values across joining', async () => {
	const samples = await join('neutral');
	for (let frame = 0; frame < 4800; frame++) assert.equal(samples[2400 + frame],
		Math.fround(Math.sin(2 * Math.PI * 12_000 * frame / 48_000) * 0.35));
});

test('native downsampling rejects source energy above the project Nyquist frequency', async () => {
	const samples = await join('copied', false, { sampleRate: 96_000, frequency: 32_000 });
	assert.ok(amplitude(samples, 16_000, 3000, 4200) < 0.003);
});

test('native loop repetitions retain their source bandwidth and period', async () => {
	const samples = await join('copied', false, { loop: true });
	assert.ok(amplitude(samples, 12_000, 3000, 4200) > 0.34);
	assert.ok(amplitude(samples, 12_000, 7800, 9000) > 0.34);
	assert.ok(amplitude(samples, 20_000, 7800, 9000) < 0.003);
	assert.deepEqual(samples.slice(3000, 4200), samples.slice(7800, 9000));
});
