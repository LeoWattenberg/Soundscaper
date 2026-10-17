/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useState, type FormEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionProjectSettings } from '../../../../motionscaper/editor-document-session.ts';

export default function MotionProjectSettingsDialog({ copy, settings, create, busy, error, onSubmit, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; settings: MotionProjectSettings; create: boolean;
	busy: boolean; error: string | null; onSubmit: (settings: MotionProjectSettings) => void; onClose: () => void;
}>) {
	const id = useId();
	const [title, setTitle] = useState(settings.title);
	const [values, setValues] = useState({ width: String(settings.width), height: String(settings.height),
		frameNumerator: String(settings.frameRate.num), frameDenominator: String(settings.frameRate.den), duration: String(settings.durationFrames) });
	const [invalid, setInvalid] = useState(false);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		const numbers = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)]));
		if (!title.trim() || Object.values(numbers).some((value) => !Number.isSafeInteger(value) || value < 1)) { setInvalid(true); return; }
		setInvalid(false);
		onSubmit({ title: title.trim().normalize('NFC'), width: numbers.width, height: numbers.height,
			frameRate: { num: numbers.frameNumerator, den: numbers.frameDenominator }, durationFrames: numbers.duration });
	};
	const fields = [
		['width', copy.motionscaperWidth, 65536], ['height', copy.motionscaperHeight, 65536],
		['frameNumerator', copy.motionscaperFrameNumerator, 1000000], ['frameDenominator', copy.motionscaperFrameDenominator, 1000000],
		['duration', copy.motionscaperDuration, 100000000],
	] as const;
	return <AudioEditorDialogShell title={create ? copy.motionscaperNewComposition : copy.motionscaperSettings}
		onClose={busy ? undefined : onClose} initialFocus="[data-motion-title]" width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={busy} onClick={onClose}>{copy.motionscaperCancel}</Button>
			<Button variant="primary" disabled={busy} type="submit" form={id}>{create ? copy.motionscaperCreate : copy.motionscaperApply}</Button>
		</>} />}>
		<form id={id} onSubmit={submit} className="motionscaper-settings-form">
			<fieldset disabled={busy}>
				<label htmlFor={`${id}-title`}>{copy.motionscaperTitleLabel}</label>
				<input id={`${id}-title`} data-motion-title value={title} maxLength={512} required onChange={(event) => setTitle(event.currentTarget.value)} />
				{fields.map(([key, label, maximum]) => <label key={key} className="motionscaper-number-field">
					<span>{label}</span><input type="number" min={1} max={maximum} step={1} required value={values[key]}
						onChange={(event) => setValues({ ...values, [key]: event.currentTarget.value })} />
				</label>)}
			</fieldset>
		</form>
		{(error || invalid) && <p role="alert">{error ?? copy.motionscaperSettingsInvalid}</p>}
	</AudioEditorDialogShell>;
}
