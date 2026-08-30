import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@soundscaper/design-system/Button';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Flyout } from '@soundscaper/design-system/Flyout';
import { Icon } from '@soundscaper/design-system/Icon';
import { SelectionToolbar } from '@soundscaper/design-system/SelectionToolbar';
import { TimeCode } from '@soundscaper/design-system/TimeCode';
import { ToolButton } from '@soundscaper/design-system/ToolButton';
import { TransportButton } from '@soundscaper/design-system/TransportButton';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import { framesToSeconds, secondsToFrames } from '../../design-system-adapters.js';
import AudioEditorSplitButton from '../AudioEditorSplitButton.tsx';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS } from '../application-menu-registry.ts';
import { formatOptionsLabel } from '../localization-template.ts';
import { formatPlaybackSpeed } from '../meter-settings.ts';
import { createTakeCycleRecordingMenuItems } from '../take-cycle-recording-menu.ts';
import { AudioDevicesFlyout } from './AudioEditorMeterControls.jsx';
import EditorTaskProgressBar from './EditorTaskProgressBar.tsx';

export function TelemetryPlayTransportControl({ copy, snapshot, blocked, controller, run }) {
	const transportState = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.transportState,
	);
	const playing = transportState === 'playing';
	return <span data-transport="play"><AudioEditorSplitButton
		icon={playing ? 'pause' : 'play'}
		className="kw-audio-editor__transport-play kw-audio-editor__transport-play-split"
		ariaLabel={playing ? copy.pause : copy.play}
		optionsAriaLabel={formatOptionsLabel(copy, playing ? copy.pause : copy.play)}
		disabled={blocked && !snapshot.recording}
		active={playing}
		pressed={playing}
		onClick={() => run(() => controller.actions.transport.playPause())}
	>
		{({ close }) => <PlaySpeedFlyout
			copy={copy}
			snapshot={snapshot}
			blocked={blocked}
			controller={controller}
			run={run}
			close={close}
		/>}
	</AudioEditorSplitButton></span>;
}

export function PlaySpeedFlyout({ copy, snapshot, blocked, controller, run, close }) {
	const transportState = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.transportState,
	);
	const playbackMode = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.playbackMode,
	);
	const playAtSpeedPreparing = Boolean(snapshot.playbackOptions?.preparing);
	const playAtSpeedActive = transportState === 'playing'
		&& ['naive', 'staffpad'].includes(playbackMode);
	const playAtSpeedLabel = playAtSpeedPreparing
		? copy.cancelPlayAtSpeed
		: playAtSpeedActive ? copy.pausePlayAtSpeed : copy.playAtSpeed;
	return (
		<div className="kw-audio-editor__split-button-options" data-play-at-speed>
			<ContextMenuItem
				label={playAtSpeedLabel}
				disabled={blocked && !playAtSpeedPreparing}
				onClick={() => {
					close();
					run(() => controller.actions.transport.playAtSpeed());
				}}
			/>
			<label className="kw-audio-editor__play-at-speed-slider">
				<span>{copy.playbackSpeed}</span>
				<input
					type="range"
					min="0.5"
					max="2"
					step="0.05"
					value={snapshot.playbackOptions?.rate || 1}
					aria-label={copy.playbackSpeed}
					disabled={blocked || transportState === 'playing'}
					onChange={(event) => run(() => controller.actions.transport.setPlayAtSpeedRate(Number(event.currentTarget.value)))}
				/>
				<output aria-hidden="true">{formatPlaybackSpeed(snapshot.playbackOptions?.rate || 1)}×</output>
			</label>
		</div>
	);
}

