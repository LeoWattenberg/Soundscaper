/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../common/editor/project-v17.ts';
import {
	createSoundscaperProject,
	type SoundscaperProjectOptions,
} from './editor-project.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import { normalizeAutomationLaneV21, type AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import type { StripRef } from '../common/editor/parameter-address.ts';
import { importSoundscaperAudacityMixer } from './editor-audacity-import-mixer.ts';

/** Promote maintained Audacity decoder output into the baseline family. */
export function importSoundscaperAudacityProject(value: unknown): SoundscaperProject {
	validateAudioEditorProjectV17(value);
	const decoded = structuredClone(value) as AudioEditorProjectV17;
	const foundation = { ...decoded } as Record<string, unknown>;
	delete foundation.mixer;
	delete foundation.schemaFamily;
	delete foundation.schemaVersion;
	const options = {
		...foundation,
		automationLanes: importedStripGainLanes(decoded),
		now: decoded.createdAt,
	} as SoundscaperProjectOptions;
	const imported = createSoundscaperProject(options);
	return createSoundscaperProject({ ...options, mixer: importSoundscaperAudacityMixer(decoded, imported) });
}

/** Legacy strip envelopes multiply the fader; baseline gain lanes are absolute. */
function importedStripGainLanes(project: AudioEditorProjectV17): readonly AutomationLaneV21[] {
	const lanes: AutomationLaneV21[] = [];
	for (const track of project.tracks) {
		if (track.type === 'audio') add({ kind: 'track', id: track.id }, track);
	}
	add({ kind: 'master' }, project.master);
	return lanes;

	function add(strip: StripRef, owner: Readonly<{ gain: number; envelope?: readonly Readonly<{ frame: number; value: number }>[] }>): void {
		if (!owner.envelope?.length) return;
		const id = `imported-volume:${String(lanes.length + 1)}`;
		const points = owner.envelope.map((point, index) => ({
			id: `${id}:${String(index + 1)}`, position: point.frame, value: owner.gain * point.value,
		}));
		// A legacy envelope ramps from unity when its first point is after zero.
		if (points[0]!.position > 0) points.unshift({ id: `${id}:start`, position: 0, value: owner.gain });
		lanes.push(normalizeAutomationLaneV21({
			id, address: { kind: 'strip', strip, parameterId: 'gain' }, timebase: 'absolute-samples', points,
			segments: points.slice(1).map(() => ({ kind: 'linear' })),
		}));
	}
}
