import { Button } from '@dilsonspickles/components';

import { productProfile } from '../../../products.js';
import AudioEditorButtonTooltips from '../AudioEditorButtonTooltips.jsx';
import EditorOverlayHost from '../EditorOverlayHost.tsx';
import AudioEditorMenuBar from '../AudioEditorMenuBar.jsx';
import AudioEditorTimeline from '../AudioEditorTimeline.jsx';
import { formatAup4CompatibilitySummary } from '../dialogs/editor-dialog-model.js';
import { SidePlaybackMeter, SideRecordingMeter } from '../toolbar/AudioEditorMeterControls.jsx';
import { AccessibleSelectionToolbar, EditorActionBar } from '../toolbar/AudioEditorTransportControls.jsx';
import ProjectTabs from './ProjectTabs.jsx';
import ProjectFeatureCompatibilityNotice from './ProjectFeatureCompatibilityNotice.tsx';
import StorageCapacityPanel from './StorageCapacityPanel.tsx';
import VideoEditorWorkspacePanels from './VideoEditorWorkspacePanels.jsx';
import WorkspacePanelDock from './WorkspacePanelDock.jsx';
import AudioEditorWorkspaceOverlays from './AudioEditorWorkspaceOverlays.jsx';
import { WORKSPACE_DOCK_IDS, workspaceDockLabel } from './workspace-panel-model.ts';
import { handleWorkspaceKeyboard } from '../workspace-shortcuts.ts';

const AUDIO_EDITOR_AUDIO_FILE_ACCEPT = 'audio/*,video/mp4,video/webm,.aac,.aif,.aiff,.flac,.m4a,.m4v,.mp2,.mp3,.mp4,.oga,.ogg,.opus,.rf64,.wav,.webm,.wv';
const AUDIO_EDITOR_IMPORT_FILE_ACCEPT = `${AUDIO_EDITOR_AUDIO_FILE_ACCEPT},.txt,.srt,.vtt,text/plain,text/vtt,application/x-subrip`;

