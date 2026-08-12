import { useCallback, useRef, useState } from 'react';
import {
	Flyout,
	Icon,
	ContextMenuItem,
	ToggleToolButton,
	Toolbar,
	ToolbarButtonGroup,
	ToolbarDivider,
	TransportButton,
	ToolButton,
} from '@dilsonspickles/components';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import { framesToSeconds, secondsToFrames } from '../../design-system-adapters.js';
import AudioEditorSplitButton from '../AudioEditorSplitButton.tsx';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { formatOptionsLabel } from '../localization-template.ts';
import {
	AudacityToolbarFlyoutButton,
	RecordingMeterToolbarGroup,
	playbackMeterSlider,
} from './AudioEditorMeterControls.jsx';
import { AudacityAudioMeter, MeterSettingsFlyout } from './AudioEditorMeters.jsx';
import {
	AccessibleTimeCode,
	AccessibleTransportButton,
	PlaySpeedFlyout,
	RecordFlyout,
} from './AudioEditorTransportControls.jsx';
import { MusicalTimelineControls } from './MusicalTimelineControls.jsx';
import { SequenceTimingControls } from './SequenceTimingControls.jsx';
import { WORKSPACE_TOOLBAR_IDS } from '../workspace/workspace-panel-model.ts';
import {
	handleEditorToolbarBlur,
	handleEditorToolbarFocus,
	handleEditorToolbarKeyDown,
} from '../workspace-shortcuts.ts';

