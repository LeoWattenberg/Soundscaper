import { useMemo, useState } from 'react';
import { Button, DialogFooter } from '@dilsonspickles/components';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	LABEL_EXPORT_DIALOG_FORMATS,
	createLabelExportRequest,
	listLabelExportTracks,
	toggleLabelExportTrack,
} from '../label-export-dialog-model.ts';
import { DesignCheckbox, LabeledDropdown } from './inspector-controls.jsx';

export function LabelExportDialog({ isOpen, controller, snapshot, copy, onClose }) {
	const tracks = useMemo(() => listLabelExportTracks(snapshot.project), [snapshot.project]);
	const [format, setFormat] = useState('txt');
	const [trackIds, setTrackIds] = useState(() => tracks.map(({ id }) => id));
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState('');
	const selectedTrackIds = new Set(trackIds);

	const start = () => {
		let request;
		try {
			request = createLabelExportRequest(format, trackIds, tracks);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			return;
		}
		setError('');
		setExporting(true);
		Promise.resolve(controller.actions.labels.export(request)).then((result) => {
			setExporting(false);
			if (!result?.cancelled) onClose?.();
		}, (cause) => {
			setExporting(false);
			setError(cause instanceof Error ? cause.message : String(cause));
		});
	};

	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			title={copy.exportLabels}
			onClose={exporting ? undefined : onClose}
			closeOnEscape={!exporting}
			closeOnOutside={!exporting}
			width={520}
			className="audio-editor-label-export-dialog"
			dataAttributes={{ 'data-label-export-dialog': '' }}
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					rightContent={(
						<>
							<Button variant="secondary" disabled={exporting} onClick={onClose}>{copy.cancel}</Button>
							<Button variant="primary" disabled={exporting || !trackIds.length} onClick={start}>{copy.exportLabels}</Button>
						</>
					)}
				/>
			)}
		>
			<LabeledDropdown
				label={copy.format}
				hook="label-format"
				value={format}
				onChange={setFormat}
				disabled={exporting}
				options={LABEL_EXPORT_DIALOG_FORMATS.map(({ id, labelKey }) => ({ value: id, label: copy[labelKey] }))}
			/>
			<fieldset className="audio-editor-label-export-dialog__tracks">
				<legend>{copy.labels}</legend>
				<div className="audio-editor-label-export-dialog__track-actions">
					<Button variant="secondary" disabled={exporting || trackIds.length === tracks.length} onClick={() => setTrackIds(tracks.map(({ id }) => id))}>{copy.selectAll}</Button>
					<Button variant="secondary" disabled={exporting || !trackIds.length} onClick={() => setTrackIds([])}>{copy.selectNone}</Button>
				</div>
				<div className="audio-editor-label-export-dialog__track-list">
					{tracks.map((track) => (
						<div key={track.id} data-label-export-track={track.id}>
							<DesignCheckbox
								label={track.name}
								checked={selectedTrackIds.has(track.id)}
								disabled={exporting}
								onChange={(checked) => setTrackIds((current) => toggleLabelExportTrack(current, track.id, checked))}
							/>
						</div>
					))}
				</div>
			</fieldset>
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
		</AudioEditorDialogShell>
	);
}

export default LabelExportDialog;