export function RecordFlyout({
	copy,
	snapshot,
	recordLabel,
	toggleRecording,
	actionRuntime,
	controller,
	run,
	onOpenRecordingOffset,
	onOpenTimedRecording,
	onOpenTakeCycleRecovery = () => undefined,
	onClose,
}) {
	const recoveryBlocked = Boolean(snapshot.takeCycleRecovery);
	const ordinaryRecording = snapshot.recordingKind !== 'take-cycle';
	const recordingInputBlocked = recoveryBlocked || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording;
	const soundActivation = snapshot.recordingInputs?.soundActivation;
	const soundActivationMutationBlocked = snapshot.readOnly
		|| !soundActivation
		|| soundActivation.preferenceMutationBlocked;
	const takeCycleItems = createTakeCycleRecordingMenuItems({
		snapshot,
		copy,
		start: () => run(() => controller.actions.recording.cycle.start()),
		openRecovery: onOpenTakeCycleRecovery,
	});
	const items = [
		{
			label: snapshot.recording ? copy.stopRecording : recordLabel,
			shortcut: 'R',
			disabled: recoveryBlocked || snapshot.readOnly || snapshot.importing || snapshot.exporting || snapshot.transportState === 'playing' || snapshot.recordingScheduling || snapshot.scheduledRecording,
			onClick: toggleRecording,
		},
		{
			id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.recordOnNewTrack,
			label: copy.recordNewTrack,
			shortcut: 'Shift+R',
			disabled: snapshot.readOnly || recordingInputBlocked,
			onClick: () => run(() => controller.actions.recording.startNewTrack()),
		},
		{ label: copy.stop, onClick: () => run(() => controller.actions.transport.stop()) },
		{
			id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.pauseRecording,
			label: snapshot.recordingOptions?.paused ? (copy.resumeRecording || copy.record) : copy.pauseRecording,
			disabled: !snapshot.recording || !ordinaryRecording,
			checked: Boolean(snapshot.recordingOptions?.paused),
			onClick: () => run(() => controller.actions.recording.pause()),
		},
		{ divider: true },
		...takeCycleItems,
		...(takeCycleItems.length ? [{ divider: true }] : []),
		{
			label: snapshot.recordingInputs?.hasOpenInputs ? copy.audioDeviceRefresh : copy.recordingAllowInputs,
			disabled: recordingInputBlocked,
			onClick: () => run(() => snapshot.recordingInputs?.hasOpenInputs
				? controller.actions.recording.refreshInputs()
				: controller.actions.recording.requestInputAccess()),
		},
		...(snapshot.recordingInputs?.hasOpenInputs ? [{
			label: copy.recordingReleaseInputs,
			disabled: recordingInputBlocked,
			onClick: () => run(() => controller.actions.recording.releaseInputs()),
		}] : []),
		{ divider: true },
		{
			label: copy.monitor,
			checked: Boolean(snapshot.monitor?.enabled),
			disabled: recoveryBlocked || snapshot.recordingStarting,
			onClick: () => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled)),
		},
		{ label: copy.recordingOffset, disabled: recoveryBlocked, onClick: onOpenRecordingOffset },
		{
			id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.leadInRecording,
			label: copy.leadInTime,
			checked: Boolean(snapshot.recordingOptions?.leadIn),
			disabled: recordingInputBlocked,
			onClick: () => run(() => controller.actions.recording.toggleLeadIn()),
		},
		{
			id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.setUpTimedRecording,
			label: copy.timedRecording,
			disabled: recoveryBlocked || snapshot.readOnly || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling,
			onClick: onOpenTimedRecording,
		},
		...(snapshot.productId === 'soundscaper' ? [{
			id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.toggleSoundActivatedRecording,
			label: copy.soundActivatedRecording,
			checked: Boolean(soundActivation?.preferences.enabled),
			disabled: recoveryBlocked || soundActivationMutationBlocked,
			onClick: () => run(() => actionRuntime.recording.toggleSoundActivation()),
		}, {
			id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.setSoundActivationLevel,
			label: copy.soundActivationLevel,
			disabled: recoveryBlocked || !soundActivation,
			onClick: () => actionRuntime.recording.openSoundActivation(),
		}] : []),
	];
	return <SplitButtonMenuItems items={items} onClose={onClose} />;
}

function SplitButtonMenuItems({ items, onClose }) {
	return items.map((item, index) => item.divider
		? <ContextMenuItem key={`divider-${index}`} isDivider />
		: <ContextMenuItem
			key={`${item.label}-${index}`}
			label={item.label}
			shortcut={item.shortcut}
			disabled={item.disabled}
			checked={item.checked}
			onClick={item.disabled ? undefined : () => {
				onClose();
				item.onClick?.();
			}}
		/>);
}

export function EditorActionBar({
	copy,
	snapshot,
	controller,
	showAup4,
	run,
	editBlocked,
	blocked,
	executeEdit,
	onSaveAup4,
	onExportAudio,
	onToggleMixer,
}) {
	const canUndo = snapshot.history?.canUndo;
	const canRedo = snapshot.history?.canRedo;
	const mixerVisible = Boolean(snapshot.preferences?.workspace?.panels?.mixer?.visible);
	return (
		<div className="kw-audio-editor__action-bar" data-action-bar role="toolbar" aria-label={copy.actionBar}>
			<div className="kw-audio-editor__action-bar-center">
				{showAup4 && <Button
					variant="secondary"
					size="small"
					className="kw-audio-editor__action-bar-button"
					icon={<Icon name="save" size={14} />}
					disabled={blocked}
					onClick={onSaveAup4}
				>
					{copy.saveAsAup4}
				</Button>}
				<Button
					variant="secondary"
					size="small"
					className="kw-audio-editor__action-bar-button"
					icon={<Icon name="export" size={14} />}
					disabled={blocked}
					onClick={onExportAudio}
				>
					{copy.exportAudio}
				</Button>
				<span className="kw-audio-editor__action-bar-toggle" data-action="mixer">
					<Button
						variant={mixerVisible ? 'primary' : 'secondary'}
						size="small"
						className={`kw-audio-editor__action-bar-button${mixerVisible ? ' kw-audio-editor__action-bar-button--active' : ''}`}
						icon={iconNameToChar('MIXER')}
						aria-pressed={mixerVisible}
						onClick={onToggleMixer}
					>
						{copy.panelMixer}
					</Button>
				</span>
				<ActionBarAudioDevicesButton
					copy={copy}
					snapshot={snapshot}
					controller={controller}
					run={run}
				/>
			</div>
			<div className="kw-audio-editor__action-bar-right">
				<span data-edit="undo">
					<ToolButton icon="undo" ariaLabel={copy.undo} disabled={editBlocked || !canUndo} onClick={() => executeEdit('undo')} />
				</span>
				<span data-edit="redo">
					<ToolButton icon="redo" ariaLabel={copy.redo} disabled={editBlocked || !canRedo} onClick={() => executeEdit('redo')} />
				</span>
			</div>
		</div>
	);
}

