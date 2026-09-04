import { useCallback, useMemo, useRef } from 'react';

import { isSoundscaperProductionProject } from '../../project-schema-version.ts';
import AudioEditorSampleTools from '../AudioEditorSampleTools.jsx';
import { TRACK_HEADER_DRAWER_HANDLE_WIDTH } from './constants.ts';
import { DEFAULT_TRACK_HEIGHT as TRACK_HEIGHT } from './geometry.ts';
import { TrackListView } from './TrackListView.jsx';
import { TimelineRulerCanvas } from './TimelineRulerCanvas.jsx';
import { TimelineRulerCornerContent } from './TimelineRulerCornerContent.jsx';
import { TrackHeaderDrawerToggle } from './TrackHeaderDrawerToggle.jsx';
import { TimelineAnnotationLayer } from './TimelineAnnotationLayer.jsx';
import { TimelineAnnotationLaneActions } from './TimelineAnnotationLaneActions.jsx';
import {
	focusCreatedTimelineAnnotation,
	useTimelineAnnotationCreateFeedback,
} from './useTimelineAnnotationCreateFeedback.js';
import { timelineAnnotationCreateKind } from './timeline-annotation-ui-model.ts';
import { resolveTimelineRulerScale } from './timeline-grid-model.ts';
import { timelineSelectedTrackIds } from './track-selection-scope.ts';
import { TimelineGridLines } from './TimelineGridLines.jsx';
import { OutputTrackDock } from './OutputTrackRows.jsx';
import {
	RulerPlayhead,
	SplitToolGuideline,
	TelemetryPlayhead,
	TimelineRateStretchPreviewGuide,
	TimelineSlipSlidePreviewGuides,
	TimelineTrimPreviewGuide,
} from './TimelineOverlayComponents.jsx';
import { TimelinePlaybackProjection } from './TimelinePlaybackProjection.tsx';
import { ContainerAddTrackFlyout } from './TimelineFlyouts.jsx';
import { TimelineMenus } from './TimelineMenus.jsx';