export default function AudioEditorWorkspaceView({ model }) {
	const {
		aboutLabel,
		activateSearchEntry,
		applicationMenus,
		aup4Compatibility,
		aup4InputRef,
		automationToolEnabled,
		blocked,
		capabilities,
		controller,
		copy,
		displayAudioSupported,
		draggedWorkspacePanelId,
		durationFrames,
		editBlock,
		editBlocked,
		editorOverlayTarget,
		editorRef,
		editorThemeVariables,
		editorToolbar,
		effectsPanelTarget,
		executeEdit,
		fileService,
		floatingToolbarPosition,
		floatingToolbarRef,
		importInputRef,
		importRoutedFiles,
		isCompact,
		isFullscreen,
		isVideoEditorWorkspace,
		legacyAupInputRef,
		legacyDataInputRef,
		locale,
		moveWorkspacePanel,
		onError,
		openEffects,
		openTrackRate,
		openProjectFile,
		openSurface,
		parityRuntime,
		pendingLegacyProjectRef,
		playbackMeterSettings,
		preferences,
		productId,
		project,
		runtimeProject,
		projectBinEffectivelyOpen,
		recordingMeterSettings,
		revealProjectBin,
		run,
		saveText,
		searchEntries,
		setDialog,
		setDraggedWorkspacePanelId,
		setEditorOverlayTarget,
		setEffectWindow,
		setPlaybackMeterSettings,
		setRecordingMeterSettings,
		setShowArmControls,
		showArmControls,
		snapshot,
		statusMessage,
		statusState,
		timelineSearchReveal,
		toggleFullscreen,
		toggleSplitTool,
		toggleWorkspacePanel,
		toolbarButtonPreferences,
		toolbarDock,
		toolbarDragRef,
		uiFlags,
		workspaceRef,
	} = model;
	return (
		<div
			ref={editorRef}
			id="kw-audio-editor-design-system"
			style={editorThemeVariables}
			className={`kw-audio-editor ${isCompact ? 'kw-audio-editor--compact' : ''}${isFullscreen ? ' kw-audio-editor--viewport-fullscreen' : ''}`}
			data-audio-editor
			data-audio-editor-bound="true"
			data-product={productId}
			data-project-id={project?.id || ''}
			data-track-count={project?.tracks.length || 0}
			data-clip-count={project?.clips.length || 0}
			data-timeline-view={snapshot.timeline?.view || 'waveform'}
			data-editor-theme={preferences?.appearance?.theme || 'system'}
			data-clip-style={preferences?.appearance?.clipStyle || 'colorful'}
			data-workspace-preset={preferences?.workspace?.activeId || 'modern'}
			data-edit-block-reason={editBlock.reason || undefined}
			onKeyDown={(event) => handleWorkspaceKeyboard(event, snapshot, run, {
				actionRuntime: parityRuntime.actions,
				disabledActionIds: productProfile(productId).shortcuts.disabledCommandIds,
				menus: applicationMenus,
				videoNavigation: productId === 'framescaper' ? controller.actions.video.navigation : undefined,
			})}
			onContextMenu={(event) => event.preventDefault()}
		>
			<AudioEditorMenuBar
				appName={copy.title}
				copy={copy}
				locale={locale}
				menus={applicationMenus}
				projectName={project?.title || copy.untitledProject}
				searchEntries={searchEntries}
				saveState={snapshot.save?.state || 'saved'}
				saveText={saveText}
				onSearchActivate={activateSearchEntry}
				onFullscreen={() => run(toggleFullscreen)}
				projectTabs={<ProjectTabs
					projects={snapshot.projectTabs || snapshot.projects || []}
					activeProjectId={project?.id}
					copy={copy}
					disabled={blocked}
					onSelect={(projectId) => run(() => controller.actions.project.openById(projectId))}
					onNew={() => run(() => controller.actions.project.create())}
				/>}
			/>

			<input
				ref={aup4InputRef}
				className="kw-audio-editor__file-input"
				data-aup4-input
				aria-label={copy.open}
				type="file"
				tabIndex={-1}
				accept=".scape,.aup3,.aup4,application/vnd.soundscaper.scape+zip,application/x-audacity-project,application/vnd.audacity.aup4"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (file) run(() => openProjectFile(file));
				}}
			/>

			<input
				ref={legacyAupInputRef}
				className="kw-audio-editor__file-input"
				data-legacy-aup-input
				aria-label={copy.openLegacyAup}
				type="file"
				tabIndex={-1}
				accept=".aup,application/xml,text/xml"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (!file) return;
					pendingLegacyProjectRef.current = file;
					legacyDataInputRef.current?.click();
				}}
			/>

			<input
				ref={legacyDataInputRef}
				className="kw-audio-editor__file-input"
				data-legacy-data-input
				aria-label={copy.chooseLegacyData}
				type="file"
				tabIndex={-1}
				multiple
				webkitdirectory=""
				directory=""
				onChange={(event) => {
					const projectFile = pendingLegacyProjectRef.current;
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					pendingLegacyProjectRef.current = null;
					if (projectFile && files.length) run(() => controller.actions.project.importFiles([projectFile, ...files]));
				}}
			/>

			<input
				ref={importInputRef}
				className="kw-audio-editor__file-input"
				data-import-input
				aria-label={copy.importFile}
				type="file"
				tabIndex={-1}
				accept={AUDIO_EDITOR_IMPORT_FILE_ACCEPT}
				multiple
				onChange={(event) => {
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					if (files.length) run(() => importRoutedFiles(files));
				}}
			/>

			<EditorActionBar
				copy={copy}
				snapshot={snapshot}
				controller={controller}
				showAup4={productId === 'soundscaper'}
				run={run}
				editBlocked={editBlocked}
				blocked={blocked}
				executeEdit={executeEdit}
				onSaveAup4={() => run(() => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly }))}
				onExportAudio={() => openSurface('export')}
				onToggleMixer={() => run(() => controller.actions.preferences.togglePanel('mixer'))}
			/>

			{isVideoEditorWorkspace && <VideoEditorWorkspacePanels
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				locale={locale}
				fileService={fileService}
				playbackMeterSettings={playbackMeterSettings}
				run={run}
				showArmControls={showArmControls}
				displayAudioSupported={displayAudioSupported}
				onOpenEffects={openEffects}
				effectsPanelTarget={effectsPanelTarget}
				onEffectWindowChange={setEffectWindow}
				onTogglePanel={toggleWorkspacePanel}
				blocked={blocked}
			/>}

			{toolbarDock === 'top' && <div className="kw-audio-editor__toolbars" data-toolbar-dock="top">{editorToolbar}</div>}

			{snapshot.monitor?.enabled && (
				<div className="kw-audio-editor__monitor-warning" role="alert">{copy.monitorWarning}</div>
			)}
			{snapshot.storage?.ephemeral && (
				<div
					className="kw-audio-editor__storage-warning"
					data-storage-ephemeral-warning
					role="alert"
				>
					{copy.storageEphemeralWarning}
				</div>
			)}
			{uiFlags.storagePanel && (
				<StorageCapacityPanel snapshot={snapshot} locale={locale} controller={controller} run={run} />
			)}
			<ProjectFeatureCompatibilityNotice
				key={project?.id || 'no-project'}
				project={project}
				report={snapshot.featureRequirementsCompatibility}
				audioEffectPlaybackBypass={snapshot.audioEffectPlaybackBypass}
				audioRenderedFallback={snapshot.audioRenderedFallback}
				videoEffectPlaybackBypass={snapshot.videoEffectPlaybackBypass}
				videoRenderedFallback={snapshot.videoRenderedFallback}
				affectedObjects={snapshot.featureRequirementsAffectedObjects}
				copy={copy}
			/>
			{aup4Compatibility?.report && !aup4Compatibility.dismissed && (
				<aside className="kw-audio-editor__aup4-compatibility" role="status" data-aup4-compatibility-summary>
					<div>
						<strong>{copy.aup4CompatibilityReport}</strong>
						<p>{formatAup4CompatibilitySummary(aup4Compatibility.report, copy)}</p>
					</div>
					<div className="kw-audio-editor__aup4-compatibility-actions">
						<Button variant="secondary" onClick={() => setDialog('aup4-compatibility')}>
							{copy.aup4CompatibilityViewReport}
						</Button>
						<button
							type="button"
							className="kw-audio-editor__aup4-compatibility-dismiss"
							aria-label={copy.aup4CompatibilityDismiss}
							title={copy.aup4CompatibilityDismiss}
							onClick={() => controller.actions.project.dismissAup4CompatibilitySummary()}
						>×</button>
					</div>
				</aside>
			)}

			<div
				ref={workspaceRef}
				className="kw-audio-editor__workspace"
			>
				<WorkspacePanelDock
					dock="left"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					aboutLabel={aboutLabel}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				{uiFlags.tracksPanel && <div className="kw-audio-editor__workspace-main">
				<main className="kw-audio-editor__canvas">
					<AudioEditorTimeline
						controller={controller}
						snapshot={snapshot}
						runtimeProject={runtimeProject}
						locale={locale}
						copy={copy}
						mobile={isCompact}
						productId={productId}
						capabilities={capabilities}
						showArmControls={showArmControls}
						displayAudioSupported={displayAudioSupported}
						splitToolEnabled={uiFlags.splitTool}
						automationToolEnabled={automationToolEnabled}
						spectralBrushEnabled={uiFlags.spectralBrush}
						onToggleSplitTool={toggleSplitTool}
						onError={onError}
						onOpenEffects={openEffects}
						onOpenClipProperties={() => openSurface('clip')}
						onExportClip={(clipId) => {
							const clip = project?.clips.find((candidate) => candidate.id === clipId);
							if (!clip) return;
							run(() => controller.actions.timeline.selectClip(clip.id));
							run(() => controller.actions.timeline.setSelection(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames));
							openSurface('export');
						}}
						onRevealProjectBin={revealProjectBin}
						onToggleArmControls={() => setShowArmControls((current) => !current)}
						onOpenSurface={openSurface}
						onOpenTrackRate={openTrackRate}
						searchRevealRequest={timelineSearchReveal}
						overlayTarget={editorOverlayTarget}
					/>
					<p className="kw-audio-editor__keyboard-help" tabIndex={-1}>{copy.keyboardHelp}</p>
				</main>
				<WorkspacePanelDock
					dock="bottom"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				</div>}
				<WorkspacePanelDock
					dock="right"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				{toolbarButtonPreferences['playback-volume'] !== false
					&& playbackMeterSettings.position === 'side'
					&& <SidePlaybackMeter
						controller={controller}
						copy={copy}
						project={project}
						settings={playbackMeterSettings}
						onSettingsChange={setPlaybackMeterSettings}
						clippingEnabled={uiFlags.clipping}
						run={run}
					/>}
				{capabilities.audioRecording && toolbarButtonPreferences.monitor !== false
					&& recordingMeterSettings.position === 'side'
					&& <SideRecordingMeter
						controller={controller}
						copy={copy}
						snapshot={snapshot}
						settings={recordingMeterSettings}
						onSettingsChange={setRecordingMeterSettings}
						run={run}
					/>}
				<WorkspacePanelDock
					dock="floating"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				<div
					className={`kw-audio-editor__workspace-drop-targets${draggedWorkspacePanelId ? ' kw-audio-editor__workspace-drop-targets--active' : ''}`}
					data-workspace-drop-targets
					aria-hidden={draggedWorkspacePanelId ? undefined : 'true'}
				>
						{WORKSPACE_DOCK_IDS.map((dockId) => (
							<div
								key={dockId}
								className={`kw-audio-editor__workspace-drop-target kw-audio-editor__workspace-drop-target--${dockId}`}
								data-workspace-drop-target={dockId}
								onDragOver={(event) => {
									event.preventDefault();
									event.dataTransfer.dropEffect = 'move';
								}}
								onDrop={(event) => {
									if (!draggedWorkspacePanelId) return;
									event.preventDefault();
									moveWorkspacePanel(draggedWorkspacePanelId, dockId, Number.MAX_SAFE_INTEGER);
								}}
							>{workspaceDockLabel(copy, dockId)}</div>
						))}
				</div>

			</div>

			{toolbarDock === 'bottom' && <div className="kw-audio-editor__toolbars" data-toolbar-dock="bottom">{editorToolbar}</div>}
			{toolbarDock === 'floating' && <div
				ref={floatingToolbarRef}
				className="kw-audio-editor__floating-toolbar"
				data-toolbar-dock="floating"
				style={{
					left: `${toolbarDragRef.current?.dock === 'floating' ? toolbarDragRef.current.x : floatingToolbarPosition.x}px`,
					top: `${toolbarDragRef.current?.dock === 'floating' ? toolbarDragRef.current.y : floatingToolbarPosition.y}px`,
				}}
			>{editorToolbar}</div>}

			{(uiFlags.selectionToolbar || uiFlags.statusbar || snapshot.lockReadOnly) && <AccessibleSelectionToolbar
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				statusMessage={statusMessage}
				statusState={statusState}
				durationFrames={durationFrames}
				disabled={editBlocked}
				showSelectionToolbar={uiFlags.selectionToolbar}
				showStatusbar={uiFlags.statusbar}
				run={run}
			/>}

			<AudioEditorWorkspaceOverlays model={model} />
			<EditorOverlayHost ref={setEditorOverlayTarget} />
			<AudioEditorButtonTooltips rootRef={editorRef} />
		</div>
	);
}
