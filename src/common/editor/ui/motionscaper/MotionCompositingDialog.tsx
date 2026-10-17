/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { MOTION_BLEND_MODES, type MotionLayer } from '../../motion-composition.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperCompositingCommands, type MotionscaperCompositingEdit } from '../../../../motionscaper/editor-compositing-commands.ts';
import MotionMasksPanel from './MotionMasksPanel.tsx';
import MotionEffectsPanel from './MotionEffectsPanel.tsx';

export default function MotionCompositingDialog({ copy, project, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId); const [layerId, setLayerId] = useState(''); const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
	const composition = project.compositions.find(({ id }) => id === compositionId) ?? project.compositions[0]!;
	const layers = composition.layers.filter((entry) => !['null', 'camera', 'light'].includes(entry.kind)); const layer = layers.find(({ id }) => id === layerId) ?? layers[0]; const disabled = busy || working;
	const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!);
	const run = async (operation: () => Promise<void>) => { setError(null); setWorking(true); try { await operation(); } catch (failure) { failed(failure); } finally { setWorking(false); } };
	const edit = (change: MotionscaperCompositingEdit) => { void run(async () => { await onEdit(createMotionscaperCompositingCommands({ project, compositionId: composition.id, layerId: layer?.id, edit: change })); }); };
	const size = layer?.kind === 'solid' ? layer.size.value : layer?.kind === 'text' ? layer.document.boxSize.value : [composition.width, composition.height];
	return <AudioEditorDialogShell title={copy.motionscaperCompositing} onClose={disabled ? undefined : onClose} width={940} initialFocus="[data-motion-compositing-layer]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPropertySelection}</legend>
			<label>{copy.motionscaperComposition}<select value={composition.id} onChange={(event) => { setCompositionId(event.currentTarget.value); setLayerId(''); }}>{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<label>{copy.motionscaperLayerMenu}<select data-motion-compositing-layer value={layer?.id ?? ''} onChange={(event) => setLayerId(event.currentTarget.value)}>{layers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
			<Button variant="secondary" onClick={() => { const id = crypto.randomUUID(); edit({ type: 'add-adjustment', id, name: copy.motionscaperAdjustment! }); setLayerId(id); }}>{copy.motionscaperAddAdjustment}</Button>
		</fieldset>
		{layer && <>
			<CompositeForm key={`${layer.id}/${project.revision}`} copy={copy} layer={layer} layers={layers} disabled={disabled} onEdit={edit} />
			{layer.kind === 'adjustment' && <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperAdjustment}</legend>
				<p>{copy.motionscaperAdjustmentHint}</p><Button variant="secondary" onClick={() => edit({ type: 'adjustment-targets' })}>{copy.motionscaperAdjustmentTargets}</Button>
			</fieldset>}
			<MotionMasksPanel key={`mask/${layer.id}`} copy={copy} revision={project.revision} masks={layer.masks} width={size[0]!} height={size[1]!} disabled={disabled} onEdit={edit} onError={failed} />
			<MotionEffectsPanel key={`effect/${layer.id}`} copy={copy} revision={project.revision} effects={layer.effects} width={size[0]!} height={size[1]!} disabled={disabled} onEdit={edit} onError={failed} />
		</>}
		{!layer && <p>{copy.motionscaperCompositingEmpty}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
function CompositeForm({ copy, layer, layers, disabled, onEdit }: Readonly<{ copy: Readonly<Record<string, string>>; layer: MotionLayer; layers: readonly MotionLayer[]; disabled: boolean; onEdit: (edit: MotionscaperCompositingEdit) => void }>) {
	const [blendMode, setBlend] = useState(layer.blendMode); const [matteId, setMatte] = useState(layer.matte?.layerId ?? ''); const [mode, setMode] = useState<NonNullable<MotionLayer['matte']>['mode']>(layer.matte?.mode ?? 'alpha');
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperCompositeSettings}</legend>
		<label>{copy.motionscaperBlendMode}<select value={blendMode} onChange={(event) => setBlend(event.currentTarget.value as typeof blendMode)}>{MOTION_BLEND_MODES.map((entry) => <option key={entry} value={entry}>{copy[`motionscaperBlend_${entry}`]}</option>)}</select></label>
		<label>{copy.motionscaperMatteSource}<select value={matteId} onChange={(event) => setMatte(event.currentTarget.value)}><option value="">{copy.motionscaperNone}</option>{layers.filter((entry) => entry.id !== layer.id && entry.kind !== 'adjustment').map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
		<label>{copy.motionscaperMatteMode}<select value={mode} disabled={!matteId} onChange={(event) => setMode(event.currentTarget.value as typeof mode)}>{(['alpha', 'alpha-inverted', 'luma', 'luma-inverted'] as const).map((entry) => <option key={entry} value={entry}>{copy[`motionscaperMatte_${entry}`]}</option>)}</select></label>
		<Button variant="secondary" onClick={() => onEdit({ type: 'composite', blendMode, matte: matteId ? { layerId: matteId, mode } : null })}>{copy.motionscaperApplyCompositing}</Button>
		<p>{copy.motionscaperMatteHint}</p>
	</fieldset>;
}