export function TimelineWorkspaceView({
	controller,
	snapshot,
	copy,
	locale,
	mobile,
	trackHeaderDrawer = null,
	showArmControls,
	displayAudioSupported,
	automationToolEnabled,
	automationRuntime,
	automationControls,
	geometry,
	selection,
	preview,
	navigation,
	actions,
	menuModel,
	overlayTarget,
}) {
	const {
		project,
		isFlatNavigation,
		timelineRulerTabIndex,
		trackBaseTabIndex,
		addTrackTabIndex,
		panelWidth,
		trackHeaderWidth,
		showMasterTrack,
		outputTracks,
		outputDockHeight,
		verticalRulerWidth,
		viewportWidth,
		pixelsPerSecond,
		sampleRate,
		recordingPreviews,
		durationFrames,
		durationSeconds,
		timelineWidth,
		scrollSpace,
		contentScrollX,
		renderOriginX,
		renderScrollX,
		renderViewportStartFrame,
		viewportDurationFrames,
		projectIndex,
		visualTrackHeight,
		totalTrackHeight,
		showTimelineAnnotations,
		showMarkers,
		markerLaneVisible,
		rulerRowHeight,
		scrollViewportHeight,
	} = geometry;
	const { documentSelection, timeSelection, selectedClipIdSet } = selection;
	const {
		addTrackFlyout,
		draggingClipIds,
		clipDragPreview,
		projectBinDragPreview,
		loopPreview,
		splitToolGuideline,
		focusedOutputKey,
		waveformCacheRef,
		waveformRulerState,
		scrollX,
	} = preview;
	const {
		scrollRef,
		timelineScrollRef,
		addTrackTriggerRef,
		setTimelineNode,
		handleTimelineScroll,
		focusTimelineRuler,
		focusTrackContainer,
		focusTrackPanelControl,
		focusTrackClip,
		focusTrackRuler,
		focusSelectionToolbar,
		onPointerDown,
		onTrackHeaderDrawerKeyDown,
		onPointerMove,
		clearSplitToolGuideline,
		finishPointerSession,
		finishTouch,
		onTimelineDragOver,
		onTimelineDragLeave,
		onTimelineDrop,
		spectralBrushEnabled,
	} = navigation;
	const {
		editBlock,
		mutationsBlocked,
		splitToolActive,
		showAutomationOverlay,
		run,
		openAddTrackFlyout,
		addTrackFromFlyout,
		toggleMasterTrack,
		toggleMarkers,
		closeAddTrackFlyout,
		openClipMenu,
		openTimelineRulerMenu,
		openTrackRulerFlyout,
		onClipContextMenu,
		setTrackMenu,
		setOutputMenu,
		setFocusedOutputKey,
		onOpenEffects,
	} = actions;
	const { displayedLoop } = menuModel;
	// One resolved scale feeds the ruler canvas and the grid lines behind the
	// tracks, so a tick and its line can never come from different models.
	const rulerScale = useMemo(() => resolveTimelineRulerScale(project), [project]);
	const timelinePanelRef = useRef(null);
	const setTimelinePanelNode = useCallback((node) => {
		timelinePanelRef.current = node;
		setTimelineNode(node);
	}, [setTimelineNode]);
	const setTimelineScrollNode = useCallback((node) => {
		scrollRef.current = node;
		timelineScrollRef(node);
	}, [scrollRef, timelineScrollRef]);
	const focusCreatedInLayer = useCallback((annotationId) => (
		focusCreatedTimelineAnnotation(timelinePanelRef.current, annotationId, 'layer')
	), []);
	const { createAnnotation, status: annotationCreateStatus } = useTimelineAnnotationCreateFeedback({
		controller, copy, locale, sampleRate, run,
	});

	// Only selected tracks shade their selected range, so the highlight names
	// the tracks the next edit would act on rather than the whole timeline.
	const selectedTrackIds = useMemo(
		() => timelineSelectedTrackIds(project?.selection, snapshot.selectedTrackId),
		[project?.selection, snapshot.selectedTrackId],
	);

	// In the compact layout the sticky ruler corner is the track-header drawer's
	// handle: only the toggle while closed, the usual corner content while open.
	const cornerWidth = trackHeaderDrawer
		? (trackHeaderDrawer.isOpen ? trackHeaderWidth : TRACK_HEADER_DRAWER_HANDLE_WIDTH)
		: panelWidth;

	return (
		<section
			className="audio-editor-timeline-panel"
			aria-label={copy.timeline}
			ref={setTimelinePanelNode}
			data-has-output-tracks={outputTracks.length ? 'true' : 'false'}
			data-output-track-count={outputTracks.length}
			data-sample-pencil={snapshot.sampleEdit?.mode === 'pencil' ? 'true' : 'false'}
			data-split-tool={splitToolActive ? 'true' : 'false'}
			data-automation-tool={automationToolEnabled ? 'true' : 'false'}
			data-has-annotations={showTimelineAnnotations ? 'true' : 'false'}
			data-show-markers={markerLaneVisible ? 'true' : 'false'}
			data-render-scroll-x={renderScrollX}
			data-edit-block-reason={editBlock.reason || undefined}
			data-track-header-drawer={trackHeaderDrawer ? (trackHeaderDrawer.isOpen ? 'open' : 'closed') : undefined}
			style={{
				'--track-panel-width': `${panelWidth}px`,
				'--track-header-width': `${trackHeaderWidth}px`,
				'--timeline-viewport-width': `${viewportWidth}px`,
				'--timeline-scroll-x': `${scrollX}px`,
				'--timeline-render-origin-x': `${renderOriginX}px`,
				// Where the scrollport's left edge sits inside the scrolled
				// surface, so content that stands in for a sticky element can
				// follow the horizontal scroll.
				'--timeline-viewport-origin-x': `${contentScrollX + renderOriginX}px`,
				'--vertical-ruler-width': `${verticalRulerWidth}px`,
			}}
		>
			<TimelinePlaybackProjection
				controller={controller}
				rootRef={timelinePanelRef}
				scrollRef={scrollRef}
				pixelsPerSecond={pixelsPerSecond}
				sampleRate={sampleRate}
				viewportWidth={viewportWidth}
				pinned={Boolean(
					snapshot.timeline?.pinnedPlayhead
					&& snapshot.timeline?.updateDisplayWhilePlaying !== false
				)}
			/>
			<div
				className="audio-editor-timeline-scroll"
				data-timeline
				data-timeline-scroll-scale={scrollSpace.scale}
				ref={setTimelineScrollNode}
				onScroll={handleTimelineScroll}
				onPointerDownCapture={onPointerDown}
				onKeyDown={onTrackHeaderDrawerKeyDown}
				onPointerMove={onPointerMove}
				onPointerLeave={clearSplitToolGuideline}
				onPointerUp={(event) => { finishTouch(event); finishPointerSession(event); }}
				onPointerCancel={(event) => {
					finishTouch(event);
					// Firefox can cancel its id-0 mouse pointer after a valid drawn
					// segment. Publish that partial pencil stroke; true touch/pen
					// cancellations remain transactional rollbacks.
					const mouseCancellation = event.pointerType === 'mouse' || event.pointerId === 0;
					finishPointerSession(event, !mouseCancellation);
				}}
				onContextMenu={onClipContextMenu}
				onDragOver={onTimelineDragOver}
				onDragLeave={onTimelineDragLeave}
				onDrop={onTimelineDrop}
			>
				<div className="audio-editor-timeline-inner" style={{
					width: panelWidth + timelineWidth + verticalRulerWidth,
					'--audio-editor-track-sidebar-width': `${panelWidth}px`,
				}}>
					<div className="audio-editor-ruler-row">
						<div
							className="audio-editor-ruler-corner"
							data-track-header-drawer-strip={trackHeaderDrawer ? 'true' : undefined}
							data-open={trackHeaderDrawer ? (trackHeaderDrawer.isOpen ? 'true' : 'false') : undefined}
							style={{ width: cornerWidth }}
						>
							{trackHeaderDrawer && <TrackHeaderDrawerToggle copy={copy} drawer={trackHeaderDrawer} />}
							{(!trackHeaderDrawer || trackHeaderDrawer.isOpen) && <TimelineRulerCornerContent
								copy={copy}
								addTrackTriggerRef={addTrackTriggerRef}
								addTrackTabIndex={addTrackTabIndex}
								onOpenAddTrackFlyout={openAddTrackFlyout}
								annotationActions={markerLaneVisible && <TimelineAnnotationLaneActions
									controller={controller}
									project={project}
									annotations={snapshot.timelineAnnotations || []}
									copy={copy}
									blocked={mutationsBlocked}
									run={run}
									createAnnotation={createAnnotation}
									focusCreated={focusCreatedInLayer}
								/>}
							/>}
						</div>
						<div
							className="audio-editor-ruler-viewport"
							data-ruler
							data-ruler-focus
							data-ruler-interaction
							data-time-format={rulerScale.kind === 'timecode' ? 'timecode'
								: rulerScale.kind === 'minutes-seconds' ? 'minutes-seconds' : 'beats-measures'}
							data-track-lane
							data-track-id={snapshot.selectedTrackId || project.tracks[0]?.id || ''}
							role="region"
							aria-label={copy.timeline}
							tabIndex={timelineRulerTabIndex}
							style={{ left: panelWidth, width: viewportWidth }}
							onContextMenu={openTimelineRulerMenu}
							onKeyDown={(event) => {
								const createKind = markerLaneVisible && event.target === event.currentTarget
									? timelineAnnotationCreateKind(event, project.selection)
									: null;
								if (createKind) {
									event.preventDefault();
									if (!mutationsBlocked) createAnnotation(createKind, focusCreatedInLayer);
								} else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
									openTimelineRulerMenu(event);
								} else if (event.key === 'Tab' && !event.shiftKey && project.tracks.length) {
									event.preventDefault();
									focusTrackContainer(0);
								} else if (event.key === 'Escape') {
									event.currentTarget.blur();
								}
							}}
						>
							<TimelineRulerCanvas
								controller={controller}
								run={run}
								project={project}
								rulerScale={rulerScale}
								markerLaneVisible={markerLaneVisible}
								pixelsPerSecond={pixelsPerSecond}
								contentScrollX={contentScrollX}
								timelineWidth={timelineWidth}
								viewportWidth={viewportWidth}
								timeSelection={timeSelection}
								sampleRate={sampleRate}
								durationSeconds={durationSeconds}
								loopPreview={loopPreview}
								displayedLoop={displayedLoop}
							/>
							{markerLaneVisible && <TimelineAnnotationLayer
								controller={controller}
								project={project}
								annotations={snapshot.timelineAnnotations || []}
								selectedAnnotationId={snapshot.selectedAnnotationId}
								copy={copy}
								locale={locale}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								scrollX={contentScrollX}
								viewportWidth={viewportWidth}
								blocked={mutationsBlocked}
								run={run}
								createAnnotation={createAnnotation}
							/>}
							<RulerPlayhead />
						</div>
						{verticalRulerWidth > 0 && <div
							className="audio-editor-ruler-scale-corner"
							aria-hidden="true"
							style={{ left: panelWidth + viewportWidth, width: verticalRulerWidth }}
						/>}
					</div>

					<TimelineGridLines
						scale={rulerScale}
						pixelsPerSecond={pixelsPerSecond}
						scrollX={contentScrollX}
						viewportWidth={viewportWidth}
						height={Math.max(1, scrollViewportHeight - rulerRowHeight)}
						sampleRate={sampleRate}
						top={rulerRowHeight}
						left={panelWidth}
					/>

					<ContainerAddTrackFlyout
						isOpen={Boolean(addTrackFlyout)}
						x={addTrackFlyout?.x || 0}
						y={addTrackFlyout?.y || 0}
						autoFocus={Boolean(addTrackFlyout?.autoFocus)}
						triggerRef={addTrackTriggerRef}
						className="kw-audio-editor__add-track-flyout"
						copy={copy}
						mutationsBlocked={mutationsBlocked}
						showMasterTrack={showMasterTrack}
						onToggleMasterTrack={toggleMasterTrack}
						markersAvailable={showTimelineAnnotations}
						showMarkers={showMarkers}
						onToggleMarkers={toggleMarkers}
						onSelectTrackType={addTrackFromFlyout}
						onClose={closeAddTrackFlyout}
					/>

					<TrackListView
						project={project}
						controller={controller}
						projectIndex={projectIndex}
						visualTrackHeight={visualTrackHeight}
						documentSelection={documentSelection}
						timeSelection={timeSelection}
						selectedTrackIds={selectedTrackIds}
						minHeight={Math.max(0, scrollViewportHeight - rulerRowHeight)}
						snapshot={snapshot}
						selectedClipIdSet={selectedClipIdSet}
						draggingClipIds={draggingClipIds}
						clipDragPreview={clipDragPreview}
						projectBinDragPreview={projectBinDragPreview}
						mutationsBlocked={mutationsBlocked}
						locale={locale}
						copy={copy}
						run={run}
						setTrackMenu={setTrackMenu}
						openClipMenu={openClipMenu}
						openTrackRulerFlyout={openTrackRulerFlyout}
						onOpenEffects={onOpenEffects}
						focusTimelineRuler={focusTimelineRuler}
						focusTrackContainer={focusTrackContainer}
						focusTrackPanelControl={focusTrackPanelControl}
						focusTrackClip={focusTrackClip}
						focusTrackRuler={focusTrackRuler}
						focusSelectionToolbar={focusSelectionToolbar}
						isFlatNavigation={isFlatNavigation}
						trackBaseTabIndex={trackBaseTabIndex}
						panelWidth={panelWidth}
						trackHeaderWidth={trackHeaderWidth}
						timelineWidth={timelineWidth}
						verticalRulerWidth={verticalRulerWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						renderViewportStartFrame={renderViewportStartFrame}
						viewportDurationFrames={viewportDurationFrames}
						waveformRulerState={waveformRulerState}
						recordingPreviews={recordingPreviews}
						waveformCache={waveformCacheRef.current}
						automationToolEnabled={automationToolEnabled}
						automationRuntime={automationRuntime}
						automationControls={automationControls}
						showAutomationOverlay={showAutomationOverlay}
						spectralBrushEnabled={spectralBrushEnabled}
						showArmControls={showArmControls}
						displayAudioSupported={displayAudioSupported}
					/>

					<SplitToolGuideline
						guideline={splitToolActive ? splitToolGuideline : null}
						panelWidth={panelWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
					/>
					<TimelineTrimPreviewGuide
						sample={clipDragPreview?.guideSample}
						panelWidth={panelWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						height={totalTrackHeight}
					/>
					<TimelineRateStretchPreviewGuide
						sample={clipDragPreview?.rateStretchGuideSample}
						edge={clipDragPreview?.rateStretchGuideEdge}
						panelWidth={panelWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						height={totalTrackHeight}
					/>
					<TimelineSlipSlidePreviewGuides
						samples={clipDragPreview?.guideSamples}
						panelWidth={panelWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						height={totalTrackHeight}
					/>

					{project.tracks.length === 0 && project.clips.length === 0 && (
						<div className="audio-editor-empty-state" style={{ left: panelWidth + 24 }}>
							<strong>{copy.emptyTitle}</strong>
							<p>{copy.emptyText}</p>
						</div>
					)}

					<TelemetryPlayhead
						controller={controller}
						copy={copy}
						durationFrames={durationFrames}
						panelWidth={panelWidth}
						viewportWidth={viewportWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						height={Math.max(TRACK_HEIGHT, totalTrackHeight)}
						run={run}
					/>
				</div>
			</div>
			{showTimelineAnnotations && <span
				className="kw-audio-editor-sr-only"
				data-timeline-annotation-create-status
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>{annotationCreateStatus}</span>}

			{outputTracks.length > 0 && <OutputTrackDock
				controller={controller}
				rows={outputTracks}
				focusedOutputKey={focusedOutputKey}
				onFocusOutput={setFocusedOutputKey}
				onMenu={(scope, busId, anchor) => {
					const rect = anchor?.getBoundingClientRect?.();
					setOutputMenu({
						scope,
						busId,
						anchor,
						x: rect?.right || 0,
						y: rect?.top || 0,
					});
				}}
				panelWidth={panelWidth}
				trackHeaderWidth={trackHeaderWidth}
				verticalRulerWidth={verticalRulerWidth}
				viewportWidth={viewportWidth}
				timelineWidth={timelineWidth}
				scrollX={contentScrollX}
				pixelsPerSecond={pixelsPerSecond}
				sampleRate={sampleRate}
				rulerScale={rulerScale}
				durationFrames={durationFrames}
				selection={timeSelection}
				height={outputDockHeight}
				automationToolEnabled={automationToolEnabled}
				stripEnvelopeAvailable={!isSoundscaperProductionProject(project)}
				blocked={mutationsBlocked}
				mobile={mobile}
				copy={copy}
				run={run}
				onOpenEffects={onOpenEffects}
			/>}

			<AudioEditorSampleTools controller={controller} snapshot={snapshot} copy={copy} run={run} />
			<TimelineMenus
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				geometry={geometry}
				preview={preview}
				actions={actions}
				menuModel={menuModel}
				overlayTarget={overlayTarget}
			/>
		</section>
	);
}
