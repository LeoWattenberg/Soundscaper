/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useState, type FormEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionComposition } from '../../motion-composition.ts';
import { createAuthoredMotionLayer, type MotionAuthoredLayerKind, type MotionLayerDraft } from '../../../../motionscaper/editor-layer-authoring.ts';

export default function MotionLayerDialog({ copy, kind, composition, compositionChoices, onCompositionChange, busy, error, onSubmit, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; kind: MotionAuthoredLayerKind; composition: MotionComposition;
	compositionChoices?: readonly MotionComposition[]; onCompositionChange?: (id: string) => void;
	busy: boolean; error: string | null; onSubmit: (draft: MotionLayerDraft) => void; onClose: () => void;
}>) {
	const id = useId();
	const title = copy[`motionscaper${kind[0]!.toUpperCase()}${kind.slice(1)}`]!;
	const width = kind === 'solid' ? composition.width : Math.min(composition.width, 640);
	const height = kind === 'solid' ? composition.height : Math.min(composition.height, 240);
	const [draft, setDraft] = useState<MotionLayerDraft>({ kind, name: title, x: (composition.width - width) / 2,
		y: (composition.height - height) / 2, width, height, color: '#4a80ff', opacity: 100, text: copy.motionscaperTextContent!, fontSize: 64 });
	const [invalid, setInvalid] = useState(false);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		try { createAuthoredMotionLayer('validation', composition, draft, 'font'); }
		catch { setInvalid(true); return; }
		setInvalid(false); onSubmit(draft);
	};
	const fields = [
		['x', copy.motionscaperPositionX, -1e6, 1e6], ['y', copy.motionscaperPositionY, -1e6, 1e6],
		['width', copy.motionscaperWidth, 1, 32768], ['height', copy.motionscaperHeight, 1, 32768],
		['opacity', copy.motionscaperOpacity, 0, 100],
	] as const;
	return <AudioEditorDialogShell title={title} onClose={busy ? undefined : onClose} initialFocus="[data-motion-layer-name]" width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={busy} onClick={onClose}>{copy.motionscaperCancel}</Button>
			<Button variant="primary" disabled={busy} type="submit" form={id}>{copy.motionscaperCreate}</Button>
		</>} />}>
		{compositionChoices && compositionChoices.length > 1 && <label>{copy.motionscaperTargetComposition}<select value={composition.id} disabled={busy} onChange={(event) => onCompositionChange?.(event.currentTarget.value)}>{compositionChoices.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
		<form id={id} onSubmit={submit} className="motionscaper-settings-form"><fieldset disabled={busy}>
			<label>{copy.motionscaperLayerName}<input data-motion-layer-name value={draft.name} maxLength={512} required
				onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
			{fields.map(([key, label, min, max]) => <label key={key} className="motionscaper-number-field"><span>{label}</span>
				<input type="number" min={min} max={max} step="any" required value={draft[key]}
					onChange={(event) => setDraft({ ...draft, [key]: event.currentTarget.valueAsNumber })} /></label>)}
			<label className="motionscaper-number-field"><span>{copy.motionscaperColor}</span><input type="color" value={draft.color}
				onChange={(event) => setDraft({ ...draft, color: event.currentTarget.value })} /></label>
			{kind === 'text' && <>
				<label htmlFor={`${id}-text`}>{copy.motionscaperTextContent}</label><textarea id={`${id}-text`} required maxLength={100000} value={draft.text}
					onChange={(event) => setDraft({ ...draft, text: event.currentTarget.value })} />
				<label className="motionscaper-number-field"><span>{copy.motionscaperFontSize}</span><input type="number" min={1} max={4096} step="any" required
					value={draft.fontSize} onChange={(event) => setDraft({ ...draft, fontSize: event.currentTarget.valueAsNumber })} /></label>
			</>}
		</fieldset></form>
		{busy && <p role="status">{copy.motionscaperWorking}</p>}
		{(error || invalid) && <p role="alert">{error ?? copy.motionscaperLayerInvalid}</p>}
	</AudioEditorDialogShell>;
}
