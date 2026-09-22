/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { Flyout } from '@soundscaper/design-system/Flyout';
import { Icon } from '@soundscaper/design-system/Icon';

import SoundActivationSettings from '../SoundActivationSettings.tsx';
import { createTakeCycleRecordingMenuItems } from '../take-cycle-recording-menu.ts';

import '../audio-editor-design-system/20a-record-flyout.css';

/** The microphone menu groups actions and persistent recording choices. */
export default function RecordFlyout({
	copy,
	snapshot,
	controller,
	run,
	locale = 'en',
	onOpenTimedRecording,
	onOpenTakeCycleRecovery = () => undefined,
	onClose,
}) {
	const settingsTrigger = useRef(null);
	const [settingsPosition, setSettingsPosition] = useState(null);
	const recoveryBlocked = Boolean(snapshot.takeCycleRecovery);
	const recordingInputBlocked = recoveryBlocked || snapshot.recording || snapshot.recordingStarting
		|| snapshot.recordingScheduling || snapshot.scheduledRecording;
	const actionBlocked = snapshot.readOnly || snapshot.importing || snapshot.exporting
		|| snapshot.transportState === 'playing' || recordingInputBlocked;
	const soundActivation = snapshot.recordingInputs?.soundActivation;
	const hasTimeSelection = Boolean(snapshot.selection
		&& snapshot.selection.endFrame > snapshot.selection.startFrame);
	const takeCycleItems = createTakeCycleRecordingMenuItems({
		snapshot,
		copy,
		start: () => run(() => controller.actions.recording.cycle.start()),
		openRecovery: onOpenTakeCycleRecovery,
	});
	const act = (operation) => {
		onClose();
		operation();
	};
	const openSettings = () => {
		const rect = settingsTrigger.current?.getBoundingClientRect();
		if (!rect) return;
		setSettingsPosition({ x: rect.right, y: rect.top + rect.height / 2 });
	};
	return <div className="kw-audio-editor__record-flyout" data-record-flyout>
		<div className="kw-audio-editor__record-flyout-grid">
			<RecordAction label={copy.recordToNewTrack}
				disabled={actionBlocked}
				onClick={() => act(() => run(() => controller.actions.recording.startNewTrack()))} />
			{takeCycleItems[0] ? <RecordAction label={takeCycleItems[0].label}
				disabled={takeCycleItems[0].disabled}
				onClick={() => act(takeCycleItems[0].onClick)} /> : <span />}
			<RecordAction label={copy.timedRecordingAction}
				disabled={actionBlocked}
				onClick={() => act(onOpenTimedRecording)} />
			{snapshot.productId === 'soundscaper' && soundActivation ? <div className="kw-audio-editor__record-flyout-activation">
				<RecordAction label={copy.soundActivatedRecording}
					disabled={actionBlocked || hasTimeSelection}
					onClick={() => act(() => run(() => controller.actions.recording.startSoundActivated()))} />
				<button ref={settingsTrigger} type="button" className="kw-audio-editor__record-flyout-cog"
					aria-label={copy.soundActivationSettings}
					aria-haspopup="dialog" aria-expanded={Boolean(settingsPosition)}
					disabled={!soundActivation || recoveryBlocked}
					onClick={() => settingsPosition ? setSettingsPosition(null) : openSettings()}>
					<Icon name="cog" size={16} />
				</button>
				<Flyout isOpen={Boolean(settingsPosition)} onClose={() => setSettingsPosition(null)}
					x={settingsPosition?.x || 0} y={settingsPosition?.y || 0} direction="right"
					showArrow={false} triggerRef={settingsTrigger}
					ariaLabel={copy.soundActivationSettings}
					className="kw-audio-editor__record-activation-settings">
					<div onKeyDown={(event) => {
						if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
							event.stopPropagation();
						}
					}}>
						<SoundActivationSettings productId={snapshot.productId} locale={locale}
							readOnly={Boolean(snapshot.readOnly)} soundActivation={soundActivation}
							copy={copy} controller={controller} run={run} />
					</div>
				</Flyout>
			</div> : <span />}
			<label className="kw-audio-editor__record-flyout-check">
				<input type="checkbox" checked={Boolean(snapshot.recordingOptions?.leadIn)}
					disabled={recordingInputBlocked}
					onChange={() => run(() => controller.actions.recording.toggleLeadIn())} />
				<span>{copy.leadInTimeOption}</span>
			</label>
			<label className="kw-audio-editor__record-flyout-check">
				<input type="checkbox" checked={Boolean(snapshot.monitor?.enabled)}
					disabled={recoveryBlocked || snapshot.recordingStarting}
					onChange={() => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled))} />
				<span>{copy.monitor}</span>
			</label>
		</div>
		{takeCycleItems[1] && <RecordAction label={takeCycleItems[1].label}
			disabled={takeCycleItems[1].disabled}
			onClick={() => act(takeCycleItems[1].onClick)} />}
	</div>;
}

function RecordAction({ label, disabled, onClick }) {
	return <button type="button" className="kw-audio-editor__record-flyout-action"
		aria-disabled={Boolean(disabled)} disabled={disabled} onClick={onClick}>
		<span>{label}</span>
	</button>;
}
