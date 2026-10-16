import { lazy, Suspense, useCallback, useRef, useState } from 'react';

import { isSoundscaperProductionProject } from '../../project-schema-version.ts';
import { Flyout } from '@soundscaper/design-system/Flyout';
import { Icon } from '@soundscaper/design-system/Icon';
import { ToggleToolButton } from '@soundscaper/design-system/ToggleToolButton';
import { Toolbar, ToolbarButtonGroup, ToolbarDivider } from '@soundscaper/design-system/Toolbar';
import { ToolButton } from '@soundscaper/design-system/ToolButton';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import { productProfile } from '../../../products.js';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import { collectCustomToolbarButtonActions } from './custom-toolbar-button-actions.ts';
import { createCustomToolbarContextMenus, CUSTOM_TOOLBAR_AUDIO_CONTEXT_ACTION_IDS } from './custom-toolbar-context-actions.ts';
import { CustomToolbarButtonGroup, CustomToolbarButtonSettings } from './CustomToolbarButtons.tsx';
import { FRAMESCAPER_INPUTS_COPY } from '../../../i18n/editor-framescaper-inputs-copy.ts';
import {
	PlaybackMeterToolbarGroup,
	RecordingMeterToolbarGroup,
} from './AudioEditorMeterControls.jsx';
import TelemetryTimeCode from './TelemetryTimeCode.tsx';
import { MusicalTimelineControls } from './MusicalTimelineControls.jsx';
import SnapToolbarControl from './SnapToolbarControl.jsx';
import ToolbarDockingMenu from '../workspace/ToolbarDockingMenu.tsx';
import SpectrogramToolControl from './SpectrogramToolControl.jsx';
import {
	framescaperCaptureRecordRequired,
	useFramescaperCaptureRecordVisibility,
} from './FramescaperCaptureRecordControl.tsx';
import TransportToolbarGroup, { TRANSPORT_BUTTON_IDS, transportToolbarButtonsVisible } from './TransportToolbarGroup.jsx';
import { WORKSPACE_TOOLBAR_IDS } from '../workspace/workspace-panel-model.ts';
import {
	handleEditorToolbarBlur,
	handleEditorToolbarFocus,
	handleEditorToolbarKeyDown,
} from '../workspace-shortcuts.ts';

const CustomToolbarButtonDialog = lazy(() => import('../dialogs/CustomToolbarButtonDialog.tsx'));

