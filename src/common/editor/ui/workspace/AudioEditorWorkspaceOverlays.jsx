import React from 'react';
import ScapeOpenDecisionDialog from './ScapeOpenDecisionDialog.jsx';
import SoundscaperProductionWorkspaceOverlay from './SoundscaperProductionWorkspaceOverlay.tsx';
import { framescaperV27FinishingSurface } from '../framescaper-v27-finishing-menu.ts';
import { framescaperSelectedV27VisualAuthoringSurface } from '../framescaper-selected-v27-visual-authoring-menu.ts';

const AudioEditorEffectsOverlay = React.lazy(() => import('../inspector/AudioEditorEffectsOverlay.jsx'));
const AudioEditorMacroManagerDialog = React.lazy(() => import('../inspector/AudioEditorMacroManagerDialog.jsx'));
const ClipPropertiesDialog = React.lazy(() => import('../inspector/ClipPropertiesDialog.jsx'));
const VideoCompositionDialog = React.lazy(() => import('../inspector/VideoCompositionDialog.tsx'));
const VideoKeyframeDialog = React.lazy(() => import('../inspector/VideoKeyframeDialog.tsx'));
const VideoRetimeDialog = React.lazy(() => import('../dialogs/VideoRetimeDialog.tsx'));
const FramescaperVideoProxyDialog = React.lazy(() => import('../dialogs/FramescaperVideoProxyDialog.tsx'));
const FramescaperV27FinishingDialog = React.lazy(() => import('../dialogs/FramescaperV27FinishingDialog.tsx'));
const FramescaperV27VisualInspectorDialog = React.lazy(() => import('../dialogs/FramescaperV27VisualInspectorDialog.tsx'));
const FramescaperSelectedV27VisualAuthoringDialog = React.lazy(() => import('../dialogs/FramescaperSelectedV27VisualAuthoringDialog.tsx'));
const ExportDialog = React.lazy(() => import('../inspector/ExportDialog.jsx'));
const DeliveryQueueDialog = React.lazy(() => import('../inspector/DeliveryQueueDialog.jsx'));
const LabelExportDialog = React.lazy(() => import('../inspector/LabelExportDialog.jsx'));
const SelectionEffectsDialog = React.lazy(() => import('../inspector/SelectionEffectsDialog.jsx'));
const EditorDialog = React.lazy(() => import('../dialogs/EditorDialog.jsx'));
const GeneratorDialog = React.lazy(() => import('../dialogs/GeneratorDialog.jsx'));
const NyquistDialog = React.lazy(() => import('../dialogs/NyquistDialog.jsx'));
const SpectralSelectionDialog = React.lazy(() => import('../dialogs/SpectralSelectionDialog.jsx'));
const AudioWarpDialog = React.lazy(() => import('../dialogs/AudioWarpDialog.tsx'));
const TakeCompDialog = React.lazy(() => import('../dialogs/TakeCompDialog.tsx'));
const TakeCycleRecoveryDialog = React.lazy(() => import('../dialogs/TakeCycleRecoveryDialog.tsx'));
const WorkspacePreferencesDialog = React.lazy(() => import('../dialogs/WorkspacePreferencesDialog.jsx'));
const RawPcmImportDialog = React.lazy(() => import('../dialogs/ImportAnalysisDialogs.tsx').then((module) => ({ default: module.RawPcmImportDialog })));
const RegularIntervalAnnotationDialog = React.lazy(() => import('../dialogs/ImportAnalysisDialogs.tsx').then((module) => ({ default: module.RegularIntervalAnnotationDialog })));

function LazyInspectorFallback({ copy }) {
	return <div className="audio-editor-timeline-loading" role="status" aria-live="polite">{copy.loading}</div>;
}

