import {
	ContextMenu,
	ContextMenuItem,
	Menu,
	RulerFlyout,
	TimelineRulerContextMenu,
} from '@dilsonspickles/components';

import { AUDACITY_CLIP_CONTEXT_ACTION_IDS } from '../../audacity-context-menu.js';
import { AUDIO_EDITOR_TRACK_COLORS } from '../../project-v2.js';
import {
	MAXIMUM_WAVEFORM_VERTICAL_ZOOM,
	normalizeSpectrogramScale,
	normalizeWaveformRulerFormat,
} from './geometry.ts';
import {
	colorName,
	ManifestContextMenuItem,
	resolveAudioEditorColor,
	TimelineOverlayPortal,
} from './TimelineOverlayComponents.jsx';
import { TrackColorPicker } from './TimelineFlyouts.jsx';
import { viewportMenuPlacement } from './interaction-helpers.js';

export function TimelineMenus({
	controller,
	snapshot,
	copy,
	geometry,
	preview,
	actions,
	menuModel,
	overlayTarget,
}) {
	const { project, sampleRate } = geometry;
	const {
		trackMenu,
		outputMenu,
		trackColorMenu,
		clipMenu,
		timelineRulerMenu,
		trackRulerFlyout,
	} = preview;
	const {
		mutationsBlocked,
		run,
		setClipMenu,
		setOutputMenu,
		setTimelineRulerMenu,
		setTrackColorMenu,
		setTrackMenu,
		setTrackRulerFlyout,
		onExportClip,
		onOpenClipProperties,
		onRevealProjectBin,
	} = actions;
	const {
		colorMenuTrack,
		menuClip,
		menuTrack,
		menuFolder,
		folderMenuItems,
		rulerFlyoutTrack,
		activeWaveformRuler,
		contextLocale,
		unavailableReason,
		updateTrackSpectrogram,
		updateWaveformRuler,
		zoomSpectrogram,
		trackMenuItems,
		outputMenuTarget,
		outputMenuItems,
	} = menuModel;
	const trackMenuPlacement = trackMenu && menuTrack
		? viewportMenuPlacement(trackMenu.anchor, trackMenuItems)
		: null;

	return (
			<TimelineOverlayPortal target={overlayTarget}>
			<TimelineRulerContextMenu
				isOpen={Boolean(timelineRulerMenu)}
				x={timelineRulerMenu?.x || 0}
				y={timelineRulerMenu?.y || 0}
				autoFocus={Boolean(timelineRulerMenu?.autoFocus)}
				onClose={() => setTimelineRulerMenu(null)}
				timeFormat={project.timeDisplay?.format === 'beats+measures' ? 'beats-measures' : 'minutes-seconds'}
				onTimeFormatChange={(format) => run(() => controller.actions.project.setTimeDisplay(
					format === 'beats-measures' ? 'beats+measures' : 'hh:mm:ss+milliseconds',
				))}
				updateDisplayWhilePlaying={snapshot.timeline?.updateDisplayWhilePlaying !== false}
				onToggleUpdateDisplay={() => run(() => controller.actions.timeline.toggleUpdateWhilePlaying())}
				pinnedPlayHead={Boolean(snapshot.timeline?.pinnedPlayhead)}
				onTogglePinnedPlayHead={() => run(() => controller.actions.timeline.togglePinnedPlayhead())}
				clickRulerToStartPlayback={snapshot.timeline?.playbackOnRulerClick !== false}
				onToggleClickRulerToStartPlayback={() => run(() => controller.actions.timeline.toggleRulerPlayback())}
				loopRegionEnabled={Boolean(project.loop?.enabled)}
				onToggleLoopRegion={() => run(() => controller.actions.transport.toggleLoop())}
				onClearLoopRegion={() => run(() => controller.actions.transport.clearLoop())}
				onSetLoopRegionToSelection={() => run(() => controller.actions.transport.loopToSelection())}
				onSetSelectionToLoop={() => run(() => controller.actions.transport.selectionToLoop())}
				creatingLoopSelectsAudio={Boolean(snapshot.loopOptions?.selectionFollows)}
				onToggleCreatingLoopSelectsAudio={() => run(() => controller.actions.transport.toggleSelectionFollowsLoop())}
				showVerticalRulers={snapshot.timeline?.showVerticalRulers !== false}
				onToggleVerticalRulers={() => run(() => controller.actions.timeline.toggleVerticalRulers())}
			/>

			<RulerFlyout
				isOpen={Boolean(trackRulerFlyout && rulerFlyoutTrack)}
				x={trackRulerFlyout?.x || 0}
				y={trackRulerFlyout?.y || 0}
				mode={trackRulerFlyout?.mode || 'waveform'}
				className="audio-editor-ruler-flyout"
				triggerRef={{ current: trackRulerFlyout?.trigger || null }}
				onClose={() => setTrackRulerFlyout(null)}
				rulerFormat={activeWaveformRuler.format}
				onRulerFormatChange={(format) => {
					if (rulerFlyoutTrack) updateWaveformRuler(rulerFlyoutTrack.id, { format: normalizeWaveformRulerFormat(format) });
				}}
				halfWave={rulerFlyoutTrack?.displayMode === 'half-wave'}
				onHalfWaveChange={(enabled) => {
					if (!rulerFlyoutTrack || mutationsBlocked) return;
					run(() => controller.actions.track.setDisplayMode(
						rulerFlyoutTrack.id,
						enabled ? 'half-wave' : 'waveform',
					));
				}}
				spectrogramScale={normalizeSpectrogramScale(rulerFlyoutTrack?.spectrogram?.scale)}
				onSpectrogramScaleChange={(scale) => updateTrackSpectrogram(rulerFlyoutTrack, {
					scale: scale === 'logarithmic' ? 'log' : scale,
				})}
				minFreq={rulerFlyoutTrack?.spectrogram?.minimumFrequency || 0}
				onMinFreqChange={(minimumFrequency) => updateTrackSpectrogram(rulerFlyoutTrack, { minimumFrequency })}
				maxFreq={rulerFlyoutTrack?.spectrogram?.maximumFrequency || Math.min(20_000, sampleRate / 2)}
				onMaxFreqChange={(maximumFrequency) => updateTrackSpectrogram(rulerFlyoutTrack, { maximumFrequency })}
				onZoomIn={() => {
					if (!rulerFlyoutTrack) return;
					if (trackRulerFlyout?.mode === 'spectrogram') zoomSpectrogram(rulerFlyoutTrack, 'in');
					else updateWaveformRuler(rulerFlyoutTrack.id, {
						zoom: Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, activeWaveformRuler.zoom + 1),
					});
				}}
				onZoomOut={() => {
					if (!rulerFlyoutTrack) return;
					if (trackRulerFlyout?.mode === 'spectrogram') zoomSpectrogram(rulerFlyoutTrack, 'out');
					else updateWaveformRuler(rulerFlyoutTrack.id, {
						zoom: Math.max(0, activeWaveformRuler.zoom - 1),
					});
				}}
				onReset={() => {
					if (!rulerFlyoutTrack) return;
					if (trackRulerFlyout?.mode === 'spectrogram') updateTrackSpectrogram(rulerFlyoutTrack, {
						minimumFrequency: 0,
						maximumFrequency: Math.min(20_000, sampleRate / 2),
					});
					else updateWaveformRuler(rulerFlyoutTrack.id, { zoom: 0 });
				}}
			/>

			<div
				className="audio-editor-track-menu-layer"
				style={trackMenuPlacement
					? { '--audio-editor-track-menu-max-height': `${trackMenuPlacement.maxHeight}px` }
					: undefined}
			>
				<Menu
					isOpen={Boolean(trackMenu && menuTrack)}
					anchorEl={trackMenuPlacement?.anchorEl || null}
					onClose={() => setTrackMenu(null)}
					className="audio-editor-track-menu"
					items={trackMenuItems}
				/>
			</div>

			<ContextMenu
				isOpen={Boolean(trackMenu?.folderId && menuFolder)}
				x={trackMenu?.anchor?.x || 0}
				y={trackMenu?.anchor?.y || 0}
				autoFocus
				onClose={() => setTrackMenu(null)}
				className="audio-editor-track-folder-menu"
			>
				{folderMenuItems.map((item, index) => item.divider ? (
					<ContextMenuItem key={`divider-${index}`} isDivider />
				) : (
					<ContextMenuItem
						key={item.label}
						label={item.label}
						disabled={item.disabled}
						onClick={item.onClick}
						onClose={() => setTrackMenu(null)}
					/>
				))}
			</ContextMenu>

			<ContextMenu
				isOpen={Boolean(outputMenu && outputMenuTarget)}
				x={outputMenu?.x || 0}
				y={outputMenu?.y || 0}
				autoFocus
				onClose={() => setOutputMenu(null)}
				className="audio-editor-output-track-menu"
			>
				{outputMenuItems.map((item, index) => item.divider ? (
					<ContextMenuItem key={`divider-${index}`} isDivider />
				) : (
					<ContextMenuItem
						key={item.label}
						label={item.label}
						disabled={item.disabled}
						onClick={item.onClick}
						onClose={() => setOutputMenu(null)}
					/>
				))}
			</ContextMenu>

			<TrackColorPicker
				isOpen={Boolean(trackColorMenu && colorMenuTrack)}
				x={trackColorMenu?.x || 0}
				y={trackColorMenu?.y || 0}
				color={resolveAudioEditorColor(colorMenuTrack?.color)}
				copy={copy}
				onChange={(color) => colorMenuTrack && run(() => controller.actions.track.update(colorMenuTrack.id, { color }))}
				onClose={() => setTrackColorMenu(null)}
			/>

			<ContextMenu
				isOpen={Boolean(clipMenu && menuClip)}
				x={clipMenu?.x || 0}
				y={clipMenu?.y || 0}
				autoFocus={Boolean(clipMenu?.autoFocus)}
				onClose={() => setClipMenu(null)}
				className="audio-editor-clip-context-menu"
			>
				<ContextMenuItem label={copy.clipColor} hasSubmenu onClose={() => setClipMenu(null)}>
					<ManifestContextMenuItem
						actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.useTrackColor}
						label={copy.followTrackColor}
						checked={menuClip?.color === 'auto'}
						disabled={mutationsBlocked || !menuClip}
						disabledReason={unavailableReason}
						locale={contextLocale}
						onClick={() => menuClip && run(() => controller.actions.clip.update(menuClip.id, { color: 'auto' }))}
					/>
					<ContextMenuItem isDivider />
					{AUDIO_EDITOR_TRACK_COLORS.map((color, colorIndex) => (
						<ManifestContextMenuItem
							key={color}
							actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.changeColor.replace('%1', colorIndex)}
							label={colorName(copy, color)}
							checked={menuClip?.color === color}
							disabled={mutationsBlocked || !menuClip}
							disabledReason={unavailableReason}
							locale={contextLocale}
							onClick={() => menuClip && run(() => controller.actions.clip.update(menuClip.id, { color }))}
						/>
					))}
				</ContextMenuItem>
				<ContextMenuItem isDivider />
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.properties}
					label={copy.clipPropertiesCommand}
					disabled={!menuClip || (menuClip.kind !== 'audio' && menuClip.kind !== 'video')}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => {
						if (!menuClip) return;
						run(() => controller.actions.timeline.selectClip(menuClip.id));
						const clipElement = document.querySelector(`[data-clip-id="${menuClip.id}"]`);
						clipElement?.focus?.({ preventScroll: true });
						onOpenClipProperties?.(menuClip.id);
					}}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem isDivider />
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.split}
					label={copy.split}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.edit.split())}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.reverse}
					label={copy.reverse}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio'}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.reverse(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.normalizePeak}
					label={copy.normalizePeak}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio'}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.normalizePeak(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.renderPitchSpeed}
					label={copy.renderPitchSpeed}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio' || (menuClip.pitchCents === 0 && menuClip.speedRatio === 1)}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.renderPitchSpeed(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.resetPitchSpeed}
					label={copy.resetPitchSpeed}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio' || (menuClip.pitchCents === 0 && menuClip.speedRatio === 1)}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.resetPitchSpeed(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.stretchToTempo}
					label={copy.stretchToTempo}
					checked={Boolean(menuClip?.stretchToTempo)}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio'}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.toggleStretchToTempo(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem isDivider />
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.export}
					label={copy.exportClip}
					disabled={!menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && onExportClip?.(menuClip.id)}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.moveToProjectBin}
					label={copy.moveToProjectBin || 'Move to Project bin'}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => {
						if (!menuClip) return;
						run(() => controller.actions.projectBin.moveFromTimeline(menuClip.id));
						onRevealProjectBin?.();
					}}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.remove}
					label={copy.deleteClip || copy.liftDelete}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.remove(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
			</ContextMenu>
			</TimelineOverlayPortal>
	);
}
