import { useState } from 'react';
import { Button, NumberStepper } from '@dilsonspickles/components';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

export default function SpectralSelectionDialog({ controller, snapshot, copy, run, onClose }) {
	const project = snapshot.project;
	const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId && candidate.type === 'audio') || null;
	const nyquist = Math.max(1, (project?.sampleRate || 48_000) / 2);
	const existing = snapshot.selection?.frequencyRange;
	const [minimumFrequency, setMinimumFrequency] = useState(existing?.minimumFrequency ?? track?.spectrogram?.minimumFrequency ?? 0);
	const [maximumFrequency, setMaximumFrequency] = useState(existing?.maximumFrequency ?? track?.spectrogram?.maximumFrequency ?? Math.min(20_000, nyquist));
	const [gainDb, setGainDb] = useState(6);

	const selectionOptions = () => ({
		minimumFrequency: Number(minimumFrequency),
		maximumFrequency: Number(maximumFrequency),
	});
	const submit = (operation) => {
		run(async () => {
			controller.actions.spectral.boxSelect(selectionOptions());
			if (operation === 'delete') await controller.actions.spectral.delete();
			if (operation === 'amplify') await controller.actions.spectral.amplify(Number(gainDb));
		});
		onClose();
	};
	const validRange = Number.isFinite(Number(minimumFrequency))
		&& Number.isFinite(Number(maximumFrequency))
		&& Number(minimumFrequency) >= 0
		&& Number(maximumFrequency) <= nyquist
		&& Number(maximumFrequency) > Number(minimumFrequency);

	return (
		<AudioEditorDialogShell
			title={copy.spectralSelection}
			onClose={onClose}
			width={540}
			bodyClassName="kw-audio-editor-dialog__body"
		>
					<label className="kw-audio-editor-dialog__field">
						<span>{copy.minimumFrequency}</span>
						<NumberStepper value={String(minimumFrequency)} min={0} max={Math.max(0, nyquist - 1)} step={10} width="100%" onChange={setMinimumFrequency} />
					</label>
					<label className="kw-audio-editor-dialog__field">
						<span>{copy.maximumFrequency}</span>
						<NumberStepper value={String(maximumFrequency)} min={1} max={nyquist} step={10} width="100%" onChange={setMaximumFrequency} />
					</label>
					<label className="kw-audio-editor-dialog__field">
						<span>{copy.spectralGain}</span>
						<NumberStepper value={String(gainDb)} min={-60} max={60} step={1} width="100%" onChange={setGainDb} />
					</label>
					<div className="kw-audio-editor-dialog__actions">
						<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
						<Button variant="secondary" disabled={!validRange} onClick={() => submit('select')}>{copy.selectFrequencyRange}</Button>
						<Button variant="secondary" disabled={!validRange} onClick={() => submit('delete')}>{copy.spectralDelete}</Button>
						<Button disabled={!validRange || !Number.isFinite(Number(gainDb))} onClick={() => submit('amplify')}>{copy.spectralAmplify}</Button>
					</div>
		</AudioEditorDialogShell>
	);
}
