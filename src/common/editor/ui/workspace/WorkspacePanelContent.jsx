import React, { useEffect, useState } from 'react'; import { publishedCopyFor } from '../../controller/shared/presentation-localization.ts';
import { Button } from '@soundscaper/design-system/Button';

import AudioEditorMixerPanel from './AudioEditorMixerPanel.jsx';
import ClockPanel from './ClockPanel.tsx';
import MeterWorkspacePanel from './MeterWorkspacePanel.jsx';
import { LabelManagerRow } from './LabelManagerRows.jsx';
import ProjectBinPanel from './ProjectBinPanel.jsx';
import SourceMonitorPanel from './SourceMonitorPanel.jsx';
import TimelineAnnotationWorkspacePanel from './TimelineAnnotationWorkspacePanel.tsx';
import VideoPreviewPanel from './VideoPreviewPanel.jsx';
import { SequenceTimingProjectProperties } from '../toolbar/SequenceTimingControls.jsx';
import { historyCommandLabel } from './workspace-panel-model.ts';
import { consumeEffectsFocusSuppression, hasEffectsFocusSuppression } from './workspace-preset-focus.js';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';

const RealtimeAnalysisPanel = lazyEditorModule(() => import('../inspector/RealtimeAnalysisPanel.jsx'));

// The docked effects rack claims keyboard focus when it opens. Moving the
// panel to another dock unmounts that rack and mounts a fresh one, which would
// claim focus again and pull it off the panel's own menu button. Remember
// which host last showed the rack so a re-mount elsewhere can tell itself
// apart from a genuine open.
let effectsPanelHost = null;

/** Whether a rack mounting in `nextHost` opens fresh rather than following a move. */
export function effectsPanelAutoFocusOnMount(previousHost, nextHost) {
	return previousHost === null || previousHost === nextHost;
}

function useEffectsPanelAutoFocus(host, controller) {
	const [autoFocus] = useState(() => !hasEffectsFocusSuppression(controller)
		&& effectsPanelAutoFocusOnMount(effectsPanelHost, host));
	useEffect(() => {
		consumeEffectsFocusSuppression(controller);
		effectsPanelHost = host;
		return () => {
			if (effectsPanelHost === host) effectsPanelHost = null;
		};
	}, [host, controller]);
	return autoFocus;
}

function DockedEffectsPanel({ host, panelActive = true, controller, ...props }) {
	const autoFocusOnOpen = useEffectsPanelAutoFocus(host, controller);
	return <AudioEditorEffectsOverlay autoFocusOnOpen={panelActive && autoFocusOnOpen} controller={controller} {...props} />;
}
const AudioEditorEffectsOverlay = lazyEditorModule(() => import('../inspector/AudioEditorEffectsOverlay.jsx'));
const FRAMESCAPER_BUILD = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'framescaper';
const SOUNDSCAPER_BUILD = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'soundscaper';
const DEFERRED_WORKSPACE_PANELS = Object.freeze({
	'clip-properties': lazyEditorModule(() => import('../inspector/ClipPropertiesPanel.tsx')),
	metadata: lazyEditorModule(() => import('./ProjectMetadataPanel.tsx')),
	...(FRAMESCAPER_BUILD ? {
		'recording-setup': lazyEditorModule(() => import('./RecordingSetupPanel.tsx')),
		'web-vcr': lazyEditorModule(() => import('./WebVcrPanel.tsx')),
	} : {}),
	...(SOUNDSCAPER_BUILD ? {
		freesound: lazyEditorModule(() => import('./FreesoundPanelContainer.tsx')),
	} : {}),
});

function LazyInspectorFallback({ copy }) {
	return <div className="audio-editor-timeline-loading" role="status" aria-live="polite">{copy.loading}</div>;
}

