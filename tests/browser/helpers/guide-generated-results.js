/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { chooseNestedCommandAction } from '../audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './editor-databases.js';

const DURATIONS = {
	'generate-white-noise': 2,
	'generate-a-frequency-sweep': 2,
	'generate-dtmf-tones': 2,
};

/** Assert requested generator timing and the cut command's clipboard result. */
export async function verifyGeneratedGuideResults(page, id) {
	const editor = page.locator('[data-audio-editor]');
	const clips = editor.getByRole('group', { name: / clip, starts at [\d.]+ seconds?, [\d.]+ seconds? long$/u });
	if (id in DURATIONS) {
		await expect(clips).toHaveCount(1);
		await expect(clips).toHaveAttribute('aria-label', new RegExp(`starts at 0 seconds, ${DURATIONS[id]} seconds long$`, 'u'));
	}
	if (id === 'generate-morse-code') {
		await expect(clips).toHaveAttribute('aria-label', /^Morse code clip, starts at 0 seconds, 1\.6 seconds long$/u);
	}
	if (id === 'cut-a-passage-and-leave-a-gap') {
		await expect(clips).toHaveCount(2);
		await expect(clips.nth(0)).toHaveAttribute('aria-label', /starts at 0 seconds, 0\.5 seconds long$/u);
		await expect(clips.nth(1)).toHaveAttribute('aria-label', /starts at 1\.5 seconds, 0\.5 seconds long$/u);
		// Pasting into the gap proves Cut populated the clipboard with this passage.
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await expect(clips.nth(1)).toHaveAttribute('aria-label', /starts at 0\.5 seconds, 1 second long$/u);
	}
	if (id === 'swap-stereo-channels') {
		const signatures = await channelSignatures(page);
		expect(signatures.original[0]).not.toEqual(signatures.original[1]);
		expect(signatures.swapped).toEqual([signatures.original[1], signatures.original[0]]);
		await expect(clips).toHaveAttribute('aria-label', /starts at 0 seconds, 2 seconds long$/u);
	}
}

/** Whole peak envelopes distinguish the fixture's two phases without decoding stored PCM. */
async function channelSignatures(page) {
	return page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const sources = database.transaction('sources').objectStore('sources').getAll();
			sources.onerror = () => reject(sources.error);
			sources.onsuccess = () => {
				const selected = ['guide-music-loop.wav', 'guide-music-loop.wav — channels swapped']
					.map((name) => sources.result.find((source) => source.name === name));
				if (selected.some((source) => !source)) { database.close(); reject(new Error('Missing channel swap sources.')); return; }
				const signatures = [];
				for (const [index, source] of selected.entries()) {
					const peaks = database.transaction('analysis').objectStore('analysis').get(`audio-editor-peaks-v2:${source.id}`);
					peaks.onerror = () => reject(peaks.error);
					peaks.onsuccess = () => {
						signatures[index] = peaks.result?.value?.levels?.[0]?.channels.map((channel) => JSON.stringify([channel.minimums, channel.maximums]));
						if (signatures[0] && signatures[1]) { database.close(); resolve({ original: signatures[0], swapped: signatures[1] }); }
					};
				}
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}
