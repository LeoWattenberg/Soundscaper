import React from 'react';
import {
	Button,
	Icon,
	ToggleToolButton,
} from '@dilsonspickles/components';

export default function AudioEditorSampleTools({ controller, snapshot, copy, run }) {
	const sampleEdit = snapshot.sampleEdit;
	if (!sampleEdit?.available) return null;
	const blocked = snapshot.readOnly
		|| snapshot.importing
		|| snapshot.recording
		|| snapshot.recordingStarting
		|| snapshot.exporting
		|| snapshot.processingEffect;
	const smoothingDisabled = blocked || sampleEdit.processing || !snapshot.selectedClipId || !snapshot.selection;
	return (
		<div
			className="audio-editor-sample-tools"
			data-sample-edit-tools
			role="toolbar"
			aria-label={copy.sampleTools}
		>
			<ToggleToolButton
				icon="brush"
				isActive={sampleEdit.mode === 'pencil'}
				disabled={blocked || sampleEdit.processing || !snapshot.selectedClipId}
				ariaLabel={copy.samplePencil}
				onClick={() => run(() => controller.actions.sampleEdit.setMode(sampleEdit.mode === 'pencil' ? null : 'pencil'))}
			/>
			<Button
				variant="secondary"
				size="small"
				icon={<Icon name="automation" size={14} />}
				disabled={smoothingDisabled}
				onClick={() => run(() => controller.actions.sampleEdit.smooth({ clipId: snapshot.selectedClipId }))}
			>
				{copy.sampleSmooth}
			</Button>
			{sampleEdit.processing && (
				<Button variant="tertiary" size="small" onClick={() => controller.actions.sampleEdit.cancel()}>
					{copy.cancel}
				</Button>
			)}
		</div>
	);
}
