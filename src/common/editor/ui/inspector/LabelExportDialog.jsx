import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

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
	const projectIdentity = snapshot.project?.id ?? null;
	const currentProjectIdentity = useRef(projectIdentity);
	const stateProjectIdentity = useRef(projectIdentity);
	const activeSubmission = useRef(null);
	const [format, setFormat] = useState('txt');
	const [trackIds, setTrackIds] = useState(() => tracks.map(({ id }) => id));
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState('');
	const selectedTrackIds = new Set(trackIds);
	currentProjectIdentity.current = projectIdentity;

	useEffect(() => {
		if (stateProjectIdentity.current === projectIdentity) return;
		stateProjectIdentity.current = projectIdentity;
		activeSubmission.current = null;
		setFormat('txt');
		setTrackIds(tracks.map(({ id }) => id));
		setExporting(false);
		setError('');
	}, [projectIdentity, tracks]);

	useEffect(() => () => { activeSubmission.current = null; }, []);

	const start = () => {
		if (activeSubmission.current?.projectIdentity === projectIdentity) return;
		let request;
		try {
			request = createLabelExportRequest(format, trackIds, tracks);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			return;
		}
		setError('');
		setExporting(true);
		const submission = { projectIdentity };
		activeSubmission.current = submission;
		const ownsSubmission = () => activeSubmission.current === submission
			&& currentProjectIdentity.current === submission.projectIdentity;
		let operation;
		try {
			operation = controller.actions.labels.export(request);
		} catch (cause) {
			if (ownsSubmission()) {
				activeSubmission.current = null;
				setExporting(false);
				setError(cause instanceof Error ? cause.message : String(cause));
			}
			return;
		}
		Promise.resolve(operation).then((result) => {
			if (!ownsSubmission()) return;
			activeSubmission.current = null;
			setExporting(false);
			if (!result?.cancelled) onClose?.();
		}, (cause) => {
			if (!ownsSubmission()) return;
			activeSubmission.current = null;
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
