import { Button, Icon, TimelineRuler } from '@dilsonspickles/components';
import { useCallback, useRef } from 'react';

import { framesToSeconds } from '../../design-system-adapters.js';
import AudioEditorSampleTools from '../AudioEditorSampleTools.jsx';
import { DEFAULT_TRACK_HEIGHT as TRACK_HEIGHT } from './geometry.ts';
import { TrackListView } from './TrackListView.jsx';
import { MusicalTimelineRuler } from './MusicalTimelineRuler.jsx';
import { SequenceTimecodeRuler } from './SequenceTimecodeRuler.jsx';
import { TimelineAnnotationLayer } from './TimelineAnnotationLayer.jsx';
import { TimelineAnnotationLaneActions } from './TimelineAnnotationLaneActions.jsx';
import {
	focusCreatedTimelineAnnotation,
	useTimelineAnnotationCreateFeedback,
} from './useTimelineAnnotationCreateFeedback.js';
import { timelineAnnotationCreateKind } from './timeline-annotation-ui-model.ts';
import { usesMusicalMapRuler } from './musical-ruler-model.ts';
import { usesSequenceTimecodeDisplay } from './sequence-ruler-model.ts';
import { resolveSequenceTimingView } from '../../sequence-timing-model.ts';
import { OutputTrackDock } from './OutputTrackRows.jsx';
import {
	PinnedPlayheadScroller,
	TelemetryPlayhead,
	TelemetryRulerPlayhead,
	TimeSelectionOverlay,
	TimelineRateStretchPreviewGuide,
	TimelineSlipSlidePreviewGuides,
	TimelineTrimPreviewGuide,
} from './TimelineOverlayComponents.jsx';
import { ContainerAddTrackFlyout } from './TimelineFlyouts.jsx';
import { TimelineMenus } from './TimelineMenus.jsx';

const TIMELINE_RULER_HEIGHT_WITH_ANNOTATIONS = 33;

