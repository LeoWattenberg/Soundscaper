import { useState } from 'react';
import EffectPresetBar from './EffectPresetBar.jsx';
import { runDeliveryPresetAction } from '../export-preset-model.ts';

/**
 * Delivery preset controls for the export dialog.
 *
 * The same bar the effect surfaces use, so the actions sit to the right of the
 * dropdown as they do in Audacity rather than stacking below it, and naming
 * happens in the shared Save as… prompt instead of a permanent text field.
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
		<section className="audio-editor-export-section" data-delivery-presets>
			<h3>{copy.deliveryPreset}</h3>
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
