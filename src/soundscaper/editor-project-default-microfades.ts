/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultClipMicrofadeChanges } from '../common/editor/commands/default-microfades.ts';
import { projectForCommandConsumers } from '../common/editor/project-current-runtime.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import { validateSoundscaperProject } from './editor-project-validation.ts';

/** Apply clip defaults after the inherited projection is elevated to product authority. */
export function withSoundscaperDefaultMicrofades(
	before: SoundscaperProject,
	after: SoundscaperProject,
): SoundscaperProject {
	if (before === after) return after;
	const changes = defaultClipMicrofadeChanges(
		projectForCommandConsumers(before) as Parameters<typeof defaultClipMicrofadeChanges>[0],
		projectForCommandConsumers(after) as Parameters<typeof defaultClipMicrofadeChanges>[1],
	);
	if (changes.size === 0) return after;
	const draft = structuredClone(after) as Record<string, unknown>;
	draft.clips = after.clips.map((clip) => ({ ...clip, ...changes.get(clip.id) }));
	if (!validateSoundscaperProject(draft)) throw new TypeError('Invalid Soundscaper microfade result.');
	return draft;
}
