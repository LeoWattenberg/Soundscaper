/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createMotionShapeOperator, createMotionTextAnimator, type MotionShapeOperator, type MotionTextAnimator } from '../../motion-authoring-operators.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperOperatorCommands } from '../../../../motionscaper/editor-operator-commands.ts';
import { createMotionscaperShapeCommands } from '../../../../motionscaper/editor-shape-commands.ts';
import MotionOperatorForm from './MotionOperatorForm.tsx';
import MotionShapeCollection from './MotionShapeCollection.tsx';

export default function MotionOperatorsDialog({ copy, project, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId); const [layerId, setLayerId] = useState(''); const [selected, setSelected] = useState('');
	const [kind, setKind] = useState<MotionShapeOperator['kind']>('trim-paths'); const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
	const composition = project.compositions.find(({ id }) => id === compositionId) ?? project.compositions[0]!;
	const layers = composition.layers.filter((entry) => entry.kind === 'shapes' || entry.kind === 'text'); const layer = layers.find(({ id }) => id === layerId) ?? layers[0];
	const values: readonly (MotionShapeOperator | MotionTextAnimator)[] = layer?.kind === 'shapes' ? layer.operators ?? [] : layer?.document.animators ?? [];
	const value = values.find(({ id }) => id === selected) ?? values[0]; const index = value ? values.indexOf(value) : -1; const disabled = busy || working;
	const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!);
	const run = async (operation: () => Promise<void>) => { setError(null); setWorking(true); try { await operation(); } catch (failure) { failed(failure); } finally { setWorking(false); } };
	const edit = (create: () => Parameters<typeof createMotionscaperOperatorCommands>[0]) => { void run(async () => { await onEdit(createMotionscaperOperatorCommands(create())); }); };
	const address = { project, compositionId: composition.id, layerId: layer?.id ?? '' };
	const add = () => {
		if (!layer) return; const id = crypto.randomUUID();
		edit(() => layer.kind === 'shapes' ? { ...address, target: 'shape', edit: { type: 'add', value: createMotionShapeOperator({ id, kind }), index: values.length } }
			: { ...address, target: 'text', edit: { type: 'add', value: createMotionTextAnimator(id), index: values.length } }); setSelected(id);
	};
	const remove = () => { if (layer && value) edit(() => ({ ...address, target: layer.kind === 'shapes' ? 'shape' : 'text', edit: { type: 'remove', id: value.id } })); };
	const reorder = (delta: number) => { if (!layer) return; const ids = values.map(({ id }) => id); [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]; edit(() => ({ ...address, target: layer.kind === 'shapes' ? 'shape' : 'text', edit: { type: 'reorder', ids } })); };
	const replace = (next: MotionShapeOperator | MotionTextAnimator) => {
		edit(() => 'kind' in next ? { ...address, target: 'shape', edit: { type: 'replace', value: next } } : { ...address, target: 'text', edit: { type: 'replace', value: next } });
	};
	return <AudioEditorDialogShell title={copy.motionscaperOperators} onClose={disabled ? undefined : onClose} width={920} initialFocus="[data-motion-operators-layer]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPropertySelection}</legend>
			<label>{copy.motionscaperComposition}<select value={composition.id} onChange={(event) => { setCompositionId(event.currentTarget.value); setLayerId(''); setSelected(''); }}>{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<label>{copy.motionscaperLayerMenu}<select data-motion-operators-layer value={layer?.id ?? ''} onChange={(event) => { setLayerId(event.currentTarget.value); setSelected(''); }}>{layers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
		</fieldset>
		{layer?.kind === 'shapes' && <MotionShapeCollection key={layer.id} copy={copy} layer={layer} disabled={disabled} onError={failed} onEdit={(change) => { void run(async () => { await onEdit(createMotionscaperShapeCommands({ ...address, edit: change })); }); }} />}
		{layer && <>
			<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{layer.kind === 'shapes' ? copy.motionscaperShapeOperators : copy.motionscaperTextAnimators}</legend>
				{layer.kind === 'shapes' && <label>{copy.motionscaperOperatorType}<select value={kind} onChange={(event) => setKind(event.currentTarget.value as MotionShapeOperator['kind'])}>{(['trim-paths', 'repeater', 'boolean'] as const).map((entry) => <option key={entry} value={entry}>{copy[`motionscaperOperatorKind_${entry}`]}</option>)}</select></label>}
				<Button variant="secondary" onClick={add}>{layer.kind === 'shapes' ? copy.motionscaperAddOperator : copy.motionscaperAddAnimator}</Button>
				<Button variant="secondary" disabled={index <= 0} onClick={() => reorder(-1)}>{copy.motionscaperMoveEarlier}</Button><Button variant="secondary" disabled={index < 0 || index >= values.length - 1} onClick={() => reorder(1)}>{copy.motionscaperMoveLater}</Button>
				<Button variant="secondary" disabled={!value} onClick={remove}>{layer.kind === 'shapes' ? copy.motionscaperRemoveOperator : copy.motionscaperRemoveAnimator}</Button>
			</fieldset>
			<ul className="motionscaper-keyframe-list">{values.map((entry, offset) => <li key={entry.id} data-motion-operator>
				<label><input type="radio" name="motion-operator-selection" checked={value?.id === entry.id} disabled={disabled} onChange={() => setSelected(entry.id)} />{offset + 1}: {'kind' in entry ? copy[`motionscaperOperatorKind_${entry.kind}`] : copy.motionscaperAnimator}</label>
			</li>)}</ul>
			{value && <MotionOperatorForm key={`${layer.id}/${value.id}/${project.revision}`} copy={copy} layer={layer} index={index} disabled={disabled} onSubmit={replace} onError={failed} />}
		</>}
		{!layer && <p>{copy.motionscaperOperatorsEmpty}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
