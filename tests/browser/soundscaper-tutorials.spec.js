import { test } from './audio-editor-test-fixtures.js';
import { registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_TUTORIALS } from '../../handbook/guides/tutorials.mjs';
import { runGuide } from './helpers/guide-runner.js';

// Every handbook tutorial is replayed on its example recordings, step for step,
// against the built editor. A tutorial promises its reader that what they see
// will match what it says; this is where that promise is checked.
test.describe('Soundscaper handbook tutorials', () => {
	registerAudioEditorHooks();

	for (const tutorial of SOUNDSCAPER_TUTORIALS) {
		test(`${tutorial.title} (${tutorial.id})`, async ({ page }) => {
			test.setTimeout(180_000);
			await runGuide(page, tutorial);
		});
	}
});
