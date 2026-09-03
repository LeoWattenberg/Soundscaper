import { test } from './audio-editor-test-fixtures.js';
import { registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_LESSONS } from '../../handbook/lessons/soundscaper.mjs';
import { runLesson } from './helpers/lesson-runner.js';

// Every handbook lesson is replayed against the built editor. A lesson that no
// longer matches a menu entry, dialog field or button fails here, which is what
// lets the generated pages promise that their steps are the editor's steps.
test.describe('Soundscaper handbook lessons', () => {
	registerAudioEditorHooks();

	for (const lesson of SOUNDSCAPER_LESSONS) {
		test(`${lesson.title} (${lesson.id})`, async ({ page }) => {
			test.setTimeout(120_000);
			await runLesson(page, lesson);
		});
	}
});
