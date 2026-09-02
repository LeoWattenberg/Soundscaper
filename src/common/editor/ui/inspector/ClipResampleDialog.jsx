/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

/**
 * Ask for the rate one clip should be resampled to.
 *
 * Only the rate is asked for. Sources are stored as float32 PCM whatever
 * format they declare, so a format is not something the editor converts
 * between; the field survives only to carry an imported Audacity project's
 * declaration back out to .aup4.
 */
export default function ClipResampleDialog({ sampleRate, copy, disabled, onCancel, onApply }) {
	const [rate, setRate] = useState(String(sampleRate));
	return (
		<AudioEditorDialogShell
			title={copy.resampleClip}
			onClose={onCancel}
			width={480}
			className="audio-editor-clip-resample-dialog"
			dataAttributes={{ 'data-clip-resample-dialog': '' }}
		>
			<form onSubmit={(event) => {
				event.preventDefault();
				onApply({ sampleRate: Number(rate) });
			}}>
				<label className="kw-audio-editor-dialog__field" data-clip-resample-field="sampleRate">
					<span>{copy.sampleRateHz}</span>
					<NumberStepper value={rate} min={8_000} max={384_000} step={1_000} width="100%" onChange={setRate} />
				</label>
				<div className="kw-audio-editor-dialog__actions">
					<Button variant="secondary" onClick={onCancel}>{copy.cancel}</Button>
					<Button type="submit" disabled={disabled}>{copy.resample}</Button>
				</div>
			</form>
		</AudioEditorDialogShell>
	);
}
