import React from 'react';
import { Button } from '@dilsonspickles/components';

import { EbuR128WorkspacePanel } from '../toolbar/AudioEditorMeters.jsx';
import AudioEditorMixerPanel from './AudioEditorMixerPanel.jsx';
import { LabelManagerRow } from './LabelManagerRows.jsx';
import ProjectBinPanel from './ProjectBinPanel.jsx';
import ProjectMetadataPanel from './ProjectMetadataPanel.tsx';
import VideoPreviewPanel from './VideoPreviewPanel.jsx';
import { ANALYSIS_MODE_PANEL_IDS, historyCommandLabel } from './workspace-panel-model.ts';

const AnalysisPanel = React.lazy(() => import('../inspector/AnalysisPanel.jsx'));
const AudioEditorEffectsOverlay = React.lazy(() => import('../inspector/AudioEditorEffectsOverlay.jsx'));

function LazyInspectorFallback({ copy }) {
	return <div className="audio-editor-timeline-loading" role="status" aria-live="polite">{copy.loading}</div>;
}

export default function WorkspacePanelContent({
	panelId,
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	playbackMeterSettings,
	run,
	showArmControls,
	displayAudioSupported,
	onOpenEffects,
	effectsPanelTarget,
	onEffectWindowChange,
	blocked,
}) {
	const project = snapshot.project;
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
		return <VideoPreviewPanel controller={controller} snapshot={snapshot} copy={copy} />;
	}
	const analysisMode = Object.entries(ANALYSIS_MODE_PANEL_IDS)
		.find(([, candidatePanelId]) => candidatePanelId === panelId)?.[0];
	if (analysisMode) {
		return (
			<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
				<AnalysisPanel
					mode={analysisMode}
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					fileService={fileService}
				/>
			</React.Suspense>
		);
	}
	if (panelId === 'ebu-r128') {
		return (
			<EbuR128WorkspacePanel
				controller={controller}
				copy={copy}
				settings={playbackMeterSettings}
			/>
		);
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
							title: copy.newLabel || copy.untitledLabel,
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
	if (panelId === 'metadata') {
		return (
			<ProjectMetadataPanel
				project={project}
				copy={copy}
				disabled={snapshot.readOnly}
				onUpdate={(changes) => run(() => controller.actions.metadata.update(changes))}
			/>
		);
	}
	if (panelId === 'effects') {
		const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type === 'audio');
		const scope = effectsPanelTarget?.scope || 'track';
		const targetId = scope === 'track'
			? selectedTrack?.id || null
			: effectsPanelTarget?.trackId || null;
		return <AudioEditorEffectsOverlay
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
		return <AudioEditorMixerPanel controller={controller} snapshot={snapshot} copy={copy} run={run} showArmControls={showArmControls} displayAudioSupported={displayAudioSupported} onOpenEffects={onOpenEffects} />;
	}
	return null;
}
