/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useState } from 'react';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { END_FADE_SHAPE_PRESETS, selectedEndFadeShapePreset } from '../../clip-fade-presets.ts';
import { clipInteractionCopy } from '../../../i18n/editor-clip-interactions-copy.ts';
import { clipFadeLengthChange } from './clip-fade-edit.ts';
import { fadeField, fadeShapeField, type ClipFadeEdge, type FadeClip } from './clip-fade-geometry.ts';
import type { ClipFadeChanges } from './ClipFadeOverlays.tsx';

interface Clip extends FadeClip { readonly id: string; }
interface Props {
	readonly clip: Clip;
	readonly sampleRate: number;
	readonly copy: Readonly<Record<string, string>>;
	readonly blocked: boolean;
	readonly onPreview: (changes: ClipFadeChanges) => void;
	readonly onApply: (changes: ClipFadeChanges) => void;
	readonly onClose: () => void;
}

/** The upstream Fades dialog previews locally and publishes one undoable edit on Apply. */
export default function ClipFadesDialog({ clip, sampleRate, copy, blocked, onPreview, onApply, onClose }: Props) {
	const [changes, setChanges] = useState<ClipFadeChanges>({});
	const value = { ...clip, ...changes };
	const labels = clipInteractionCopy(copy);
	const baseId = useId();
	useEffect(() => { onPreview(changes); }, [changes, onPreview]);
	const apply = () => { if (!blocked) onApply(changes); onClose(); };
	return <AudioEditorDialogShell isOpen title={labels.fades} onClose={onClose}
		className="audio-editor-fades-dialog" width={460}
		footer={<DialogFooter primaryText={copy.apply} secondaryText={copy.cancel} primaryDisabled={blocked}
			onPrimaryClick={apply} onSecondaryClick={onClose} />}>
		{(['in', 'out'] as const).map((edge: ClipFadeEdge) => {
			const field = fadeField(edge);
			const shapeField = fadeShapeField(edge);
			const shapeLabel = edge === 'in' ? labels.fadeInShape : labels.fadeOutShape;
			return <div key={edge} className="audio-editor-fades-dialog__row">
				<label>{edge === 'in' ? labels.fadeInLength : labels.fadeOutLength}
					<NumberStepper value={((value[field] ?? 0) / sampleRate).toFixed(3)} min={0} max={clip.durationFrames / sampleRate}
						step={0.1} disabled={blocked} onChange={text => {
							const seconds = Number(text.replace(/\s*s\s*$/iu, '').replace(',', '.'));
							if (Number.isFinite(seconds)) setChanges(previous => ({ ...previous, ...clipFadeLengthChange(value, edge, Math.round(seconds * sampleRate)) }));
						}} /><span aria-hidden="true">{` ${labels.secondsUnit}`}</span>
				</label>
				<label htmlFor={`${baseId}-${edge}`}>{shapeLabel}</label>
				<select id={`${baseId}-${edge}`} value={selectedEndFadeShapePreset(value[shapeField]) ?? ''} disabled={blocked}
					onChange={event => {
						const preset = END_FADE_SHAPE_PRESETS.find(item => item.id === event.currentTarget.value);
						if (preset) setChanges(previous => ({ ...previous, [shapeField]: preset.shape }));
					}}>
					<option value="" disabled>{copy.custom}</option>
					{END_FADE_SHAPE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{
						copy[{ linear: 'fadeShapeLinear', logarithmic: 'fadeShapeLogarithmic', exponential: 'fadeShapeExponential', 's-curve': 'fadeShapeSCurve', 'constant-power': 'fadeShapeConstantPower' }[preset.id]]
					}</option>)}
				</select>
			</div>;
		})}
	</AudioEditorDialogShell>;
}