export default function EditorToolToolbar({
	capabilities,
	productId,
	controller,
	snapshot,
	copy,
	locale,
	isCompact,
	zoomProject,
	blocked,
	durationFrames,
	editItems,
	executeEdit,
	recordLabel,
	recordingTargetLocked = false,
	toggleRecording,
	run,
	toolbars,
	toolbarButtons,
	transportButtons = TRANSPORT_BUTTON_IDS,
	uiFlags,
	playbackMeterSettings,
	onPlaybackMeterSettingsChange,
	recordingMeterSettings,
	onRecordingMeterSettingsChange,
	automationToolEnabled,
	onToggleAutomationTool,
	onToggleSplitTool,
	splitToolMomentary = false,
	actionRuntime,
	menus = [],
	onOpenSpectralSelection,
	onOpenTimedRecording,
	onOpenTakeCycleRecovery,
	onJumpToStart,
	onJumpToEnd,
	onGripperMouseDown,
	toolbarDock = 'top',
	onToolbarDock = undefined,
}) {
	const project = snapshot.project;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type === 'audio');
	const outputAutomationAvailable = !isSoundscaperProductionProject(project) && Boolean(
		project?.mixer?.groups?.length
		|| project?.mixer?.sends?.length
		|| snapshot.preferences?.view?.showMasterTrack,
	);
	const toolbarSettingsTriggerRef = useRef(null);
	const [toolbarSettingsPosition, setToolbarSettingsPosition] = useState(null);
	const [customButtonDraft, setCustomButtonDraft] = useState(undefined);
	const setToolbarSettingsTrigger = useCallback((element) => {
		toolbarSettingsTriggerRef.current = element?.querySelector('button') || null;
	}, []);
	const isToolbarButtonVisible = (buttonId) => toolbarButtons?.[buttonId] !== false;
	const visibleEditItems = editItems.filter((item) => isToolbarButtonVisible(item.action));
	const customButtons = snapshot.preferences?.workspace?.customButtons ?? [];
	const visibleCustomButtons = customButtons.filter((button) => isToolbarButtonVisible(button.id));
	const customActions = customButtons.length > 0 || customButtonDraft !== undefined ? collectCustomToolbarButtonActions([
		...createCustomToolbarContextMenus({ controller, snapshot, copy, capabilities, productId, blocked }),
		...menus,
	], {
		actionRuntime, copy, locale, disabledActionIds: [
			...productProfile(productId).shortcuts.disabledCommandIds,
			...(capabilities.audioEffects === false ? CUSTOM_TOOLBAR_AUDIO_CONTEXT_ACTION_IDS : []),
		],
	}) : [];
	const customizeButton = (button) => {
		setToolbarSettingsPosition(null);
		setCustomButtonDraft(button);
	};
	const persistCustomButtons = (buttons) => runAwaitedAudioEditorOperation(run, () => controller.actions.preferences.update({ workspace: { customButtons: buttons } }));
	const showMusicalTiming = snapshot.preferences?.workspace?.activeId === 'music';
	const framescaperCaptureRecordVisible = useFramescaperCaptureRecordVisibility(snapshot);
	const transportButtonsVisible = transportToolbarButtonsVisible(transportButtons, {
		capabilities,
		captureRecordRequired: framescaperCaptureRecordRequired(snapshot.capture),
		framescaperCaptureRecordVisible,
		isToolbarButtonVisible,
	});
	const viewButtonsVisible = ['split-tool', 'volume-automation', 'spectrogram-view'].some(isToolbarButtonVisible);
	const zoomButtonsVisible = ['zoom-in', 'zoom-out', 'zoom-fit'].some(isToolbarButtonVisible);
	const toolbarButtonOptions = [
		{ id: 'play', label: copy.play, icon: 'play' },
		{ id: 'stop', label: copy.stop, icon: 'stop' },
		...(capabilities.audioRecording || framescaperCaptureRecordVisible ? [{ id: 'record', label: capabilities.audioRecording ? recordLabel : copy['ui.framescaperInputs.record'] ?? FRAMESCAPER_INPUTS_COPY.record, icon: 'record' }] : []),
		{ id: 'jump-start', label: copy.jumpStart, icon: 'skip-back' },
		{ id: 'jump-end', label: copy.jumpEnd, icon: 'skip-forward' },
		{ id: 'loop', label: copy.loop, icon: 'loop' },
		{ id: 'metronome', label: copy.metronome, icon: 'metronome' },
		{ id: 'volume-automation', label: copy.clipGain, icon: 'automation' },
		{ id: 'split-tool', label: copy.splitTool, icon: 'split' },
		// Multi-view, the spectral box select and the spectral brush are not
		// offered here: they are the spectrogram button's own options, and a
		// toolbar without that button has nowhere to put them.
		...(capabilities.audioSpectralEditing ? [
			{ id: 'spectrogram-view', label: copy.spectrogramView, icon: 'spectrogram' },
		] : []),
		{ id: 'zoom-in', label: copy.zoomIn, icon: 'zoom-in' },
		{ id: 'zoom-out', label: copy.zoomOut, icon: 'zoom-out' },
		{ id: 'zoom-fit', label: copy.zoomFit, icon: 'zoom-to-fit' },
		...editItems.map((item) => ({ id: item.action, label: item.label, icon: item.icon })),
		{ id: 'time-display', label: copy.timecode, icon: iconNameToChar('CLOCK') },
		{ id: 'snap', label: copy.snap, icon: iconNameToChar('MAGNET') },
		...(capabilities.audioRecording ? [{ id: 'monitor', label: copy.recordLevel, icon: iconNameToChar('MICROPHONE') }] : []),
		{ id: 'playback-volume', label: copy.playbackVolume, icon: iconNameToChar('AUDIO') },
		{ id: 'workspace-switcher', label: copy.workspace, icon: iconNameToChar('WORKSPACE') },
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
				<TransportToolbarGroup
					buttons={transportButtons}
					blocked={blocked}
					capabilities={capabilities}
					controller={controller}
					copy={copy}
					locale={locale}
					onJumpToEnd={onJumpToEnd}
					onJumpToStart={onJumpToStart}
					onOpenTakeCycleRecovery={onOpenTakeCycleRecovery}
					onOpenTimedRecording={onOpenTimedRecording}
					recordLabel={recordLabel}
					recordingTargetLocked={recordingTargetLocked}
					run={run}
					snapshot={snapshot}
					toggleRecording={toggleRecording}
					toolbarButtons={toolbarButtons}
				/>
				</WorkspaceToolbarSection>,

				<WorkspaceToolbarSection key="tools" {...toolbarSectionProps('tools')}>
				{viewButtonsVisible && <ToolbarDivider />}
				{viewButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__view-actions" gap={2}>
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
					{isToolbarButtonVisible('split-tool') && <span data-action-id="split-tool">
						<ToggleToolButton
							icon="split"
							isActive={uiFlags.splitTool || splitToolMomentary}
							ariaLabel={copy.splitTool}
							onClick={onToggleSplitTool}
						/>
					</span>
					}
					{capabilities.audioSpectralEditing && isToolbarButtonVisible('spectrogram-view') && <SpectrogramToolControl
						actionRuntime={actionRuntime}
						blocked={blocked}
						controller={controller}
						copy={copy}
						onOpenSpectralSelection={onOpenSpectralSelection}
						run={run}
						snapshot={snapshot}
						uiFlags={uiFlags}
					/>}
				</ToolbarButtonGroup>
				}

				{zoomButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__zoom-actions" gap={2}>
					{isToolbarButtonVisible('zoom-in') && <ToolButton icon="zoom-in" ariaLabel={copy.zoomIn} onClick={() => zoomProject('in', 'playhead')} />}
					{isToolbarButtonVisible('zoom-out') && <ToolButton icon="zoom-out" ariaLabel={copy.zoomOut} onClick={() => zoomProject('out', 'playhead')} />}
					{isToolbarButtonVisible('zoom-fit') && <ToolButton icon="zoom-to-fit" ariaLabel={copy.zoomFit} onClick={() => run(() => controller.actions.timeline.zoomFit())} />}
				</ToolbarButtonGroup>
				}
				</WorkspaceToolbarSection>,

				(visibleEditItems.length > 0 || visibleCustomButtons.length > 0) && <WorkspaceToolbarSection key="edit" {...toolbarSectionProps('edit')}>
				<ToolbarButtonGroup className="kw-audio-editor__edit-actions" gap={2}>
					{visibleEditItems.map((item) => (
						<span key={item.action} data-edit={item.action === 'rippleDelete' ? 'ripple-delete' : item.action}>
							<ToolButton icon={item.icon} ariaLabel={item.label} disabled={item.disabled} onClick={() => executeEdit(item.action)} />
						</span>
					))}
				</ToolbarButtonGroup>
				<CustomToolbarButtonGroup buttons={visibleCustomButtons} actions={customActions} copy={copy} run={run} />
				</WorkspaceToolbarSection>,

				<WorkspaceToolbarSection key="meter" {...toolbarSectionProps('meter')}>
				{isToolbarButtonVisible('time-display') && !snapshot.preferences?.workspace?.panels?.clock?.visible && <TelemetryTimeCode
					controller={controller}
					copy={copy}
					project={project}
					durationFrames={durationFrames}
					isCompact={isCompact}
					preferredFormat={snapshot.preferences?.workspace?.timeDisplayFormat}
					onFormatChange={(format) => run(() => controller.actions.preferences.update({ workspace: { timeDisplayFormat: format } }))}
					onUndock={() => run(() => controller.actions.preferences.update({ workspace: { panels: { clock: { ...snapshot.preferences?.workspace?.panels?.clock, visible: true, dock: 'floating' } } } }))}
					sequenceTiming={productId === 'framescaper'}
					recording={snapshot.recording}
					run={run}
				/>}
				{showMusicalTiming && <MusicalTimelineControls
					project={project}
					snapshot={snapshot}
					controller={controller}
					copy={copy}
					run={run}
				/>}
				{isToolbarButtonVisible('snap') && <SnapToolbarControl
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					run={run}
				/>}

				{capabilities.audioRecording && isToolbarButtonVisible('monitor')
					&& recordingMeterSettings.position !== 'panel' && <RecordingMeterToolbarGroup
					copy={copy}
					snapshot={snapshot}
					controller={controller}
					run={run}
					settings={snapshot.preferences?.workspace?.panels?.['recording-meter']?.visible ? { ...recordingMeterSettings, position: 'panel' } : recordingMeterSettings}
					onSettingsChange={onRecordingMeterSettingsChange}
				/>}

				{isToolbarButtonVisible('playback-volume')
					&& playbackMeterSettings.position !== 'panel'
					&& <PlaybackMeterToolbarGroup
						controller={controller}
						copy={copy}
						snapshot={snapshot}
						settings={snapshot.preferences?.workspace?.panels?.['playback-meter']?.visible ? { ...playbackMeterSettings, position: 'panel' } : playbackMeterSettings}
						onSettingsChange={onPlaybackMeterSettingsChange}
						clippingEnabled={uiFlags.clipping}
						isCompact={isCompact}
						run={run}
					/>}
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
					{onToolbarDock && <ToolbarDockingMenu copy={copy} dock={toolbarDock} onDock={onToolbarDock} onClose={() => setToolbarSettingsPosition(null)} />}
					<strong>{copy.toolbarButtons}</strong>
					<div className="kw-audio-editor__toolbar-settings-list">
						<CustomToolbarButtonSettings buttons={customButtons} toolbarButtons={toolbarButtons ?? {}} copy={copy} onCustomize={customizeButton} onToggle={(id, visible) => run(() => controller.actions.preferences.setToolbarButton(id, visible))} />
						{toolbarButtonOptions.map((button) => <button
							key={button.id}
							type="button"
							role="checkbox"
							aria-checked={isToolbarButtonVisible(button.id)}
							className="kw-audio-editor__toolbar-settings-option"
							onClick={() => run(() => controller.actions.preferences.setToolbarButton(button.id, !isToolbarButtonVisible(button.id)))}
						>
							<span className="musescore-icon" aria-hidden="true">
								{iconNameToChar(isToolbarButtonVisible(button.id) ? 'EYE_OPEN' : 'EYE_CLOSED')}
							</span>
							<span className="kw-audio-editor__toolbar-settings-icon" aria-hidden="true">
								{button.icon.length === 1
									? <span className="musescore-icon">{button.icon}</span>
									: <Icon name={button.icon} size={16} />}
							</span>
							<span>{button.label}</span>
						</button>)}
					</div>
				</div>
			</Flyout>
			{customButtonDraft !== undefined && <Suspense fallback={null}>
				<CustomToolbarButtonDialog
					button={customButtonDraft}
					copy={copy}
					actions={customActions}
					onClose={() => setCustomButtonDraft(undefined)}
					onSave={(button) => persistCustomButtons(customButtons.some((candidate) => candidate.id === button.id)
						? customButtons.map((candidate) => candidate.id === button.id ? button : candidate)
						: [...customButtons, button])}
					onRemove={customButtonDraft ? () => persistCustomButtons(customButtons.filter((button) => button.id !== customButtonDraft.id)) : undefined}
				/>
			</Suspense>}
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
