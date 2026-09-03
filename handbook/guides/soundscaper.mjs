/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The Soundscaper guides, in the order the handbook lists them.
 *
 * Each guide answers one of the questions people most often bring to an
 * audio editor — the same questions that fill Audacity's tutorials — using the
 * step vocabulary in `steps.mjs`. `scripts/docs-reference.mjs` renders the
 * list into handbook pages and `tests/browser/soundscaper-guides.spec.js`
 * replays every step against the built editor.
 */

import { GUIDE_FIXTURES } from './fixtures.mjs';
import { ANALYSIS_GUIDES } from './soundscaper/analysis.mjs';
import { CLEAN_UP_GUIDES } from './soundscaper/clean-up.mjs';
import { EDITING_GUIDES } from './soundscaper/editing.mjs';
import { EFFECT_GUIDES } from './soundscaper/effects.mjs';
import { PROJECT_GUIDES } from './soundscaper/projects.mjs';
import { TRACK_AND_EXPORT_GUIDES } from './soundscaper/tracks-and-export.mjs';
import { VOLUME_GUIDES } from './soundscaper/volume.mjs';
import { validateGuide } from './steps.mjs';

/**
 * Each category is a directory of its own under `/guides/`, so its slug is part
 * of every route inside it. A guide's own id stays stable when it moves between
 * categories only because nothing outside this file writes a route by hand:
 * prose links a guide as `guide:<id>` and the renderer resolves it.
 */
const GROUPS = Object.freeze([
	Object.freeze({
		slug: 'cleaning-up',
		title: 'Cleaning up a recording',
		description: 'Take noise, clicks, rumble and dead air out of a take before you work on it.',
		guides: CLEAN_UP_GUIDES,
	}),
	Object.freeze({
		slug: 'volume',
		title: 'Volume and dynamics',
		description: 'Set levels, even out the loud and quiet parts, and hit a delivery target.',
		guides: VOLUME_GUIDES,
	}),
	Object.freeze({
		slug: 'editing',
		title: 'Editing',
		description: 'Cut, split, copy, move and mark up material on the timeline.',
		guides: EDITING_GUIDES,
	}),
	Object.freeze({
		slug: 'effects',
		title: 'Effects',
		description: 'Change the character of a sound: pitch, tempo, space, filtering and distortion.',
		guides: EFFECT_GUIDES,
	}),
	Object.freeze({
		slug: 'tracks-and-export',
		title: 'Tracks and export',
		description: 'Work with several tracks and render the result to a file.',
		guides: TRACK_AND_EXPORT_GUIDES,
	}),
	Object.freeze({
		slug: 'projects',
		title: 'Projects and files',
		description: 'Save, move, and open projects, including projects made in Audacity.',
		guides: PROJECT_GUIDES,
	}),
	Object.freeze({
		slug: 'analysis',
		title: 'Analysis',
		description: 'Measure loudness, inspect frequencies, and find problems in a recording.',
		guides: ANALYSIS_GUIDES,
	}),
]);

const seen = new Set();
const slugs = new Set();
for (const group of GROUPS) {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(group.slug)) throw new RangeError(`Guide category slug ${String(group.slug)} must be a kebab-case slug.`);
	if (slugs.has(group.slug)) throw new RangeError(`Duplicate guide category slug ${group.slug}.`);
	slugs.add(group.slug);
	for (const guide of group.guides) {
		validateGuide(guide, GUIDE_FIXTURES);
		if (seen.has(guide.id)) throw new RangeError(`Duplicate guide id ${guide.id}.`);
		seen.add(guide.id);
	}
}

export const SOUNDSCAPER_GUIDE_GROUPS = GROUPS;

export const SOUNDSCAPER_GUIDES = Object.freeze(GROUPS.flatMap((group) => group.guides));
