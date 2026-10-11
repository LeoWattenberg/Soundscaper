/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionLayer } from '../../motion-composition.ts';
import type { MotionAsset } from '../../motion-asset.ts';
import type { MotionscaperLayerEdit } from '../../../../motionscaper/editor-layer-commands.ts';
export default function MotionTimelineLifecycle({ copy, selected, assets, disabled, onEdit }: Readonly<{
	copy: Readonly<Record<string, string>>; selected: readonly MotionLayer[]; assets: readonly MotionAsset[]; disabled: boolean;
	onEdit: (create: () => MotionscaperLayerEdit) => void;
}>) {
	const single = selected.length === 1 ? selected[0]! : null, ids = selected.map(layer => layer.id);
	const [name, setName] = useState(single?.name ?? '');
	const footage = single?.kind === 'footage' ? single : null, asset = footage && assets.find(asset => asset.id === footage.assetId);
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperLayerLifecycle}</legend>
		<p>{copy.motionscaperRemoveLayersHint}</p>
		<label>{copy.motionscaperNewLayerName}<input disabled={!single} value={name} maxLength={512} onChange={event => setName(event.currentTarget.value)} /></label>
		<Button variant="secondary" disabled={!single || !name.trim()} onClick={() => { if (single) onEdit(() => ({ type: 'rename', layerId: single.id, name })); }}>{copy.motionscaperRenameLayer}</Button>
		<Button variant="secondary" disabled={!selected.length || selected.every(layer => layer.enabled)} onClick={() => onEdit(() => ({ type: 'set-enabled', layerIds: ids, enabled: true }))}>{copy.motionscaperEnableLayers}</Button>
		<Button variant="secondary" disabled={!selected.length || selected.every(layer => !layer.enabled)} onClick={() => onEdit(() => ({ type: 'set-enabled', layerIds: ids, enabled: false }))}>{copy.motionscaperDisableLayers}</Button>
		{footage && <label><input type="checkbox" disabled={asset?.kind !== 'footage' || !asset.hasAudio} checked={footage.audioEnabled} onChange={event => { const enabled = event.currentTarget.checked; onEdit(() => ({ type: 'set-footage-audio', layerIds: ids, enabled })); }} />{copy.motionscaperFootageAudioEnabled}</label>}
		<Button variant="secondary" disabled={!selected.length} onClick={() => onEdit(() => ({ type: 'remove', layerIds: ids }))}>{copy.motionscaperRemoveLayers}</Button>
	</fieldset>;
}
