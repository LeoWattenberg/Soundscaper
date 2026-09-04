import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';

export default function SpectralSelectionDialog({ controller, snapshot, copy, run, onClose }) {
	const project = snapshot.project;
	const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId && candidate.type === 'audio') || null;
	const nyquist = Math.max(1, (project?.sampleRate || 48_000) / 2);
	const existing = snapshot.selection?.frequencyRange;
	const projectIdentity = project?.id ?? null;
	const defaultMinimumFrequency = existing?.minimumFrequency ?? track?.spectrogram?.minimumFrequency ?? 0;
	const defaultMaximumFrequency = existing?.maximumFrequency ?? track?.spectrogram?.maximumFrequency ?? Math.min(20_000, nyquist);
	const currentProjectOwnership = useRef({ projectIdentity });
	const stateProjectIdentity = useRef(projectIdentity);
	if (currentProjectOwnership.current?.projectIdentity !== projectIdentity) {
		currentProjectOwnership.current = { projectIdentity };
	}
	const [minimumFrequency, setMinimumFrequency] = useState(defaultMinimumFrequency);
	const [maximumFrequency, setMaximumFrequency] = useState(defaultMaximumFrequency);
	const [gainDb, setGainDb] = useState(6);

	useEffect(() => {
		if (stateProjectIdentity.current === projectIdentity) return;
		stateProjectIdentity.current = projectIdentity;
		setMinimumFrequency(defaultMinimumFrequency);
		setMaximumFrequency(defaultMaximumFrequency);
		setGainDb(6);
	}, [defaultMaximumFrequency, defaultMinimumFrequency, projectIdentity]);
	useEffect(() => {
		currentProjectOwnership.current ??= { projectIdentity: stateProjectIdentity.current };
		return () => { currentProjectOwnership.current = null; };
	}, []);

	const selectionOptions = () => ({
		minimumFrequency: Number(minimumFrequency),
		maximumFrequency: Number(maximumFrequency),
	});
	const submit = (operation) => {
		const projectOwnership = currentProjectOwnership.current;
		if (!projectIdentity || stateProjectIdentity.current !== projectIdentity || !projectOwnership) return;
		const options = selectionOptions();
		const requestedGainDb = Number(gainDb);
		void runAwaitedAudioEditorOperation(run, async () => {
			if (currentProjectOwnership.current !== projectOwnership) return;
			controller.actions.spectral.boxSelect(options);
			if (currentProjectOwnership.current !== projectOwnership) return;
			if (operation === 'delete') await controller.actions.spectral.delete();
			if (operation === 'amplify') await controller.actions.spectral.amplify(requestedGainDb);
		}).then(() => {
			if (currentProjectOwnership.current === projectOwnership) onClose();
		}).catch(() => undefined);
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
			footer={<DialogFooter
				className="audio-editor-dialog-footer"
				rightContent={<>
					<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
					<Button variant="secondary" disabled={!validRange} onClick={() => submit('select')}>{copy.selectFrequencyRange}</Button>
					<Button variant="secondary" disabled={!validRange} onClick={() => submit('delete')}>{copy.spectralDelete}</Button>
					<Button variant="primary" disabled={!validRange || !Number.isFinite(Number(gainDb))} onClick={() => submit('amplify')}>{copy.spectralAmplify}</Button>
				</>}
			/>}
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
		</AudioEditorDialogShell>
	);
}
