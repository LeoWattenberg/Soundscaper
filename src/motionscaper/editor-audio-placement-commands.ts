/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAudioPlacement } from '../common/editor/motion-composition.ts';
import type { MotionScalarProperty } from '../common/editor/motion-property.ts';
import { addRationals, type Rational } from '../common/editor/timeline-time.ts';
import { freezeMotionValue, motionId, motionRational } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

export type MotionscaperAudioPlacementEdit =
	| { readonly type: 'move'; readonly placementIds: readonly string[]; readonly deltaFrames: Rational }
	| { readonly type: 'trim'; readonly placementId: string; readonly inFrame: Rational; readonly outFrame: Rational }
	| { readonly type: 'gain'; readonly placementId: string; readonly gain: MotionScalarProperty }
	| { readonly type: 'source'; readonly placementId: string; readonly sourceStart: Rational; readonly timeScale: Rational }
	| { readonly type: 'enabled'; readonly placementIds: readonly string[]; readonly enabled: boolean }
	| { readonly type: 'remove'; readonly placementIds: readonly string[] };

/** Standalone audio uses the same composition-frame and immutable-history authority as visual layers. */
export function createMotionscaperAudioPlacementCommands(options: Readonly<{ project: unknown; compositionId: string; edit: MotionscaperAudioPlacementEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId);
	const composition = project.compositions.find((entry) => entry.id === compositionId); if (!composition) throw new ReferenceError('The audio composition is missing.');
	const edit = options.edit; const ids = 'placementIds' in edit ? edit.placementIds : [edit.placementId];
	if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4096) throw new RangeError('Select between one and 4096 audio placements.');
	const selected = new Set(ids.map((id) => motionId(id)));
	if (selected.size !== ids.length) throw new RangeError('Audio selection contains duplicate identities.');
	if (composition.audio.filter((entry) => selected.has(entry.id)).length !== selected.size) throw new ReferenceError('A selected audio placement is missing.');
	const replace = (placement: MotionAudioPlacement): readonly MotionAudioPlacement[] => {
		if (!selected.has(placement.id)) return [placement];
		switch (edit.type) {
			case 'remove': return [];
			case 'enabled': return [{ ...placement, enabled: edit.enabled }];
			case 'gain': return [{ ...placement, gain: edit.gain }];
			case 'source': return [{ ...placement, sourceStart: edit.sourceStart, timeScale: edit.timeScale }];
			case 'trim': return [{ ...placement, inFrame: edit.inFrame, outFrame: edit.outFrame }];
			case 'move': {
				const delta = motionRational(edit.deltaFrames, 'audio placement movement');
				return [{ ...placement, startFrame: addRationals(placement.startFrame, delta), inFrame: addRationals(placement.inFrame, delta), outFrame: addRationals(placement.outFrame, delta) }];
			}
			default: throw new TypeError('Unsupported audio placement edit.');
		}
	};
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'composition/replace', composition: { ...composition, audio: composition.audio.flatMap(replace) } }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
