/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionLayer, MotionAudioPlacement } from './motion-composition.ts';
import type { MotionscaperProject } from './motion-project-types.ts';
import { motionLayerProperties, type MotionPropertyAddress } from './motion-project-graph.ts';
import { replaceMotionLayerProperty } from './motion-layer-links.ts';
import { motionPropertyOfKind, type MotionExpression } from './motion-property.ts';
import { motionId } from './motion-values.ts';

type Reference = MotionExpression['references'][number];
interface LayerProperties { readonly byStable: ReadonlyMap<string, MotionPropertyAddress>; readonly aliases: ReadonlyMap<string, MotionPropertyAddress> }
function properties(layer: MotionLayer | MotionAudioPlacement): LayerProperties {
	const entries = motionLayerProperties(layer); return { byStable: new Map(entries.map((entry) => [entry.stablePath, entry])),
		aliases: new Map(entries.flatMap((entry) => [[entry.path, entry] as const, [entry.stablePath, entry] as const])) };
}
/** A menu binds the existing property's stable authored identity, never an array index chosen at execution time. */
export function motionExpressionReference(layer: MotionLayer | MotionAudioPlacement, id: string, propertyPath: string): Reference {
	const entry = properties(layer).aliases.get(propertyPath); if (!entry) throw new ReferenceError(`Motion expression target ${layer.id}/${propertyPath} is missing.`);
	return Object.freeze({ id: motionId(id), layerId: layer.id, propertyPath: entry.stablePath });
}

/**
 * Preserve legacy indexed bindings against the pre-edit snapshot. Newly authored links resolve in the
 * final candidate. Normalization alone never rewrites old saved bytes or revision digests.
 */
export function stabilizeMotionExpressionReferences(previous: MotionscaperProject, candidate: MotionscaperProject): MotionscaperProject {
	const priorCompositions = new Map(previous.compositions.map((composition) => [composition.id, composition]));
	return { ...candidate, compositions: candidate.compositions.map((composition) => {
		const prior = priorCompositions.get(composition.id);
		const priorLayers = new Map([...(prior?.layers ?? []), ...(prior?.audio ?? [])].map((layer) => [layer.id, properties(layer)]));
		const nextLayers = new Map([...composition.layers, ...composition.audio].map((layer) => [layer.id, properties(layer)]));
		const stabilize = <T extends MotionLayer | MotionAudioPlacement>(layer: T): T => {
			let result = layer;
			for (const entry of nextLayers.get(layer.id)!.byStable.values()) {
				const expression = entry.property.expression; if (!expression?.references.length) continue;
				const oldExpression = priorLayers.get(layer.id)?.byStable.get(entry.stablePath)?.property.expression;
				const oldReferences = new Map((oldExpression?.references ?? []).map((reference) => [reference.id, reference]));
				const references = expression.references.map((reference) => {
					const prior = oldReferences.get(reference.id);
					const unchanged = prior?.layerId === reference.layerId && prior.propertyPath === reference.propertyPath;
					const target = (unchanged ? priorLayers : nextLayers).get(reference.layerId)?.aliases.get(reference.propertyPath);
					return target ? { ...reference, propertyPath: target.stablePath } : reference;
				});
				if (references.some((reference, index) => reference.propertyPath !== expression.references[index]!.propertyPath)) {
					const property = { ...entry.property, expression: { ...expression, references } };
					result = ('kind' in result ? replaceMotionLayerProperty(result, entry.path, property) : { ...result, gain: motionPropertyOfKind(property, 'scalar') }) as T;
				}
			}
			return result;
		};
		return { ...composition, layers: composition.layers.map(stabilize), audio: composition.audio.map(stabilize) };
	}) };
}
