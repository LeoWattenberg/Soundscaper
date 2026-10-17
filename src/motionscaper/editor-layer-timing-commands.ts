/* SPDX-License-Identifier: AGPL-3.0-only */

import { motionScalar, motionPropertyOfKind } from '../common/editor/motion-property.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from '../common/editor/timeline-time.ts';
import { freezeMotionValue, motionId, motionRational } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

export type MotionscaperLayerTimingEdit =
	| { readonly type: 'source'; readonly sourceStart: Rational; readonly timeScale: Rational }
	| { readonly type: 'enable-remap' }
	| { readonly type: 'clear-remap' };

/** Source start and remap values use seconds; remap key positions use layer-local composition frames. */
export function createMotionscaperLayerTimingCommands(options: Readonly<{ project: unknown; compositionId: string; layerId: string; edit: MotionscaperLayerTimingEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId); const layerId = motionId(options.layerId);
	const composition = project.compositions.find(({ id }) => id === compositionId); if (!composition) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const layer = composition.layers.find(({ id }) => id === layerId); if (!layer) throw new ReferenceError(`Motion layer ${layerId} is missing.`);
	if (layer.kind !== 'footage' && layer.kind !== 'precomp') throw new TypeError('Source timing applies to footage and precomposition layers.');
	const edit = options.edit; let next = layer;
	if (edit.type === 'source') next = { ...layer, sourceStart: motionRational(edit.sourceStart, 'source start'), timeScale: motionRational(edit.timeScale, 'source rate') };
	else if (edit.type === 'clear-remap') next = { ...layer, timeRemap: null };
	else if (edit.type === 'enable-remap') {
		if (layer.timeRemap === null) {
			const zero = { num: 0, den: 1 }; const begin = subtractRationals(layer.inFrame, layer.startFrame); const end = subtractRationals(layer.outFrame, layer.startFrame);
			if (compareRationals(begin, zero) < 0) throw new RangeError('Time remap requires a non-negative visible local frame range; move the layer start before its in frame first.');
			const finalTime = addRationals(layer.sourceStart, multiplyRationals(divideRationals(end, composition.frameRate), layer.timeScale));
			const start = layer.sourceStart.num / layer.sourceStart.den;
			next = { ...layer, timeRemap: motionPropertyOfKind({ ...motionScalar(start), curve: {
				anchors: [{ position: zero, value: start }, { position: end, value: finalTime.num / finalTime.den }], segments: [{ kind: 'linear' }],
			} }, 'scalar') };
		}
	} else throw new TypeError('Unsupported motion source timing edit.');
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'layer/replace', compositionId, layer: next }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
