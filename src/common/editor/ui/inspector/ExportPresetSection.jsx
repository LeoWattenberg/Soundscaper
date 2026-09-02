import { useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { takeSelectedFile } from '../file-input-selection.ts';
import { LabeledDropdown } from './inspector-controls.jsx';
import { runDeliveryPresetAction } from '../export-preset-model.ts';

/**
 * Delivery preset controls for the export dialog.
 *
 * Deliberately the same shape as the effect-preset controls: pick a preset to
 * fill the settings, keep editing them freely, and save the result back under
 * a name. Selecting nothing means "Custom", which is what the settings already
 * are before a preset is chosen.
 */
export default function ExportPresetSection({
	copy, presets, selectedId, presetName, disabled,
	onApply, onNameChange, onSave, onDelete, onImport, onExport, onError,
}) {
	const fileRef = useRef(null);
	const [busy, setBusy] = useState(false);
	const guard = (work) => {
		if (disabled || busy) return;
		void runDeliveryPresetAction(work, { onError, onBusy: setBusy });
	};
	const options = [
		{ value: '', label: copy.deliveryPresetNone },
		...presets.map((preset) => ({ value: preset.id, label: preset.label })),
	];
	return (
		<section className="audio-editor-export-section" data-delivery-presets>
			<h3>{copy.deliveryPreset}</h3>
			<LabeledDropdown
				label={copy.deliveryPreset}
				hook="delivery-preset"
				value={selectedId}
				onChange={(value) => guard(() => onApply(value))}
				disabled={disabled || busy}
				options={options}
			/>
			<label className="audio-editor-field">
				<span>{copy.deliveryPresetName}</span>
				<input
					type="text"
					value={presetName}
					disabled={disabled || busy}
					onChange={(event) => onNameChange(event.target.value)}
					data-delivery-preset-name
				/>
			</label>
			<div className="audio-editor-export-preset-actions audio-editor-panel-actions">
				<span>
					<Button
						variant="secondary"
						disabled={disabled || busy || !presetName.trim()}
						onClick={() => guard(onSave)}
					>
						{copy.deliveryPresetSave}
					</Button>
				</span>
				<span>
					<Button
						variant="secondary"
						disabled={disabled || busy || !selectedId}
						onClick={() => guard(onDelete)}
					>
						{copy.deliveryPresetDelete}
					</Button>
				</span>
				<span>
					<Button
						variant="secondary"
						disabled={disabled || busy}
						onClick={() => fileRef.current?.click()}
					>
						{copy.deliveryPresetImport}
					</Button>
				</span>
				<span>
					<Button
						variant="secondary"
						disabled={disabled || busy || !selectedId}
						onClick={() => guard(onExport)}
					>
						{copy.deliveryPresetExport}
					</Button>
				</span>
				<input
					ref={fileRef}
					type="file"
					accept="application/json,.json"
					hidden
					data-delivery-preset-file
					onChange={(event) => {
						const file = takeSelectedFile(event.currentTarget);
						if (file) guard(() => onImport(file));
					}}
				/>
			</div>
		</section>
	);
}
