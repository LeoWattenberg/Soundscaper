/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseNestedCommandAction, clipByName, closeDialog, commitInput,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('Blender publishes the audible delay release and retains it for a separately muted stem', async ({ page }) => {
	const notices = [];
	page.on('dialog', dialog => { notices.push(dialog.message()); void dialog.dismiss(); });
	await page.addInitScript(() => {
		const probe = { tracks: [], chunks: [], completed: 0, selects: 0, begins: 0, aborted: 0 };
		globalThis.__blenderStemRelease = probe;
		const bridge = {
			getEnvironment: async () => null, signalReady: async () => undefined,
			onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
			blender: {
				select: async () => { probe.selects++; return { sessionId: 'stem-release-session' }; },
				begin: async ({ tracks }) => { probe.begins++; probe.tracks = tracks; probe.chunks = []; return { publicationId: 'stem-release-publication' }; },
				write: async ({ offset, bytes }) => { probe.chunks.push({ offset, bytes: Array.from(bytes) }); },
				commit: async () => ({ revision: ++probe.completed }),
				abort: async () => { probe.aborted++; }, stop: async () => undefined,
			},
		};
		globalThis.soundscaperDesktop = Object.freeze({ v1: Object.freeze(bridge) });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Blender delayed recording.wav',
		frequency: 440, duration: 1, channelCount: 2, sampleRate: 48_000 })]);
	const publish = async () => {
		const before = await page.evaluate(() => globalThis.__blenderStemRelease.completed);
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export track list for Blender']);
		await expect.poll(() => page.evaluate(() => ({ selects: globalThis.__blenderStemRelease.selects,
			begins: globalThis.__blenderStemRelease.begins, completed: globalThis.__blenderStemRelease.completed,
			aborted: globalThis.__blenderStemRelease.aborted }))).toMatchObject({ completed: before + 1 });
		await expect.poll(() => notices.at(-1)).toContain('The Blender bundle is ready.');
		return await page.evaluate(async () => {
			const probe = globalThis.__blenderStemRelease;
			const length = probe.chunks.reduce((end, chunk) => Math.max(end, chunk.offset + chunk.bytes.length), 0);
			const bytes = new Uint8Array(length);
			for (const chunk of probe.chunks) bytes.set(chunk.bytes, chunk.offset);
			const context = new AudioContext({ sampleRate: 48_000 });
			try {
				const audio = await context.decodeAudioData(bytes.buffer);
				let tailPeak = 0;
				for (const value of audio.getChannelData(0).subarray(48_128, 95_872)) tailPeak = Math.max(tailPeak, Math.abs(value));
				return { frames: audio.length, tailPeak, track: probe.tracks[0] };
			} finally { await context.close(); }
		});
	};
	expect((await publish()).frames).toBe(48_000);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Feedback delay');
	const effect = page.getByRole('dialog', { name: 'Feedback delay', exact: true });
	for (const [parameter, value] of Object.entries({ time: '1', feedback: '0', mix: '1' })) {
		await commitInput(effect.locator(`[data-effect-param="${parameter}"] input`), value);
	}
	await closeDialog(effect);
	const healthy = await publish();
	expect(healthy.frames).toBe(96_000);
	expect(healthy.tailPeak).toBeGreaterThan(.1);
	expect(healthy.track).toMatchObject({ durationSeconds: 2, mute: false });
	await clipByName(editor, 'Blender delayed recording.wav').locator('xpath=ancestor::div[@data-track-row]')
		.getByRole('button', { name: 'Mute', exact: true }).click();
	const muted = await publish();
	expect(muted.track.mute).toBe(true);
	expect(muted.frames).toBe(healthy.frames);
	expect(muted.tailPeak).toBeCloseTo(healthy.tailPeak, 5);
});