function ActionBarAudioDevicesButton({ copy, snapshot, controller, run }) {
	const triggerRef = useRef(null);
	const [position, setPosition] = useState(null);
	const setTrigger = useCallback((element) => {
		triggerRef.current = element?.querySelector('button') || null;
	}, []);
	const close = useCallback(() => setPosition(null), []);
	const toggle = (event) => {
		if (position) {
			close();
			return;
		}
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			x: rect.left + rect.width / 2,
			y: rect.bottom,
			direction: window.innerHeight - rect.bottom >= 320 ? 'down' : 'up',
			autoFocus: event.nativeEvent?.detail === 0,
		});
	};

	useEffect(() => {
		triggerRef.current?.setAttribute('aria-expanded', String(Boolean(position)));
	}, [position]);

	return (
		<>
			<span ref={setTrigger} className="kw-audio-editor__action-bar-toggle" data-action="audio-devices">
				<Button
					variant="secondary"
					size="small"
					className="kw-audio-editor__action-bar-button"
					icon={<span className="musescore-icon" aria-hidden="true">{iconNameToChar('AUDIO')}</span>}
					aria-expanded={Boolean(position)}
					onClick={toggle}
				>
					{copy.audioDevices}
				</Button>
			</span>
			<Flyout
				isOpen={Boolean(position)}
				onClose={close}
				x={position?.x || 0}
				y={position?.y || 0}
				direction={position?.direction || 'down'}
				autoFocus={Boolean(position?.autoFocus)}
				triggerRef={triggerRef}
				showArrow
				closeOnOutsideClick
				closeOnEscape
				ariaLabel={copy.audioDevices}
				role="dialog"
				className="kw-audio-editor__audacity-level-flyout kw-audio-editor__audio-devices-flyout"
			>
				<AudioDevicesFlyout copy={copy} snapshot={snapshot} controller={controller} run={run} />
			</Flyout>
		</>
	);
}

export function AccessibleTimeCode({ ariaLabel, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.timecode__format-button')?.setAttribute('aria-label', ariaLabel);
	}, [ariaLabel]);
	return <span ref={wrapperRef}><TimeCode {...props} /></span>;
}

export function TelemetryTimeCode({
	controller,
	copy,
	project,
	durationFrames,
	isCompact,
	recording,
	run,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.positionFrame || 0,
	);
	return <div className="kw-audio-editor__timecode" data-time-display>
		<AccessibleTimeCode
			ariaLabel={`${copy.playhead}: ${copy.format}`}
			value={framesToSeconds(positionFrame, { sampleRate: project?.sampleRate })}
			sampleRate={project?.sampleRate || 48_000}
			showFormatSelector={!isCompact}
			disabled={recording}
			onChange={(seconds) => run(() => controller.actions.transport.seek(secondsToFrames(seconds, {
				maximumFrame: durationFrames,
				sampleRate: project?.sampleRate,
			})))}
		/>
	</div>;
}

export function AccessibleTransportButton({ pressed, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('button')?.setAttribute('aria-pressed', String(Boolean(pressed)));
	}, [pressed]);
	return <span ref={wrapperRef} className="kw-audio-editor__transport-state"><TransportButton {...props} /></span>;
}

