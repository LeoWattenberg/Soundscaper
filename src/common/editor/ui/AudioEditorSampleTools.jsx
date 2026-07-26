import {
	Button,
	Icon,
	ToggleToolButton,
} from '@dilsonspickles/components';
import { selectAudioEditorEditBlock } from './edit-blocking.ts';

export default function AudioEditorSampleTools({ controller, snapshot, copy, run }) {
	const sampleEdit = snapshot.sampleEdit;
	if (!sampleEdit?.available) return null;
	const editBlock = selectAudioEditorEditBlock(snapshot);
	const blocked = editBlock.blocked;
	const smoothingDisabled = blocked || !snapshot.selectedClipId || !snapshot.selection;
	return (
		<div
			className="audio-editor-sample-tools"
			data-sample-edit-tools
			data-edit-block-reason={editBlock.reason || undefined}
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