export function TimelineWorkspaceView({
	controller,
	snapshot,
	copy,
	locale,
	mobile,
	showArmControls,
	displayAudioSupported,
	automationToolEnabled,
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
		transportState,
		isFlatNavigation,
		timelineRulerTabIndex,
		trackBaseTabIndex,
		addTrackTabIndex,
		panelWidth,
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
		viewportStartFrame,
		viewportDurationFrames,
		projectIndex,
		visualTrackHeight,
		totalTrackHeight,
		showTimelineAnnotations,
		showMarkers,
	} = geometry;
	const { documentSelection, timeSelection, selectedClipIdSet } = selection;
	const {
		addTrackFlyout,
		draggingClipIds,
		clipDragPreview,
		projectBinDragPreview,
		loopPreview,
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
		onPointerMove,
		finishPointerSession,
		finishTouch,
		onTimelineDragOver,
		onTimelineDragLeave,
		onTimelineDrop,
	} = navigation;
	const {
		editBlock,
		mutationsBlocked,
		splitToolActive,
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
	const tempoEvents = project.tempoMap?.events || [];
	const signatureEvents = project.signatureMap?.events || [];
	const mappedTempo = rationalValue(tempoEvents[0]?.bpm, project.tempo?.bpm || 120);
	const mappedSignature = signatureEvents[0] || project.tempo?.timeSignature || { numerator: 4, denominator: 4 };
	const useMusicalMapRuler = usesMusicalMapRuler(project);
	const sequenceTimecodeView = usesSequenceTimecodeDisplay(project) ? resolveSequenceTimingView(project) : null;
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
			data-edit-block-reason={editBlock.reason || undefined}
			style={{
				'--track-panel-width': `${panelWidth}px`,
				'--timeline-viewport-width': `${viewportWidth}px`,
				'--timeline-scroll-x': `${scrollX}px`,
				'--vertical-ruler-width': `${verticalRulerWidth}px`,
			}}
		>
			<div
				className="audio-editor-timeline-scroll"
				data-timeline
				ref={setTimelineScrollNode}
				onScroll={handleTimelineScroll}
				onPointerDownCapture={onPointerDown}
				onPointerMove={onPointerMove}
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
						<div className="audio-editor-ruler-corner" style={{ width: panelWidth }}>
							<span>{copy.tracks}</span>
							<Button
								ref={addTrackTriggerRef}
								variant="secondary"
								size="small"
								icon={<Icon name="plus" size={14} />}
								tabIndex={addTrackTabIndex}
								onClick={openAddTrackFlyout}
							>
								{copy.addTrack}
							</Button>
							{showTimelineAnnotations && showMarkers && <TimelineAnnotationLaneActions
								controller={controller}
								project={project}
								annotations={snapshot.timelineAnnotations || []}
								copy={copy}
								blocked={mutationsBlocked}
								run={run}
								createAnnotation={createAnnotation}
								focusCreated={focusCreatedInLayer}
							/>}
						</div>
						<div
							className="audio-editor-ruler-viewport"
							data-ruler
							data-ruler-focus
							data-ruler-interaction
							data-time-format={sequenceTimecodeView ? 'timecode'
								: project.timeDisplay?.format === 'beats+measures' ? 'beats-measures' : 'minutes-seconds'}
							data-track-lane
							data-track-id={snapshot.selectedTrackId || project.tracks[0]?.id || ''}
							role="region"
							aria-label={copy.timeline}
							tabIndex={timelineRulerTabIndex}
							style={{ left: panelWidth, width: viewportWidth }}
							onContextMenu={openTimelineRulerMenu}
							onKeyDown={(event) => {
								const createKind = showTimelineAnnotations && event.target === event.currentTarget
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
							{sequenceTimecodeView ? <SequenceTimecodeRuler
								height={showTimelineAnnotations ? TIMELINE_RULER_HEIGHT_WITH_ANNOTATIONS : undefined}
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								width={timelineWidth}
								viewportWidth={viewportWidth}
								timeSelection={timeSelection}
								sampleRate={sampleRate}
								view={sequenceTimecodeView}
								loopRegionEnabled={loopPreview ? true : Boolean(project.loop?.enabled)}
								loopRegionStart={framesToSeconds(displayedLoop.startFrame || 0, { sampleRate })}
								loopRegionEnd={framesToSeconds(displayedLoop.endFrame || 0, { sampleRate })}
								onLoopRegionEnabledToggle={() => run(() => controller.actions.transport.toggleLoop())}
							/> : useMusicalMapRuler ? <MusicalTimelineRuler
								height={showTimelineAnnotations ? TIMELINE_RULER_HEIGHT_WITH_ANNOTATIONS : undefined}
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								width={timelineWidth}
								viewportWidth={viewportWidth}
								timeSelection={timeSelection}
								sampleRate={sampleRate}
								tempoMap={project.tempoMap}
								signatureMap={project.signatureMap}
								loopRegionEnabled={loopPreview ? true : Boolean(project.loop?.enabled)}
								loopRegionStart={framesToSeconds(displayedLoop.startFrame || 0, { sampleRate })}
								loopRegionEnd={framesToSeconds(displayedLoop.endFrame || 0, { sampleRate })}
								onLoopRegionEnabledToggle={() => run(() => controller.actions.transport.toggleLoop())}
							/> : <TimelineRuler
								height={showTimelineAnnotations ? TIMELINE_RULER_HEIGHT_WITH_ANNOTATIONS : undefined}
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								totalDuration={durationSeconds}
								width={timelineWidth}
								viewportWidth={viewportWidth}
								timeSelection={timeSelection}
								sampleRate={sampleRate}
								timeFormat={project.timeDisplay?.format === 'beats+measures' ? 'beats-measures' : 'minutes-seconds'}
								bpm={mappedTempo}
								beatsPerMeasure={mappedSignature.numerator || 4}
								loopRegionEnabled={loopPreview ? true : Boolean(project.loop?.enabled)}
								loopRegionStart={framesToSeconds(displayedLoop.startFrame || 0, { sampleRate })}
								loopRegionEnd={framesToSeconds(displayedLoop.endFrame || 0, { sampleRate })}
								onLoopRegionEnabledToggle={() => run(() => controller.actions.transport.toggleLoop())}
							/>}
							{showTimelineAnnotations && <TimelineAnnotationLayer
								controller={controller}
								project={project}
								annotations={snapshot.timelineAnnotations || []}
								selectedAnnotationId={snapshot.selectedAnnotationId}
								copy={copy}
								locale={locale}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								scrollX={scrollX}
								viewportWidth={viewportWidth}
								blocked={mutationsBlocked}
								run={run}
								createAnnotation={createAnnotation}
							/>}
							<TelemetryRulerPlayhead
								controller={controller}
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								sampleRate={sampleRate}
								viewportWidth={viewportWidth}
							/>
						</div>
						{verticalRulerWidth > 0 && <div
							className="audio-editor-ruler-scale-corner"
							aria-hidden="true"
							style={{ left: panelWidth + viewportWidth, width: verticalRulerWidth }}
						/>}
					</div>

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
						snapshot={snapshot}
						selectedClipIdSet={selectedClipIdSet}
						draggingClipIds={draggingClipIds}
						clipDragPreview={clipDragPreview}
						projectBinDragPreview={projectBinDragPreview}
						mutationsBlocked={mutationsBlocked}
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
						timelineWidth={timelineWidth}
						verticalRulerWidth={verticalRulerWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						viewportStartFrame={viewportStartFrame}
						viewportDurationFrames={viewportDurationFrames}
						waveformRulerState={waveformRulerState}
						recordingPreviews={recordingPreviews}
						waveformCache={waveformCacheRef.current}
						automationToolEnabled={automationToolEnabled}
						showArmControls={showArmControls}
						displayAudioSupported={displayAudioSupported}
					/>

					<TimeSelectionOverlay
						selection={timeSelection}
						panelWidth={panelWidth}
						pixelsPerSecond={pixelsPerSecond}
						height={totalTrackHeight}
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
					<PinnedPlayheadScroller
						controller={controller}
						enabled={Boolean(
							snapshot.timeline?.pinnedPlayhead
							&& snapshot.timeline?.updateDisplayWhilePlaying !== false
						)}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						scrollRef={scrollRef}
						timelineWidth={timelineWidth}
						transportState={transportState}
						viewportWidth={viewportWidth}
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
				verticalRulerWidth={verticalRulerWidth}
				viewportWidth={viewportWidth}
				timelineWidth={timelineWidth}
				scrollX={scrollX}
				pixelsPerSecond={pixelsPerSecond}
				sampleRate={sampleRate}
				durationFrames={durationFrames}
				selection={timeSelection}
				height={outputDockHeight}
				automationToolEnabled={automationToolEnabled}
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

function rationalValue(value, fallback) {
	const numerator = Number(value?.num);
	const denominator = Number(value?.den);
	return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
		? numerator / denominator
		: fallback;
}