export function AccessibleSelectionToolbar({
	controller,
	snapshot,
	copy,
	statusMessage,
	statusState,
	durationFrames,
	disabled,
	showSelectionToolbar,
	showStatusbar,
	run,
}) {
	const wrapperRef = useRef(null);
	const [statusTarget, setStatusTarget] = useState(null);
	const [claimingLock, setClaimingLock] = useState(false);
	const [format, setFormat] = useState('hh:mm:ss+milliseconds');
	const [durationFormat, setDurationFormat] = useState('hh:mm:ss+milliseconds');
	const selection = snapshot.selection;
	const sampleRate = snapshot.project?.sampleRate || 48_000;
	const canEdit = Boolean(selection && !disabled);
	const selectionStart = selection ? framesToSeconds(selection.startFrame, { sampleRate }) : null;
	const selectionEnd = selection ? framesToSeconds(selection.endFrame, { sampleRate }) : null;

	useEffect(() => {
		const root = wrapperRef.current;
		if (!root) return;
		const toolbar = root.querySelector('.selection-toolbar');
		if (toolbar) {
			toolbar.setAttribute('role', 'toolbar');
			toolbar.setAttribute('aria-label', copy.selectionToolbar);
		}
		const status = root.querySelector('.selection-toolbar__status-text');
		if (status) {
			status.setAttribute('data-status', '');
			status.setAttribute('data-editor-status', '');
			status.setAttribute('data-state', statusState);
			status.setAttribute('role', 'status');
			status.setAttribute('aria-live', 'polite');
		}
		setStatusTarget(root.querySelector('.selection-toolbar__status'));
		const timecodes = [...root.querySelectorAll('.selection-toolbar__timecodes .timecode')];
		const timecodeLabels = [
			copy.selectionStart || `${copy.selection}: ${copy.clipStart}`,
			copy.selectionEnd || `${copy.selection}: ${copy.clipStart} + ${copy.clipDuration}`,
			copy.selectionDuration || copy.clipDuration,
		];
		timecodes.forEach((timecode, index) => {
			timecode.setAttribute('aria-label', timecodeLabels[index] || copy.selection);
			timecode.setAttribute('aria-disabled', String(!canEdit && index < 2));
			timecode.querySelector('.timecode__format-button')?.setAttribute(
				'aria-label',
				`${timecodeLabels[index] || copy.selection}: ${copy.format}`,
			);
		});
	}, [canEdit, copy, format, durationFormat, showSelectionToolbar, statusMessage, statusState]);

	const updateStart = (seconds) => {
		if (!canEdit) return;
		const startFrame = secondsToFrames(seconds, { maximumFrame: selection.endFrame, sampleRate });
		run(() => controller.actions.timeline.setSelection(startFrame, selection.endFrame));
	};
	const updateEnd = (seconds) => {
		if (!canEdit) return;
		const endFrame = secondsToFrames(seconds, {
			minimumFrame: selection.startFrame,
			maximumFrame: Math.max(selection.startFrame, durationFrames),
			sampleRate,
		});
		run(() => controller.actions.timeline.setSelection(selection.startFrame, endFrame));
	};
	const claimProjectLock = async () => {
		if (claimingLock) return;
		setClaimingLock(true);
		try {
			await run(() => controller.actions.project.claimLock());
		} finally {
			setClaimingLock(false);
		}
	};
	const lockNotice = snapshot.lockReadOnly ? (
		<div className="kw-audio-editor__project-lock-notice" data-project-lock-notice>
			<span>{copy.projectOpenOtherTab}</span>
			<Button variant="secondary" disabled={claimingLock} onClick={claimProjectLock}>
				{claimingLock ? copy.claimingProjectLock : copy.claimProjectLock}
			</Button>
		</div>
	) : null;
	if (!showSelectionToolbar) {
		return (
			<div
				ref={wrapperRef}
				className="kw-audio-editor__selection-surface kw-audio-editor__selection-surface--status-only"
				data-selection-toolbar
			>
				{lockNotice}
				<p data-status data-editor-status data-state={statusState} role="status" aria-live="polite">
					{showStatusbar ? statusMessage : ''}
				</p>
				{showStatusbar && <EditorTaskProgressBar controller={controller} snapshot={snapshot} statusMessage={statusMessage} />}
			</div>
		);
	}

	return (
		<div
			ref={wrapperRef}
			className="kw-audio-editor__selection-surface"
			data-selection-toolbar
			aria-disabled={disabled && !snapshot.lockReadOnly ? 'true' : 'false'}
		>
			{lockNotice}
			<SelectionToolbar
				selectionStart={selectionStart}
				selectionEnd={selectionEnd}
				status={showStatusbar ? statusMessage : ''}
				instructionText={copy.timelineHint}
				format={format}
				durationFormat={durationFormat}
				sampleRate={sampleRate}
				onFormatChange={setFormat}
				onDurationFormatChange={setDurationFormat}
				onSelectionStartChange={updateStart}
				onSelectionEndChange={updateEnd}
				showDuration
			/>
			{showStatusbar && statusTarget && createPortal(
				<EditorTaskProgressBar controller={controller} snapshot={snapshot} statusMessage={statusMessage} />,
				statusTarget,
			)}
		</div>
	);
}
