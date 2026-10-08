/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioEditorClipboard, AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { commitPasteIntoExistingClipCommand, type ExistingClipPasteDerivedSourcesPort }
	from '../src/common/editor/controller/edit/paste-existing-clip-service.ts';
import type { ControllerProject, ControllerSource }
	from '../src/common/editor/controller/track-audio/track-domain-types.ts';

type PasteCommand = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;

function fixture(targetSpeed: number, pastedSpeed: number, linked: boolean) {
	const source: ControllerSource = { id: 'source', storageKey: 'source', name: 'Recording',
		mimeType: 'audio/wav', frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000 };
	const project: ControllerProject = { schemaVersion: 17, id: 'project', title: 'Project', sampleRate: 48_000,
		sources: [source], tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['existing'] }],
		clips: [{ id: 'existing', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 8, durationFrames: 8 / targetSpeed, speedRatio: targetSpeed,
			linkPitchAndTempo: linked }], mixer: { groups: [], sends: [], routes: {} } };
	const clipboard: AudioEditorClipboard = { schemaVersion: 2, sampleRate: 48_000,
		durationFrames: 8 / pastedSpeed, tracks: [{ sourceTrackId: 'copied', sourceTrackName: 'Copied',
			sourceTrackType: 'audio', clips: [{ key: 'copied:clip', kind: 'audio', sourceId: source.id,
				offsetFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 8, durationFrames: 8 / pastedSpeed,
				speedRatio: pastedSpeed, linkPitchAndTempo: linked }] }] };
	const command: PasteCommand = { type: 'clipboard/paste', clipboard, atFrame: 2, mode: 'overlap',
		pasteIntoExistingClip: true, trackMap: { copied: 'track' }, clipIds: { 'copied:clip': 'pasted' },
		collisionClipIds: ['existing'], collisionTrackIds: ['track'], splitClipIds: { existing: 'right' } };
	const renders: Float32Array[][] = [], commits: AudioEditorCommand[] = [];
	let reads = 0;
	const derivedSources: ExistingClipPasteDerivedSourcesPort = {
		sourceChannelsForEdit() { reads += 1; return Promise.resolve([Float32Array.of(1, 2, 3, 4, 5, 6, 7, 8)]); },
		persistDerivedSource(template, channels, name) {
			renders.push(channels);
			return Promise.resolve({ source: { ...template, id: 'joined', storageKey: 'joined', name,
				frameCount: channels[0]!.length }, buffer: null, channels });
		},
		rollbackDerivedSources: () => Promise.resolve(),
	};
	return { command, commits, renders, readCount: () => reads,
		request: { command, project, derivedSources, preflightStorage: () => Promise.resolve(),
			assertCurrent: () => undefined, commit: (prepared: AudioEditorCommand) => { commits.push(prepared); } } };
}

for (const [target, pasted] of [[1, 2], [2, 1], [1, 0.5], [0.5, 1]] as const) {
	test(`independent speed target=${String(target)} copied=${String(pasted)} retains the original paste command`, async () => {
		const value = fixture(target, pasted, false);
		await commitPasteIntoExistingClipCommand(value.request);
		assert.deepEqual(value.commits, [value.command]);
		assert.equal(value.readCount(), 0, 'complex processing must remain with the clip render owner');
		assert.deepEqual(value.renders, []);
	});
}

test('linked varispeed still joins the exact source-index PCM', async () => {
	const value = fixture(2, 2, true);
	await commitPasteIntoExistingClipCommand(value.request);
	assert.equal(value.readCount(), 2);
	assert.deepEqual(Array.from(value.renders[0]![0]!), [1, 3, 1, 3, 5, 7, 5, 7]);
	assert.notEqual(value.commits[0], value.command);
});

test('neutral independent speed still joins without changing samples', async () => {
	const value = fixture(1, 1, false);
	await commitPasteIntoExistingClipCommand(value.request);
	assert.deepEqual(Array.from(value.renders[0]![0]!), [1, 2, 1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 5, 6, 7, 8]);
	assert.notEqual(value.commits[0], value.command);
});
