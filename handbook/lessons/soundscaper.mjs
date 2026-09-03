/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The Soundscaper lessons, in the order the handbook lists them.
 *
 * Each lesson answers one of the questions people most often bring to an
 * audio editor — the same questions that fill Audacity's tutorials — using the
 * step vocabulary in `steps.mjs`. `scripts/docs-reference.mjs` renders the
 * list into handbook pages and `tests/browser/soundscaper-lessons.spec.js`
 * replays every step against the built editor.
 */

import { LESSON_FIXTURES } from './fixtures.mjs';
import { ANALYSIS_LESSONS } from './soundscaper/analysis.mjs';
import { CLEAN_UP_LESSONS } from './soundscaper/clean-up.mjs';
import { EDITING_LESSONS } from './soundscaper/editing.mjs';
import { EFFECT_LESSONS } from './soundscaper/effects.mjs';
import { TRACK_AND_EXPORT_LESSONS } from './soundscaper/tracks-and-export.mjs';
import { VOLUME_LESSONS } from './soundscaper/volume.mjs';
import { validateLesson } from './steps.mjs';

const GROUPS = Object.freeze([
	Object.freeze({ title: 'Cleaning up a recording', lessons: CLEAN_UP_LESSONS }),
	Object.freeze({ title: 'Volume and dynamics', lessons: VOLUME_LESSONS }),
	Object.freeze({ title: 'Editing', lessons: EDITING_LESSONS }),
	Object.freeze({ title: 'Effects', lessons: EFFECT_LESSONS }),
	Object.freeze({ title: 'Tracks and export', lessons: TRACK_AND_EXPORT_LESSONS }),
	Object.freeze({ title: 'Analysis', lessons: ANALYSIS_LESSONS }),
]);

const seen = new Set();
for (const group of GROUPS) {
	for (const lesson of group.lessons) {
		validateLesson(lesson, LESSON_FIXTURES);
		if (seen.has(lesson.id)) throw new RangeError(`Duplicate lesson id ${lesson.id}.`);
		seen.add(lesson.id);
	}
}

export const SOUNDSCAPER_LESSON_GROUPS = GROUPS;

export const SOUNDSCAPER_LESSONS = Object.freeze(GROUPS.flatMap((group) => group.lessons));