export default function EditorToolToolbar({
	capabilities,
	controller,
	snapshot,
	copy,
	isCompact,
	zoomProject,
	blocked,
	durationFrames,
	editItems,
	executeEdit,
	recordLabel,
	toggleRecording,
	run,
	toolbars,
	toolbarButtons,
	uiFlags,
	playbackMeterSettings,
	onPlaybackMeterSettingsChange,
	recordingMeterSettings,
	onRecordingMeterSettingsChange,
	automationToolEnabled,
	onToggleAutomationTool,
	actionRuntime,
	onOpenSpectralSelection,
	onOpenRecordingOffset,
	onOpenTimedRecording,
	onOpenTakeCycleRecovery,
	onJumpToStart,
	onJumpToEnd,
	onGripperMouseDown,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const playbackMode = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.playbackMode);
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	const telemetry = { playbackMode, positionFrame, transportState };
	const project = snapshot.project;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type === 'audio');
	const outputAutomationAvailable = Boolean(
		project?.mixer?.groups?.length
		|| project?.mixer?.sends?.length
		|| snapshot.preferences?.view?.showMasterTrack,
	);
	const spectralTrackSelected = Boolean(selectedTrack && (
		selectedTrack.displayMode === 'spectrogram'
		|| selectedTrack.displayMode === 'multiview'
		|| snapshot.timeline?.view === 'spectrogram'
	));
	const recordControlLabel = snapshot.readOnly
		? `${recordLabel} — ${copy.projectReadOnly}`
		: recordLabel;
	const toolbarSettingsTriggerRef = useRef(null);
	const [toolbarSettingsPosition, setToolbarSettingsPosition] = useState(null);
	const setToolbarSettingsTrigger = useCallback((element) => {
		toolbarSettingsTriggerRef.current = element?.querySelector('button') || null;
	}, []);
	const isToolbarButtonVisible = (buttonId) => toolbarButtons?.[buttonId] !== false;
	const visibleEditItems = editItems.filter((item) => isToolbarButtonVisible(item.action));
	const showMusicalTiming = snapshot.preferences?.workspace?.activeId === 'music';
	const showSequenceTiming = Boolean(capabilities.sequenceTiming)
		&& snapshot.preferences?.workspace?.activeId === 'video-editor'
		&& Boolean(project?.sequences?.length);
	const transportButtonsVisible = ['play', 'stop', ...(capabilities.audioRecording ? ['record'] : []), 'jump-start', 'jump-end', 'loop']
		.some(isToolbarButtonVisible);
	const viewButtonsVisible = ['split-tool', 'volume-automation', 'spectrogram-view', 'spectral-box-select', 'spectral-brush']
		.some(isToolbarButtonVisible);
	const zoomButtonsVisible = ['zoom-in', 'zoom-out', 'zoom-fit'].some(isToolbarButtonVisible);
	const toolbarButtonOptions = [
		{ id: 'play', label: copy.play, icon: 'play' },
		{ id: 'stop', label: copy.stop, icon: 'stop' },
		...(capabilities.audioRecording ? [{ id: 'record', label: recordLabel, icon: 'record' }] : []),
		{ id: 'jump-start', label: copy.jumpStart, icon: 'skip-back' },
		{ id: 'jump-end', label: copy.jumpEnd, icon: 'skip-forward' },
		{ id: 'loop', label: copy.loop, icon: 'loop' },
		{ id: 'split-tool', label: copy.splitTool, icon: 'split' },
		{ id: 'volume-automation', label: copy.clipGain, icon: 'automation' },
		...(capabilities.audioSpectralEditing ? [
			{ id: 'spectrogram-view', label: copy.spectrogramView, icon: 'spectrogram' },
			{ id: 'spectral-box-select', label: copy.spectralBoxSelect, icon: 'spectrogram' },
			{ id: 'spectral-brush', label: copy.spectralBrush, icon: 'brush' },
		] : []),
		{ id: 'zoom-in', label: copy.zoomIn, icon: 'zoom-in' },
		{ id: 'zoom-out', label: copy.zoomOut, icon: 'zoom-out' },
		{ id: 'zoom-fit', label: copy.zoomFit, icon: 'zoom-to-fit' },
		...editItems.map((item) => ({ id: item.action, label: item.label, icon: item.icon })),
		{ id: 'time-display', label: copy.playhead, icon: 'playhead' },
		...(capabilities.audioRecording ? [{ id: 'monitor', label: copy.recordLevel, icon: iconNameToChar('MICROPHONE') }] : []),
		{ id: 'playback-volume', label: copy.playbackVolume, icon: iconNameToChar('AUDIO') },
	];
	const openToolbarSettings = () => {
		const rect = toolbarSettingsTriggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setToolbarSettingsPosition({ x: rect.left + rect.width / 2, y: rect.bottom });
	};
	const toolbarSectionProps = (toolbarId) => ({
		toolbarId,
		order: toolbars[toolbarId]?.order ?? WORKSPACE_TOOLBAR_IDS.indexOf(toolbarId),
	});
	return (
		<div
			data-editor-tool-toolbar
			onKeyDownCapture={handleEditorToolbarKeyDown}
			onFocusCapture={handleEditorToolbarFocus}
			onBlurCapture={handleEditorToolbarBlur}
		>
			<Toolbar
				height={48}
				className="kw-audio-editor__tool-toolbar"
				enableTabGroup
				tabGroupId="tool-toolbar"
				showGripper
				onGripperMouseDown={onGripperMouseDown}
				rightContent={(
					<ToolbarButtonGroup className="kw-audio-editor__toolbar-settings-trigger" gap={2}>
						<span ref={setToolbarSettingsTrigger}>
							<ToolButton icon="cog" ariaLabel={copy.toolbarCustomize} onClick={openToolbarSettings} />
						</span>
					</ToolbarButtonGroup>
				)}
			>
				{[
				transportButtonsVisible && <WorkspaceToolbarSection key="transport" {...toolbarSectionProps('transport')}>
				<ToolbarButtonGroup className="kw-audio-editor__transport" gap={2}>
					{isToolbarButtonVisible('play') && <AudioEditorSplitButton
						icon={telemetry.transportState === 'playing' ? 'pause' : 'play'}
						className="kw-audio-editor__transport-play kw-audio-editor__transport-play-split"
						ariaLabel={telemetry.transportState === 'playing' ? copy.pause : copy.play}
						optionsAriaLabel={formatOptionsLabel(copy, telemetry.transportState === 'playing' ? copy.pause : copy.play)}
						disabled={blocked && !snapshot.recording}
						active={telemetry.transportState === 'playing'}
						pressed={telemetry.transportState === 'playing'}
						onClick={() => run(() => controller.actions.transport.playPause())}
					>
						{({ close }) => <PlaySpeedFlyout copy={copy} snapshot={snapshot} telemetry={telemetry} blocked={blocked} controller={controller} run={run} close={close} />}
					</AudioEditorSplitButton>}
					{isToolbarButtonVisible('stop') && <TransportButton icon="stop" ariaLabel={copy.stop} onClick={() => run(() => controller.actions.transport.stop())} />}
					{capabilities.audioRecording && isToolbarButtonVisible('record') && <span data-transport="record">
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
					{isToolbarButtonVisible('jump-start') && <TransportButton icon="skip-back" ariaLabel={copy.jumpStart} disabled={blocked} onClick={onJumpToStart} />}
					{isToolbarButtonVisible('jump-end') && <TransportButton icon="skip-forward" ariaLabel={copy.jumpEnd} disabled={blocked} onClick={onJumpToEnd} />}
					{isToolbarButtonVisible('loop') && <AccessibleTransportButton
						icon="loop"
						ariaLabel={copy.loop}
						active={Boolean(project?.loop?.enabled)}
						pressed={Boolean(project?.loop?.enabled)}
						disabled={blocked}
						onClick={() => run(() => controller.actions.transport.toggleLoop())}
					/>
					}
				</ToolbarButtonGroup>
				</WorkspaceToolbarSection>,

				<WorkspaceToolbarSection key="tools" {...toolbarSectionProps('tools')}>
				{viewButtonsVisible && <ToolbarDivider />}
				{viewButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__view-actions" gap={2}>
					{isToolbarButtonVisible('split-tool') && <span data-action-id="split-tool">
						<ToggleToolButton
							icon="split"
							isActive={uiFlags.splitTool}
							ariaLabel={copy.splitTool}
							onClick={() => {
								if (automationToolEnabled) onToggleAutomationTool();
								actionRuntime.tools.toggleSplitTool();
							}}
						/>
					</span>
					}
					{isToolbarButtonVisible('volume-automation') && <span data-action-id="volume-automation">
						<ToggleToolButton
							icon="automation"
							isActive={automationToolEnabled}
							ariaLabel={copy.clipGain}
							disabled={(!selectedTrack && !outputAutomationAvailable) || blocked}
							onClick={onToggleAutomationTool}
						/>
					</span>
					}
					{capabilities.audioSpectralEditing && isToolbarButtonVisible('spectrogram-view') && <AudioEditorSplitButton
						icon="spectrogram"
						toggle
						pressed={snapshot.timeline?.view === 'spectrogram'}
						ariaLabel={copy.spectrogramView}
						optionsAriaLabel={formatOptionsLabel(copy, copy.spectrogramView)}
						onClick={() => run(() => controller.actions.timeline.setAllTracksView(snapshot.timeline?.view === 'spectrogram' ? 'waveform' : 'spectrogram'))}
					>
						{({ close }) => <div className="kw-audio-editor__split-button-options kw-audio-editor__spectrogram-tool-options">
							{isToolbarButtonVisible('spectral-box-select') && <span data-action-id="spectral-box-select">
								<ContextMenuItem
									label={copy.spectralBoxSelect}
									disabled={!spectralTrackSelected}
									onClick={() => {
										close();
										onOpenSpectralSelection();
									}}
								/>
							</span>}
							{isToolbarButtonVisible('spectral-brush') && <span data-action-id="spectral-brush">
								<ContextMenuItem
									label={copy.spectralBrush}
									checked={uiFlags.spectralBrush}
									disabled={!spectralTrackSelected || blocked}
									onClick={() => {
										close();
										actionRuntime.tools.toggleSpectralBrush();
									}}
								/>
							</span>}
						</div>}
					</AudioEditorSplitButton>}
				</ToolbarButtonGroup>
				}

				{zoomButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__zoom-actions" gap={2}>
					{isToolbarButtonVisible('zoom-in') && <ToolButton icon="zoom-in" ariaLabel={copy.zoomIn} onClick={() => zoomProject('in', 'playhead')} />}
					{isToolbarButtonVisible('zoom-out') && <ToolButton icon="zoom-out" ariaLabel={copy.zoomOut} onClick={() => zoomProject('out', 'playhead')} />}
					{isToolbarButtonVisible('zoom-fit') && <ToolButton icon="zoom-to-fit" ariaLabel={copy.zoomFit} onClick={() => run(() => controller.actions.timeline.zoomFit())} />}
				</ToolbarButtonGroup>
				}
				</WorkspaceToolbarSection>,

				visibleEditItems.length > 0 && <WorkspaceToolbarSection key="edit" {...toolbarSectionProps('edit')}>
				<ToolbarButtonGroup className="kw-audio-editor__edit-actions" gap={2}>
					{visibleEditItems.map((item) => (
						<span key={item.action} data-edit={item.action === 'rippleDelete' ? 'ripple-delete' : item.action}>
							<ToolButton icon={item.icon} ariaLabel={item.label} disabled={item.disabled} onClick={() => executeEdit(item.action)} />
						</span>
					))}
				</ToolbarButtonGroup>
				</WorkspaceToolbarSection>,

				<WorkspaceToolbarSection key="meter" {...toolbarSectionProps('meter')}>
				{isToolbarButtonVisible('time-display') && <div className="kw-audio-editor__timecode" data-time-display>
					<AccessibleTimeCode
						ariaLabel={`${copy.playhead}: ${copy.format}`}
						value={framesToSeconds(telemetry.positionFrame || 0, { sampleRate: project?.sampleRate })}
						sampleRate={project?.sampleRate || 48_000}
						showFormatSelector={!isCompact}
						disabled={snapshot.recording}
						onChange={(seconds) => run(() => controller.actions.transport.seek(secondsToFrames(seconds, { maximumFrame: durationFrames, sampleRate: project?.sampleRate })))}
					/>
				</div>}
				{showMusicalTiming && <MusicalTimelineControls
					project={project}
					snapshot={snapshot}
					controller={controller}
					copy={copy}
					run={run}
				/>}
				{showSequenceTiming && <SequenceTimingControls
					project={project}
					snapshot={snapshot}
					telemetry={telemetry}
					controller={controller}
					copy={copy}
					run={run}
				/>}

				{capabilities.audioRecording && isToolbarButtonVisible('monitor') && recordingMeterSettings.position !== 'side' && <RecordingMeterToolbarGroup
					copy={copy}
					snapshot={snapshot}
					controller={controller}
					run={run}
					settings={recordingMeterSettings}
					onSettingsChange={onRecordingMeterSettingsChange}
				/>}

				{isToolbarButtonVisible('playback-volume')
					&& playbackMeterSettings.position !== 'side'
					&& <ToolbarButtonGroup className="kw-audio-editor__playback-meter" gap={6}>
					<AudacityToolbarFlyoutButton
						icon={iconNameToChar('AUDIO')}
						ariaLabel={copy.playbackMeterSettings}
						flyoutClassName="kw-audio-editor__playback-meter-flyout"
					>
						<MeterSettingsFlyout
							copy={copy}
							settings={playbackMeterSettings}
							onChange={onPlaybackMeterSettingsChange}
						/>
					</AudacityToolbarFlyoutButton>
					{playbackMeterSettings.position === 'top' && <AudacityAudioMeter
						copy={copy}
						meter={masterMeter}
						settings={playbackMeterSettings}
						orientation="horizontal"
						clipped={uiFlags.clipping && (masterMeter?.peak || 0) >= 1}
						slider={playbackMeterSlider(
							copy,
							Math.min(1, project?.master?.gain ?? 1),
							playbackMeterSettings,
							(gain) => run(() => controller.actions.effects.setMasterGain(gain)),
						)}
						compact={isCompact}
					/>}
				</ToolbarButtonGroup>}
				</WorkspaceToolbarSection>,
				].filter(Boolean).sort((left, right) => left.props.order - right.props.order)}
			</Toolbar>
			<Flyout
				isOpen={Boolean(toolbarSettingsPosition)}
				onClose={() => setToolbarSettingsPosition(null)}
				x={toolbarSettingsPosition?.x || 0}
				y={toolbarSettingsPosition?.y || 0}
				direction="down"
				triggerRef={toolbarSettingsTriggerRef}
				ariaLabel={copy.toolbarCustomize}
				role="dialog"
				className="kw-audio-editor__toolbar-settings"
			>
				<div className="kw-audio-editor__toolbar-settings-content">
					<strong>{copy.toolbarButtons}</strong>
					<div className="kw-audio-editor__toolbar-settings-list">
						{toolbarButtonOptions.map((button) => <div key={button.id} className="kw-audio-editor__toolbar-settings-option">
							<span aria-hidden="true">
								{button.icon.length === 1
									? <span className="musescore-icon">{button.icon}</span>
									: <Icon name={button.icon} size={16} />}
							</span>
							<PreferenceCheckbox
								label={button.label}
								checked={isToolbarButtonVisible(button.id)}
								onChange={(visible) => run(() => controller.actions.preferences.setToolbarButton(button.id, visible))}
							/>
						</div>)}
					</div>
				</div>
			</Flyout>
		</div>
	);
}

function WorkspaceToolbarSection({
	toolbarId,
	children,
}) {
	return (
		<div
			className="kw-audio-editor__workspace-toolbar"
			data-workspace-toolbar={toolbarId}
		>
			{children}
		</div>
	);
}
