import { useState } from 'react';
import EffectPresetBar from './EffectPresetBar.jsx';
import { runDeliveryPresetAction } from '../export-preset-model.ts';

/**
 * Delivery preset controls for the export dialog.
 *
 * The same bar the effect surfaces use, so the actions sit to the right of the
 * dropdown as they do in Audacity rather than stacking below it, and naming
 * happens in the shared Save as… prompt instead of a permanent text field.
 *
 * It carries no heading: the preset is what the whole dialog is set to, not one
 * of its fields, so it spans the dialog as a banner above the sections.
 */
export default function ExportPresetSection({
	copy, presets, selectedId, disabled, unsaved = false, resetKey = null,
	onApply, onNameChange, onSave, onDelete, onImport, onExport, onError,
}) {
	const [busy, setBusy] = useState(false);
	const guard = (work) => {
		if (disabled || busy) return;
		void runDeliveryPresetAction(work, { onError, onBusy: setBusy });
	};
	return (
		<section className="audio-editor-export-preset-banner" aria-label={copy.deliveryPreset} data-delivery-presets>
			<EffectPresetBar
				copy={copy}
				disabled={disabled || busy}
				presets={presets.map((preset) => ({ id: preset.id, label: preset.label, custom: true }))}
				selectedId={selectedId}
				unsaved={unsaved}
				dataAttribute="data-delivery-preset-bar"
				resetKey={resetKey}
				onSelect={(id) => guard(() => onApply(id))}
				onSave={() => guard(onSave)}
				onSaveAs={(name) => guard(() => {
					onNameChange(name);
					return onSave(name);
				})}
				onReset={() => guard(() => onApply(selectedId))}
				onDelete={() => guard(onDelete)}
				onImport={(file) => guard(() => onImport(file))}
				onExport={() => guard(onExport)}
			/>
		</section>
	);
}
