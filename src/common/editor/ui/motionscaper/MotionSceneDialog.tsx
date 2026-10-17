/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperSceneCommands, type MotionscaperSceneEdit } from '../../../../motionscaper/editor-scene-commands.ts';
import { createMotionscaperRenderQualityCommands } from '../../../../motionscaper/editor-render-quality-commands.ts';
import { MotionSceneMaterial, MotionSceneTransform } from './MotionSceneFields.tsx';
import { MotionSceneCamera, MotionSceneLight, MotionSceneLightType } from './MotionSceneOptics.tsx';
import MotionSceneQuality, { type MotionSceneQualityEdit } from './MotionSceneQuality.tsx';
export default function MotionSceneDialog({ copy, project, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId), [layerId, setLayerId] = useState(''), [lightType, setLightType] = useState<'ambient' | 'point' | 'spot'>('point');
	const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null);
	const composition = project.compositions.find(value => value.id === compositionId) ?? project.compositions[0]!;
	const layer = composition.layers.find(value => value.id === layerId) ?? composition.layers[0], disabled = busy || working;
	const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!);
	const run = async (operation: () => Promise<void>) => { setError(null); setWorking(true); try { await operation(); } catch (failure) { failed(failure); } finally { setWorking(false); } };
	const edit = (change: MotionscaperSceneEdit) => { void run(async () => { await onEdit(createMotionscaperSceneCommands({ project, compositionId: composition.id, layerId: layer?.id, edit: change })); }); };
	const quality = (change: MotionSceneQualityEdit) => { void run(async () => { await onEdit(createMotionscaperRenderQualityCommands({ project, compositionId: composition.id, ...change })); }); };
	return <AudioEditorDialogShell title={copy.motionscaperScene} onClose={disabled ? undefined : onClose} width={940} initialFocus="[data-motion-scene-layer]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPropertySelection}</legend>
			<label>{copy.motionscaperComposition}<select value={composition.id} onChange={event => { setCompositionId(event.currentTarget.value); setLayerId(''); }}>{project.compositions.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
			<label>{copy.motionscaperLayerMenu}<select data-motion-scene-layer value={layer?.id ?? ''} onChange={event => setLayerId(event.currentTarget.value)}>{composition.layers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
			<Button variant="secondary" onClick={() => { const id = crypto.randomUUID(); edit({ type: 'add-camera', id, name: copy.motionscaperSceneCamera! }); setLayerId(id); }}>{copy.motionscaperSceneAddCamera}</Button>
			<MotionSceneLightType copy={copy} value={lightType} onChange={setLightType} /><Button variant="secondary" onClick={() => { const id = crypto.randomUUID(); edit({ type: 'add-light', id, name: copy.motionscaperSceneLight!, lightType }); setLayerId(id); }}>{copy.motionscaperSceneAddLight}</Button>
		</fieldset>
		<p>{copy.motionscaperSceneHint}</p>
		{layer && <MotionSceneTransform key={`transform/${layer.id}/${project.revision}`} copy={copy} layer={layer} disabled={disabled} onEdit={edit} onError={failed} />}
		{layer?.kind === 'camera' && <MotionSceneCamera key={`camera/${layer.id}/${project.revision}`} copy={copy} layer={layer} disabled={disabled} onEdit={edit} onError={failed} />}
		{layer?.kind === 'light' && <MotionSceneLight key={`light/${layer.id}/${project.revision}`} copy={copy} layer={layer} disabled={disabled} onEdit={edit} onError={failed} />}
		{layer && !['camera', 'light', 'null', 'adjustment'].includes(layer.kind) && <MotionSceneMaterial key={`material/${layer.id}/${project.revision}`} copy={copy} layer={layer} disabled={disabled} onEdit={edit} onError={failed} />}
		<MotionSceneQuality key={`quality/${composition.id}/${project.revision}`} copy={copy} composition={composition} disabled={disabled} onEdit={quality} onError={failed} />
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
