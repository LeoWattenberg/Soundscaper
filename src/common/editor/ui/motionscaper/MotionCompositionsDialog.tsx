/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionComposition } from '../../motion-composition.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperCompositionCommands, type MotionCompositionSettings, type MotionscaperCompositionEdit } from '../../../../motionscaper/editor-composition-commands.ts';

export default function MotionCompositionsDialog({ copy, project, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const [selected, setSelected] = useState(project.primaryCompositionId); const [destination, setDestination] = useState(''); const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
	const composition = project.compositions.find(({ id }) => id === selected) ?? project.compositions.find(({ id }) => id === project.primaryCompositionId)!;
	const targets = project.compositions.filter(({ id }) => id !== composition.id); const target = targets.find(({ id }) => id === destination) ?? targets[0]; const disabled = busy || working;
	const run = async (operation: () => Promise<void>) => { setWorking(true); setError(null); try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!); } finally { setWorking(false); } };
	const edit = (change: MotionscaperCompositionEdit) => { void run(async () => { await onEdit(createMotionscaperCompositionCommands({ project, edit: change })); if (change.type === 'add') setSelected(change.id); }); };
	return <AudioEditorDialogShell title={copy.motionscaperCompositions} onClose={disabled ? undefined : onClose} width={820} initialFocus="[data-motion-compositions-selection]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperCompositions}</legend>
			<label>{copy.motionscaperComposition}<select data-motion-compositions-selection value={composition.id} onChange={(event) => { setSelected(event.currentTarget.value); setError(null); }}>{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
			<Button variant="secondary" disabled={composition.id === project.primaryCompositionId} onClick={() => edit({ type: 'primary', compositionId: composition.id })}>{copy.motionscaperSetPrimaryComposition}</Button>
			<Button variant="secondary" disabled={composition.id === project.primaryCompositionId} onClick={() => edit({ type: 'remove', compositionId: composition.id })}>{copy.motionscaperRemoveComposition}</Button>
			<p>{copy.motionscaperCompositionIdentityHint}</p>
		</fieldset>
		<Settings key={`${composition.id}/${project.revision}`} copy={copy} composition={composition} disabled={disabled} onError={setError} onSubmit={(settings, add) => edit(add ? { type: 'add', id: crypto.randomUUID(), settings } : { type: 'settings', compositionId: composition.id, settings })} />
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperNestComposition}</legend>
			<label>{copy.motionscaperTargetComposition}<select value={target?.id ?? ''} onChange={(event) => setDestination(event.currentTarget.value)}>{targets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<Button variant="secondary" disabled={!target} onClick={() => { if (target) edit({ type: 'nest', compositionId: target.id, sourceCompositionId: composition.id, layerId: crypto.randomUUID() }); }}>{copy.motionscaperNestComposition}</Button>
			<p>{copy.motionscaperNestCompositionHint}</p>
		</fieldset>
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
function Settings({ copy, composition, disabled, onSubmit, onError }: Readonly<{ copy: Readonly<Record<string, string>>; composition: MotionComposition; disabled: boolean; onSubmit: (settings: MotionCompositionSettings, add: boolean) => void; onError: (error: string) => void }>) {
	const [name, setName] = useState(composition.name); const [values, setValues] = useState([composition.width, composition.height, composition.frameRate.num, composition.frameRate.den, composition.durationFrames].map(String));
	const keys = ['motionscaperWidth', 'motionscaperHeight', 'motionscaperFrameNumerator', 'motionscaperFrameDenominator', 'motionscaperDuration'];
	const submit = (add: boolean) => {
		const numbers = values.map(Number); if (!name.trim() || numbers.some((value) => !Number.isSafeInteger(value) || value < 1)) { onError(copy.motionscaperSettingsInvalid!); return; }
		const [width, height, num, den, durationFrames] = numbers as [number, number, number, number, number]; onSubmit({ name: name.trim().normalize('NFC'), width, height, frameRate: { num, den }, durationFrames }, add);
	};
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperSettings}</legend>
		<label>{copy.motionscaperCompositionName}<input value={name} maxLength={512} onChange={(event) => setName(event.currentTarget.value)} /></label>
		{values.map((value, index) => <label key={keys[index]}>{copy[keys[index]!]}<input type="number" min={1} step={1} value={value} onChange={(event) => setValues(values.map((entry, i) => i === index ? event.currentTarget.value : entry))} /></label>)}
		<Button variant="secondary" onClick={() => submit(false)}>{copy.motionscaperApplyCompositionSettings}</Button><Button variant="secondary" onClick={() => submit(true)}>{copy.motionscaperCreateEmptyComposition}</Button>
		<p>{copy.motionscaperCompositionSettingsHint}</p>
	</fieldset>;
}
