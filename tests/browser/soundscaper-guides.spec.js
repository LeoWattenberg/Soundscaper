import { expect, test } from './audio-editor-test-fixtures.js';
import { chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_GUIDES } from '../../handbook/guides/soundscaper.mjs';
import { runGuide } from './helpers/guide-runner.js';
import { verifyGuideTrackResults } from './helpers/guide-track-results.js';

const EDITING_SPANS = {
	'join-split-clips': [[0, 2]],
	'delete-a-passage-and-leave-a-gap': [[0, 0.5], [1.5, 0.5]],
	'align-a-recording-to-zero': [[0, 2]],
	'split-a-passage-into-its-own-clip': [[0, 0.5], [0.5, 1], [1.5, 0.5]],
	'insert-a-copied-passage': [[0, 1], [1, 0.5], [1.5, 1]],
	'align-track-starts-together': [[1, 2], [1, 2]],
	'move-clips-as-a-group': [[2, 2], [2, 2]],
};

async function verifyEditingSpan(page, id) {
	const spans = EDITING_SPANS[id];
	if (!spans) return;
	const clips = page.locator('[data-audio-editor]').getByRole('group', {
		name: / clip, starts at [\d.]+ seconds?, [\d.]+ seconds? long$/u,
	});
	await expect(clips).toHaveCount(spans.length);
	// Duration and position prove that a join kept the original span, a gap
	// preserved later audio's time, and alignment kept the recording's length.
	for (const [index, [start, duration]] of spans.entries()) {
		await expect(clips.nth(index)).toHaveAttribute('aria-label',
			new RegExp(`starts at ${String(start).replace('.', '\\.')} seconds?, ${String(duration).replace('.', '\\.')} seconds? long$`, 'u'));
	}
	if (id === 'move-clips-as-a-group') {
		// Linked selection proves that Group clips created a group, beyond the
		// motion two independently selected clips would already share.
		const editor = page.locator('[data-audio-editor]');
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(0);
		await clips.nth(1).press('Enter');
		await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	}
}

// Every handbook guide is replayed against the built editor. A guide that no
// longer matches a menu entry, dialog field or button fails here, which is what
// lets the generated pages promise that their steps are the editor's steps.
test.describe('Soundscaper handbook guides', () => {
	registerAudioEditorHooks();

	for (const guide of SOUNDSCAPER_GUIDES) {
		test(`${guide.title} (${guide.id})`, async ({ page }) => {
			test.setTimeout(120_000);
			await runGuide(page, guide);
			await verifyEditingSpan(page, guide.id);
			await verifyGuideTrackResults(page, guide.id);
		});
	}
});
