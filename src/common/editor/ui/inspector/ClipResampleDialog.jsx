/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { LabeledDropdown } from './inspector-controls.jsx';

/** The delivery formats a clip may declare, in the order the dialog offers them. */
export const CLIP_RESAMPLE_SAMPLE_FORMATS = Object.freeze(['int16', 'int24', 'int32', 'float32']);

/**
 * Label one declared sample format.
 *
 * Only float32 has a name of its own; the integer formats all read as
 * "{bits}-bit PCM", so their labels are derived from the format token rather
 * than carried as three near-identical catalog entries. A source that declares
 * something the dialog does not offer — float64, or the `unknown` a probe could
 * not resolve — still needs a readable label wherever it is displayed.
 */
export function clipSampleFormatLabel(sampleFormat, copy) {
	if (sampleFormat === 'float32') return copy.sampleFormatFloat32;
	if (sampleFormat === 'float64') return copy.sampleFormatPcm.replace('{bits}', '64');
	const bits = /^int(\d+)$/u.exec(String(sampleFormat ?? ''))?.[1];
	return bits ? copy.sampleFormatPcm.replace('{bits}', bits) : String(sampleFormat ?? '');
}

/**
 * Ask for the rate and format one clip should be resampled to.
 *
 * The rate and the format are asked for together because they are applied
 * together: the resampled material is written once, and the format it declares
 * is settled at the same moment.
 */
export default function ClipResampleDialog({ sampleRate, sampleFormat, copy, disabled, onCancel, onApply }) {
	const [rate, setRate] = useState(String(sampleRate));
	const [format, setFormat] = useState(
		CLIP_RESAMPLE_SAMPLE_FORMATS.includes(sampleFormat) ? sampleFormat : 'float32',
	);
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
				onApply({ sampleRate: Number(rate), sampleFormat: format });
			}}>
				<label className="kw-audio-editor-dialog__field" data-clip-resample-field="sampleRate">
					<span>{copy.sampleRateHz}</span>
					<NumberStepper value={rate} min={8_000} max={384_000} step={1_000} width="100%" onChange={setRate} />
				</label>
				<LabeledDropdown
					label={copy.sampleFormat}
					hook="clipResampleFormat"
					value={format}
					onChange={setFormat}
					disabled={disabled}
					options={CLIP_RESAMPLE_SAMPLE_FORMATS.map((value) => ({
						value, label: clipSampleFormatLabel(value, copy),
					}))}
				/>
				<div className="kw-audio-editor-dialog__actions">
					<Button variant="secondary" onClick={onCancel}>{copy.cancel}</Button>
					<Button type="submit" disabled={disabled}>{copy.resample}</Button>
				</div>
			</form>
		</AudioEditorDialogShell>
	);
}
