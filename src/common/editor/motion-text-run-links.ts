/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition, MotionLayer, MotionAudioPlacement } from './motion-composition.ts';
import { motionLayerProperties } from './motion-project-graph.ts';
import { replaceMotionLayerProperty } from './motion-layer-links.ts';
import { motionPropertyOfKind } from './motion-property.ts';

/** Legacy text runs have indexed addresses: move their declared links with their authored run. */
export function remapMotionTextRunLinks(composition: MotionComposition, layerId: string, indices: ReadonlyMap<number, number>): MotionComposition {
	const remap = <T extends MotionLayer | MotionAudioPlacement>(owner: T): T => {
		let result = owner;
		for (const { path, property } of motionLayerProperties(owner)) {
			const expression = property.expression; if (!expression?.references.length) continue;
			const references = expression.references.map(reference => {
				if (reference.layerId !== layerId) return reference;
				const match = reference.propertyPath.match(/^document\.runs\.(\d+)\.(.+)$/u); if (!match) return reference;
				const index = indices.get(Number(match[1])); if (index === undefined) throw new Error('A surviving expression references the removed text run. Rebind that reference before removing the run.');
				return { ...reference, propertyPath: `document.runs.${index}.${match[2]}` };
			});
			const changed = { ...property, expression: { ...expression, references } };
			result = ('kind' in result ? replaceMotionLayerProperty(result, path, changed) : { ...result, gain: motionPropertyOfKind(changed, 'scalar') }) as T;
		}
		return result;
	};
	return { ...composition, layers: composition.layers.map(remap), audio: composition.audio.map(remap) };
}
