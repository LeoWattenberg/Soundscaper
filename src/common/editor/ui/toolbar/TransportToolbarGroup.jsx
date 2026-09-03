/* SPDX-License-Identifier: AGPL-3.0-only */

import { ToggleToolButton } from '@soundscaper/design-system/ToggleToolButton';
import { ToolbarButtonGroup } from '@soundscaper/design-system/Toolbar';
import { TransportButton } from '@soundscaper/design-system/TransportButton';

import AudioEditorSplitButton from '../AudioEditorSplitButton.tsx';
import { formatOptionsLabel } from '../localization-template.ts';
import {
	AccessibleTransportButton,
	RecordFlyout,
	TelemetryPlayTransportControl,
} from './AudioEditorTransportControls.jsx';
import FramescaperCaptureRecordControl, {
	framescaperCaptureRecordRequired,
	useFramescaperCaptureRecordVisibility,
} from './FramescaperCaptureRecordControl.tsx';

export const TRANSPORT_BUTTON_IDS = Object.freeze(['play', 'stop', 'record', 'jump-start', 'jump-end', 'loop', 'metronome']);
// In the compact layout the primary transport stays in the always-visible bar
// while the rest of the tool toolbar lives in the chrome drawer. The two sets
// are disjoint so no control is ever mounted twice.
export const COMPACT_BAR_TRANSPORT_BUTTONS = Object.freeze(['play', 'stop', 'record']);
export const DRAWER_TRANSPORT_BUTTONS = Object.freeze(
	TRANSPORT_BUTTON_IDS.filter((buttonId) => !COMPACT_BAR_TRANSPORT_BUTTONS.includes(buttonId)),
);

/**
 * Whether any of the requested transport buttons is shown, honouring the
 * toolbar-button preferences and the record slot's capture fallback.
 *
 * @param {readonly string[]} buttons
 * @param {{
 *   capabilities: {audioRecording?: boolean},
 *   captureRecordRequired: boolean,
 *   framescaperCaptureRecordVisible: boolean,
 *   isToolbarButtonVisible: (buttonId: string) => boolean,
 * }} options
 * @returns {boolean}
 */
export function transportToolbarButtonsVisible(buttons, {
	capabilities,
	captureRecordRequired,
	framescaperCaptureRecordVisible,
	isToolbarButtonVisible,
}) {
	return buttons.some((buttonId) => {
		if (buttonId !== 'record') return isToolbarButtonVisible(buttonId);
		if (!capabilities.audioRecording && !framescaperCaptureRecordVisible) return false;
		return isToolbarButtonVisible('record') || captureRecordRequired;
	});
}

export default function TransportToolbarGroup({
	buttons = TRANSPORT_BUTTON_IDS,
	actionRuntime,
	blocked,
	capabilities,
	controller,
	copy,
	onJumpToEnd,
	onJumpToStart,
	onOpenRecordingOffset,
	onOpenTakeCycleRecovery,
	onOpenTimedRecording,
	recordLabel,
	run,
	snapshot,
	toggleRecording,
	toolbarButtons,
}) {
	const project = snapshot.project;
	const isToolbarButtonVisible = (buttonId) => toolbarButtons?.[buttonId] !== false;
	const wants = (buttonId) => buttons.includes(buttonId) && isToolbarButtonVisible(buttonId);
	const framescaperCaptureRecordVisible = useFramescaperCaptureRecordVisibility(snapshot);
	const captureRecordSlotVisible = buttons.includes('record')
		&& (isToolbarButtonVisible('record') || framescaperCaptureRecordRequired(snapshot.capture));
	const recordControlLabel = snapshot.readOnly
		? `${recordLabel} — ${copy.projectReadOnly}`
		: recordLabel;
	return (
		<ToolbarButtonGroup className="kw-audio-editor__transport" gap={2}>
			{wants('play') && <TelemetryPlayTransportControl
				copy={copy}
				snapshot={snapshot}
				blocked={blocked}
				controller={controller}
				run={run}
			/>}
			{wants('stop') && <span data-transport="stop"><TransportButton icon="stop" ariaLabel={copy.stop} onClick={() => run(() => controller.actions.transport.stop())} /></span>}
			{capabilities.audioRecording && wants('record') && <span data-transport="record">
				<AudioEditorSplitButton
					icon="record"
					className="kw-audio-editor__transport-record kw-audio-editor__transport-record-split"
					ariaLabel={recordControlLabel}
					optionsAriaLabel={formatOptionsLabel(copy, copy.recordMenu)}
					recording={snapshot.recording}
					pressed={Boolean(snapshot.recording)}
					disabled={Boolean(snapshot.takeCycleRecovery) || snapshot.readOnly || snapshot.importing || snapshot.exporting || snapshot.transportState === 'playing' || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={toggleRecording}
				>
					{({ close }) => <RecordFlyout
						copy={copy}
						snapshot={snapshot}
						controller={controller}
						recordLabel={recordLabel}
						toggleRecording={toggleRecording}
						actionRuntime={actionRuntime}
						run={run}
						onOpenRecordingOffset={onOpenRecordingOffset}
						onOpenTimedRecording={onOpenTimedRecording}
						onOpenTakeCycleRecovery={onOpenTakeCycleRecovery}
						onClose={close}
					/>}
				</AudioEditorSplitButton>
			</span>
			}
			{framescaperCaptureRecordVisible && captureRecordSlotVisible && <FramescaperCaptureRecordControl
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				blocked={blocked}
				run={run}
			/>}
			{wants('jump-start') && <TransportButton icon="skip-back" ariaLabel={copy.jumpStart} disabled={blocked} onClick={onJumpToStart} />}
			{wants('jump-end') && <TransportButton icon="skip-forward" ariaLabel={copy.jumpEnd} disabled={blocked} onClick={onJumpToEnd} />}
			{wants('loop') && <AccessibleTransportButton
				icon="loop"
				ariaLabel={copy.loop}
				active={Boolean(project?.loop?.enabled)}
				pressed={Boolean(project?.loop?.enabled)}
				disabled={blocked}
				onClick={() => run(() => controller.actions.transport.toggleLoop())}
			/>
			}
			{wants('metronome') && <ToggleToolButton
				icon="metronome"
				isActive={Boolean(snapshot.recordingOptions?.metronome)}
				ariaLabel={copy.metronome}
				onClick={() => run(() => controller.actions.transport.toggleMetronome())}
			/>}
		</ToolbarButtonGroup>
	);
}
