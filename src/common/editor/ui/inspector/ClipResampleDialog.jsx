/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
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
	// The confirm button lives in the shared footer, outside the form element,
	// so the apply path is a named handler both entry points call: the footer
	// button by click and the field by Enter through the form's submit.
	const apply = () => onApply({ sampleRate: Number(rate) });
	return (
		<AudioEditorDialogShell
			title={copy.resampleClip}
			onClose={onCancel}
			width={480}
			className="audio-editor-clip-resample-dialog"
			dataAttributes={{ 'data-clip-resample-dialog': '' }}
			footer={<DialogFooter
				className="audio-editor-dialog-footer"
				rightContent={<>
					<Button variant="secondary" onClick={onCancel}>{copy.cancel}</Button>
					<Button variant="primary" disabled={disabled} onClick={apply}>{copy.resample}</Button>
				</>}
			/>}
		>
			<form onSubmit={(event) => {
				event.preventDefault();
				apply();
			}}>
				<label className="kw-audio-editor-dialog__field" data-clip-resample-field="sampleRate">
					<span>{copy.sampleRateHz}</span>
					<NumberStepper value={rate} min={8_000} max={384_000} step={1_000} width="100%" onChange={setRate} />
				</label>
			</form>
		</AudioEditorDialogShell>
	);
}