export default function AudioEditorWorkspaceOverlays({ model }) {
	const {
		activeSurface,
		applicationMenus,
		aboutLabel,
		capabilities,
		closeNyquist,
		controller,
		copy,
		dialog,
		dialogSourceKey,
		dialogTrackId,
		dialogValue,
		effectWindow,
		editBlocked,
		fileService,
		generatorType,
		locale,
		macroDraft,
		nyquistTarget,
		preferences,
		preferencesPage,
		projectBinEffectivelyOpen,
		productId,
		run,
		scapeOpenDecision,
		setActiveSurface,
		setDialog,
		setDialogSourceKey,
		setDialogValue,
		setEffectWindow,
		setMacroDraft,
		settleScapeOpenDecision,
		showArmControls,
		snapshot,
		toggleWorkspacePanel,
	} = model;
	const framescaperFinishingSurface = framescaperV27FinishingSurface(activeSurface);
	const selectedV27AuthoringSurface = framescaperSelectedV27VisualAuthoringSurface(activeSurface);
	return <>
			<SoundscaperProductionWorkspaceOverlay model={model} />

			{capabilities.audioEffects && effectWindow && (
				<div data-effects-window-host>
					<React.Suspense fallback={null}>
						<AudioEditorEffectsOverlay
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							fileService={fileService}
							trackId={effectWindow.trackId}
							scope={effectWindow.scope}
							selectedEffect={effectWindow.selectedEffect}
							onSelectedEffectChange={(selectedEffect) => setEffectWindow(selectedEffect
								? { ...effectWindow, selectedEffect }
								: null)}
							renderRack={false}
						/>
					</React.Suspense>
				</div>
			)}

			{activeSurface === 'clip' && (
				<div data-editor-surface="clip">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<ClipPropertiesDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'framescaper' && capabilities.videoGeometry && activeSurface === 'video-composition' && (
				<div data-editor-surface="video-composition">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<VideoCompositionDialog
							productId={productId}
							capability={Boolean(capabilities.videoGeometry)}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'framescaper' && capabilities.videoKeyframes && activeSurface === 'video-keyframes' && (
				<div data-editor-surface="video-keyframes">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<VideoKeyframeDialog
							productId={productId}
							capability={Boolean(capabilities.videoKeyframes)}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'framescaper' && capabilities.videoRetime && activeSurface === 'video-retime' && (
				<div data-editor-surface="video-retime">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<VideoRetimeDialog
							productId={productId}
							capability={Boolean(capabilities.videoRetime)}
							editingBlocked={editBlocked}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'framescaper' && (snapshot.project?.schemaVersion === 20
				|| snapshot.project?.schemaVersion === 27
				|| snapshot.project?.schemaVersion === 28) && activeSurface === 'video-proxy' && (
				<div data-editor-surface="video-proxy">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<FramescaperVideoProxyDialog
							controller={controller}
							snapshot={snapshot}
							editingBlocked={editBlocked}
							copy={copy}
							fileService={fileService}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'framescaper' && (snapshot.project?.schemaVersion === 27
				|| snapshot.project?.schemaVersion === 28)
				&& framescaperFinishingSurface && framescaperFinishingSurface !== 'visual-inspector' && (
				<div data-editor-surface="framescaper-v27-finishing">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<FramescaperV27FinishingDialog
							surface={framescaperFinishingSurface}
							controller={controller}
							project={snapshot.project}
							selectedTrackId={snapshot.selectedTrackId ?? null}
							editingBlocked={editBlocked}
							readOnly={snapshot.readOnly === true}
							copy={copy}
							fileService={fileService}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'framescaper' && (snapshot.project?.schemaVersion === 27
				|| snapshot.project?.schemaVersion === 28)
				&& framescaperFinishingSurface === 'visual-inspector' && (
				<div data-editor-surface="framescaper-v27-visual-inspector">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<FramescaperV27VisualInspectorDialog
							controller={controller}
							project={snapshot.project}
							selectedClipId={snapshot.selectedClipId}
							editingBlocked={editBlocked}
							readOnly={snapshot.readOnly === true}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'framescaper' && (snapshot.project?.schemaVersion === 27
				|| snapshot.project?.schemaVersion === 28)
				&& selectedV27AuthoringSurface && (
				<div data-editor-surface="framescaper-selected-v27-authoring">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<FramescaperSelectedV27VisualAuthoringDialog
							surface={selectedV27AuthoringSurface}
							controller={controller}
							project={snapshot.project}
							selectedClipId={snapshot.selectedClipId ?? null}
							playheadSample={controller.getTelemetrySnapshot()?.positionFrame ?? 0}
							editingBlocked={editBlocked}
							readOnly={snapshot.readOnly === true}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{capabilities.audioEffects && activeSurface === 'selection-effect' && (
				<div data-editor-surface="selection-effect">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<SelectionEffectsDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{capabilities.audioMacros && activeSurface === 'macro-manager' && (
				<div data-editor-surface="macro-manager">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<AudioEditorMacroManagerDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							draft={macroDraft}
							onDraftChange={setMacroDraft}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{capabilities.audioSpectralEditing && activeSurface === 'spectral-selection' && (
				<div data-editor-surface="spectral-selection">
					<SpectralSelectionDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						run={run}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{capabilities.takeComp && activeSurface === 'take-comp' && (
				<div data-editor-surface="take-comp">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<TakeCompDialog
							productId={productId}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{capabilities.takeComp && activeSurface === 'take-cycle-recovery' && snapshot.takeCycleRecovery && (
				<div data-editor-surface="take-cycle-recovery">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<TakeCycleRecoveryDialog
							productId={productId}
							pending={snapshot.takeCycleRecovery}
							controller={controller}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{capabilities.audioWarp && activeSurface === 'audio-warp' && (
				<div data-editor-surface="audio-warp">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<AudioWarpDialog
							productId={productId}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{capabilities.audioGenerators && activeSurface === 'generator' && (
				<div data-editor-surface="generator">
					<GeneratorDialog
						isOpen
						type={generatorType}
						controller={controller}
						copy={copy}
						locale={locale}
						run={run}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'raw-pcm-import' && <RawPcmImportDialog controller={controller} copy={copy} run={run} onClose={() => setActiveSurface(null)} />}
			{capabilities.timelineAnnotations && activeSurface === 'regular-interval-annotations' && <RegularIntervalAnnotationDialog controller={controller} copy={copy} run={run} onClose={() => setActiveSurface(null)} />}
			{capabilities.audioEffects && activeSurface === 'nyquist' && (
				<div data-editor-surface="nyquist">
					<NyquistDialog
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						target={nyquistTarget}
						run={run}
						onClose={closeNyquist}
					/>
				</div>
			)}
			{activeSurface === 'export' && (
				<div data-editor-surface="export">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<ExportDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							productId={productId}
							fileService={fileService}
							locale={locale}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'delivery-queue' && (
				<div data-editor-surface="delivery-queue">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<DeliveryQueueDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'label-export' && (
				<div data-editor-surface="label-export">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<LabelExportDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'preferences' && (
				<div data-editor-surface="preferences">
					<WorkspacePreferencesDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						fileService={fileService}
						menus={applicationMenus}
						run={run}
						initialPage={preferencesPage}
						productId={productId}
						isPanelVisible={(panelId) => (
							panelId === 'project-bin'
								? projectBinEffectivelyOpen
								: preferences.workspace.panels[panelId]?.visible === true
						)}
						onTogglePanel={toggleWorkspacePanel}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}

			{dialog && (
				<EditorDialog
					aboutLabel={aboutLabel}
					type={dialog}
					value={dialogValue}
					onValueChange={setDialogValue}
					sourceKey={dialogSourceKey}
					onSourceKeyChange={setDialogSourceKey}
					trackId={dialogTrackId}
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					run={run}
					showArmControls={showArmControls}
					onClose={() => setDialog(null)}
				/>
			)}
			{scapeOpenDecision && (
				<ScapeOpenDecisionDialog
					copy={copy}
					prompt={scapeOpenDecision}
					onSettle={settleScapeOpenDecision}
				/>
			)}
	</>;
}
