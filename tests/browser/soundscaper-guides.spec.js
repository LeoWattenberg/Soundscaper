import { test } from './audio-editor-test-fixtures.js';
import { registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_GUIDES } from '../../handbook/guides/soundscaper.mjs';
import { runGuide } from './helpers/guide-runner.js';

// Every handbook guide is replayed against the built editor. A guide that no
// longer matches a menu entry, dialog field or button fails here, which is what
// lets the generated pages promise that their steps are the editor's steps.
test.describe('Soundscaper handbook guides', () => {
	registerAudioEditorHooks();

	for (const guide of SOUNDSCAPER_GUIDES) {
		test(`${guide.title} (${guide.id})`, async ({ page }) => {
			test.setTimeout(120_000);
			await runGuide(page, guide);
		});
	}
});
