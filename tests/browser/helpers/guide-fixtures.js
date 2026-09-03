/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The example recordings as Playwright file payloads, so the browser suite
 * feeds the editor the same bytes the handbook publishes for its readers.
 */

import { GUIDE_FIXTURES } from '../../../handbook/guides/fixtures.mjs';
import { exampleAudio } from '../../../handbook/guides/example-audio.mjs';

const cache = new Map();

/** The Playwright file payload for a guide fixture id. */
export function guideFixtureFile(id) {
	const fixture = GUIDE_FIXTURES[id];
	if (!fixture) throw new RangeError(`Unknown guide fixture ${String(id)}.`);
	if (!cache.has(id)) cache.set(id, Object.freeze({ name: fixture.file, mimeType: 'audio/wav', buffer: exampleAudio(id) }));
	return cache.get(id);
}

/** The clip name the editor gives an imported fixture: its file name without the extension. */
export function guideFixtureClipName(id) {
	return guideFixtureFile(id).name.replace(/\.wav$/u, '');
}