export default function WorkspacePanelContent({
	panelId,
	panelActive = true,
	dock = 'main',
	controller,
	clipPropertiesFocusRequest = /** @type {import('../../controller/composition/clip-properties-panel-opening.ts').ClipPropertiesFocusRequest | null} */ (null),
	snapshot,
	productId = snapshot.productId,
	capabilities = snapshot.capabilities,
	copy,
	locale,
	fileService,
	playbackMeterSettings,
	recordingMeterSettings = /** @type {import('../meter-settings.ts').MeterSettings | undefined} */ (undefined),
	onPlaybackMeterSettingsChange = /** @type {((update: import('./meter-panel-settings.ts').MeterSettingsUpdate) => void) | undefined} */ (undefined),
	onRecordingMeterSettingsChange = /** @type {((update: import('./meter-panel-settings.ts').MeterSettingsUpdate) => void) | undefined} */ (undefined),
	clippingEnabled = false,
	run,
	showArmControls,
	displayAudioSupported,
	onOpenEffects,
	onRoutingGraphGesture = /** @type {import('./soundscaper-routing-graph-gesture.ts').SoundscaperRoutingGraphGestureHandler | undefined} */ (undefined),
	onRoutingParameterGesture = /** @type {import('./soundscaper-routing-graph-gesture.ts').SoundscaperRoutingParameterGestureHandler | undefined} */ (undefined),
	effectsPanelTarget,
	onEffectWindowChange,
	blocked,
	projectBinVisible = false,
}) {
	const project = snapshot.project;
	if (panelId === 'playback-meter' || panelId === 'recording-meter') {
		const recording = panelId === 'recording-meter';
		return <MeterWorkspacePanel
			kind={recording ? 'recording' : 'playback'}
			dock={dock}
			panelActive={panelActive}
			controller={controller}
			copy={copy}
			snapshot={snapshot}
			settings={recording ? recordingMeterSettings : playbackMeterSettings}
			onSettingsChange={recording ? onRecordingMeterSettingsChange : onPlaybackMeterSettingsChange}
			clippingEnabled={clippingEnabled}
			run={run}
		/>;
	}
	const DeferredWorkspacePanel = Object.hasOwn(DEFERRED_WORKSPACE_PANELS, panelId)
		? DEFERRED_WORKSPACE_PANELS[panelId]
		: null;
	if (DeferredWorkspacePanel) {
		return (
			<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
				<DeferredWorkspacePanel
					controller={controller}
					focusRequest={panelId === 'clip-properties' ? clipPropertiesFocusRequest : undefined}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					run={run}
					blocked={blocked}
					panelActive={panelActive}
					projectBinVisible={projectBinVisible}
					project={project}
					sequenceEditor={panelId === 'metadata' && productId === 'framescaper' && project?.sequences?.length
						? <SequenceTimingProjectProperties project={project} snapshot={snapshot}
							controller={controller} copy={copy} run={run} />
						: null}
					disabled={panelId === 'freesound'
						? Boolean(snapshot.readOnly || blocked)
						: snapshot.readOnly}
					onUpdate={(changes) => run(() => controller.actions.metadata.update(changes))}
				/>
			</React.Suspense>
		);
	}
	if (panelId === 'clock') {
		return <ClockPanel controller={controller} snapshot={snapshot} copy={copy} run={run} />;
	}
	if (panelId === 'project-bin') {
		return (
			<ProjectBinPanel
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				locale={locale}
				fileService={fileService}
				run={run}
				blocked={blocked}
			/>
		);
	}
	if (panelId === 'video-preview') {
		return <VideoPreviewPanel controller={controller} snapshot={snapshot} copy={copy} run={run} />;
	}
	if (panelId === 'source-monitor') {
		return (
			<SourceMonitorPanel
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				run={run}
				blocked={blocked}
			/>
		);
	}
	if (panelId === 'analysis') {
		return <React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
			<RealtimeAnalysisPanel controller={controller} copy={copy} settings={playbackMeterSettings} active={panelActive} />
		</React.Suspense>;
	}
	if (panelId === 'history') {
		const undoEntries = snapshot.history?.undoEntries || [];
		const redoEntries = snapshot.history?.redoEntries || [];
		return (
			<>
				<div className="kw-audio-editor__panel-actions-inline">
					<Button variant="secondary" disabled={!snapshot.history?.canUndo} onClick={() => run(() => controller.actions.edit.undo())}>{copy.undo}</Button>
					<Button variant="secondary" disabled={!snapshot.history?.canRedo} onClick={() => run(() => controller.actions.edit.redo())}>{copy.redo}</Button>
				</div>
				{!undoEntries.length && !redoEntries.length
					? <p className="kw-audio-editor__panel-empty">{copy.historyEmpty}</p>
					: <ol className="kw-audio-editor__panel-list" data-history-list>
						{undoEntries.map((entry, index) => <li key={`undo-${index}`}>{historyCommandLabel(copy, entry)}</li>)}
						{redoEntries.map((entry, index) => <li key={`redo-${index}`} data-redo="true">{copy.redo}: {historyCommandLabel(copy, entry)}</li>)}
					</ol>}
			</>
		);
	}
	if (panelId === 'labels') {
		const labelTracks = (project?.tracks || []).filter((track) => track.type === 'label');
		const labels = labelTracks.flatMap((track) => (track.labels || []).map((label) => ({
			...label,
			trackId: track.id,
			trackName: track.name,
		})));
		const targetTrack = labelTracks.find((track) => track.id === snapshot.selectedTrackId) || labelTracks[0];
		return (
			<>
				<div className="kw-audio-editor__panel-actions-inline">
					<Button
						variant="secondary"
						disabled={snapshot.readOnly}
						onClick={() => run(() => controller.actions.labels.add(targetTrack?.id || null, {
							title: publishedCopyFor(copy).newLabel || publishedCopyFor(copy).untitledLabel,
							startFrame: snapshot.selection?.startFrame || 0,
							endFrame: snapshot.selection?.endFrame || snapshot.selection?.startFrame || 0,
						}))}
					>{copy.newLabel || copy.addLabelTrack}</Button>
				</div>
				{labels.length ? (
					<ul className="kw-audio-editor__panel-list kw-audio-editor__label-manager" data-labels-panel-list>
						{labels.map((label) => (
							<LabelManagerRow
								key={label.id}
								label={label}
								sampleRate={project.sampleRate}
								controller={controller}
								copy={copy}
								disabled={snapshot.readOnly}
								run={run}
							/>
						))}
					</ul>
				) : <p className="kw-audio-editor__panel-empty">{copy.labelsEmpty}</p>}
			</>
		);
	}
	if (panelId === 'markers') {
		return (
			<TimelineAnnotationWorkspacePanel
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				locale={locale}
				run={run}
			/>
		);
	}
	if (panelId === 'effects') {
		const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type === 'audio');
		const scope = effectsPanelTarget?.scope || 'track';
		const targetId = scope === 'track'
			? selectedTrack?.id || null
			: effectsPanelTarget?.trackId || null;
		return <DockedEffectsPanel
			host={dock}
			panelActive={panelActive}
			isOpen
			controller={controller}
			snapshot={snapshot}
			copy={copy}
			locale={locale}
			fileService={fileService}
			trackId={targetId}
			scope={scope}
			layout="docked"
			onClose={() => undefined}
			selectedEffect={null}
			onSelectedEffectChange={(selectedEffect) => {
				if (!selectedEffect) return;
				onEffectWindowChange?.({
					trackId: selectedEffect.scope === 'master' ? null : targetId,
					scope: selectedEffect.scope,
					selectedEffect,
				});
			}}
			renderDialogs={false}
		/>;
	}
	if (panelId === 'mixer') {
		return <AudioEditorMixerPanel controller={controller} snapshot={snapshot} productId={productId} capabilities={capabilities} copy={copy} run={run} showArmControls={showArmControls} displayAudioSupported={displayAudioSupported} onOpenEffects={onOpenEffects} onRoutingGraphGesture={onRoutingGraphGesture} onRoutingParameterGesture={onRoutingParameterGesture} />;
	}
	return null;
}
