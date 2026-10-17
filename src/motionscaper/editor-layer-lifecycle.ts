/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition, MotionLayer } from '../common/editor/motion-composition.ts';
import { motionLayerDependencyIds } from '../common/editor/motion-layer-links.ts';
import { motionBoolean, motionString } from '../common/editor/motion-values.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionscaperProjectCommand } from './editor-project-commands.ts';
export type MotionscaperLayerLifecycleEdit =
	| { readonly type: 'rename'; readonly layerId: string; readonly name: string }
	| { readonly type: 'remove'; readonly layerIds: readonly string[] }
	| { readonly type: 'set-enabled' | 'set-footage-audio'; readonly layerIds: readonly string[]; readonly enabled: boolean };
/** Keep stable references, media and animation untouched; removal never invents relationship repairs. */
export function motionLayerLifecycleCommands(project: MotionscaperProject, composition: MotionComposition, selected: readonly MotionLayer[], edit: MotionscaperLayerLifecycleEdit): readonly MotionscaperProjectCommand[] {
	if (edit.type === 'remove') {
		const ids = new Set(selected.map(layer => layer.id));
		for (const layer of composition.layers) if (!ids.has(layer.id) && motionLayerDependencyIds(layer).some(id => ids.has(id))) throw new RangeError(`Include dependent layer ${layer.name} before removing this selection, or explicitly detach its parent, matte, adjustment or expression links.`);
		return selected.map(layer => ({ type: 'layer/remove', compositionId: composition.id, layerId: layer.id }));
	}
	if (edit.type === 'rename') return [{ type: 'layer/replace', compositionId: composition.id, layer: { ...selected[0]!, name: motionString(edit.name.trim().normalize('NFC'), 'layer name') } }];
	const enabled = motionBoolean(edit.enabled, 'layer enabled');
	return selected.map(layer => {
		if (edit.type === 'set-enabled') return { type: 'layer/replace', compositionId: composition.id, layer: { ...layer, enabled } };
		if (layer.kind !== 'footage') throw new TypeError('Footage audio controls require footage layers.');
		const asset = project.assets.find(asset => asset.id === layer.assetId);
		if (enabled && (asset?.kind !== 'footage' || !asset.hasAudio)) throw new TypeError('This retained footage has no audio to enable.');
		return { type: 'layer/replace', compositionId: composition.id, layer: { ...layer, audioEnabled: enabled } };
	});
}
