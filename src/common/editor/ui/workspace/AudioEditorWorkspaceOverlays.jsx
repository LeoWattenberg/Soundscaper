import React from 'react';
import ScapeOpenDecisionDialog from './ScapeOpenDecisionDialog.jsx';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../../project-schema-identity.ts';
import { framescaperFinishingSurface } from '../framescaper-finishing-menu.ts';
import { framescaperSelectedVisualAuthoringSurface } from '../framescaper-selected-visual-authoring-menu.ts';
import { resolveLocalModelManagerBridge } from '../local-model-manager-bridge.ts';
import { resolveSoundscaperMasteringSequenceCopy } from '../soundscaper-workflow-product-runtime.tsx';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';

const AudioEditorEffectsOverlay = lazyEditorModule(() => import('../inspector/AudioEditorEffectsOverlay.jsx'));
const AudioEditorMacroManagerDialog = lazyEditorModule(() => import('../inspector/AudioEditorMacroManagerDialog.jsx'));
const SOUNDSCAPER_BUILD = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'soundscaper';
const SoundscaperMasteringSequenceDialog = SOUNDSCAPER_BUILD
	? lazyEditorModule(() => import('../dialogs/SoundscaperMasteringSequenceDialog.tsx')) : null;
const WorkspaceOnboardingDialog = SOUNDSCAPER_BUILD
	? lazyEditorModule(() => import('../dialogs/WorkspaceOnboardingDialog.tsx')) : null;
const ClipPropertiesDialog = lazyEditorModule(() => import('../inspector/ClipPropertiesDialog.jsx'));
const VideoCompositionDialog = lazyEditorModule(() => import('../inspector/VideoCompositionDialog.tsx'));
const VideoKeyframeDialog = lazyEditorModule(() => import('../inspector/VideoKeyframeDialog.tsx'));
const VideoRetimeDialog = lazyEditorModule(() => import('../dialogs/VideoRetimeDialog.tsx'));
const FRAMESCAPER_BUILD = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'framescaper';
const FramescaperVideoProxyDialog = FRAMESCAPER_BUILD
	? lazyEditorModule(() => import('../dialogs/FramescaperVideoProxyDialog.tsx')) : null;
const FramescaperFinishingDialog = FRAMESCAPER_BUILD
	? lazyEditorModule(() => import('../dialogs/FramescaperFinishingDialog.tsx')) : null;
const FramescaperVisualInspectorDialog = FRAMESCAPER_BUILD
	? lazyEditorModule(() => import('../dialogs/FramescaperVisualInspectorDialog.tsx')) : null;
const FramescaperSelectedVisualAuthoringDialog = FRAMESCAPER_BUILD
	? lazyEditorModule(() => import('../dialogs/FramescaperSelectedVisualAuthoringDialog.tsx')) : null;
const ExportDialog = lazyEditorModule(() => import('../inspector/ExportDialog.jsx'));
const DeliveryQueueDialog = lazyEditorModule(() => import('../inspector/DeliveryQueueDialog.jsx'));
const LabelExportDialog = lazyEditorModule(() => import('../inspector/LabelExportDialog.jsx'));
const SelectionEffectsDialog = lazyEditorModule(() => import('../inspector/SelectionEffectsDialog.jsx'));
const MixRenderDialog = lazyEditorModule(() => import('../dialogs/MixRenderDialog.tsx'));
const EditorDialog = lazyEditorModule(() => import('../dialogs/EditorDialog.jsx'));
const GeneratorDialog = lazyEditorModule(() => import('../dialogs/GeneratorDialog.jsx'));
const NyquistDialog = lazyEditorModule(() => import('../dialogs/NyquistDialog.jsx'));
const SpectralSelectionDialog = lazyEditorModule(() => import('../dialogs/SpectralSelectionDialog.jsx'));
const AudioWarpDialog = lazyEditorModule(() => import('../dialogs/AudioWarpDialog.tsx'));
const TakeCompDialog = lazyEditorModule(() => import('../dialogs/TakeCompDialog.tsx'));
const TakeCycleRecoveryDialog = lazyEditorModule(() => import('../dialogs/TakeCycleRecoveryDialog.tsx'));
const WorkspacePreferencesDialog = lazyEditorModule(() => import('../dialogs/WorkspacePreferencesDialog.jsx'));
const RawPcmImportDialog = lazyEditorModule(() => import('../dialogs/ImportAnalysisDialogs.tsx').then((module) => ({ default: module.RawPcmImportDialog })));
const RegularIntervalAnnotationDialog = lazyEditorModule(() => import('../dialogs/ImportAnalysisDialogs.tsx').then((module) => ({ default: module.RegularIntervalAnnotationDialog })));
const LocalModelManagerDialog = lazyEditorModule(() => import('../dialogs/LocalModelManagerDialog.tsx'));
const LocalAssistanceDialog = lazyEditorModule(() => import('../dialogs/LocalAssistanceDialogSurface.tsx'));
const LocalDiagnosticsDialog = lazyEditorModule(() => import('../dialogs/LocalDiagnosticsDialog.tsx'));
const PrivacyPolicyDialog = lazyEditorModule(() => import('../dialogs/PrivacyPolicyDialog.tsx'));

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
		selectedMediaPreparation,
		settleScapeOpenDecision,
		showArmControls,
		soundscaperWorkflow,
		snapshot,
		toggleWorkspacePanel,
	} = model;
	const activeFramescaperFinishingSurface = framescaperFinishingSurface(activeSurface);
	const selectedAuthoringSurface = framescaperSelectedVisualAuthoringSurface(activeSurface);
	const localModelManagerBridge = resolveLocalModelManagerBridge(fileService.bridge);
	const selectedFramescaperProject = productId === 'framescaper'
		&& isCurrentProjectSchemaIdentity(snapshot.project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
	const framescaperProxyProject = productId === 'framescaper'
		&& isCurrentProjectSchemaIdentity(snapshot.project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
	return <>
			{productId === 'soundscaper' && activeSurface === 'mastering-sequences'
				&& SoundscaperMasteringSequenceDialog && (
				<div data-editor-surface="mastering-sequences">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<SoundscaperMasteringSequenceDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={resolveSoundscaperMasteringSequenceCopy(copy)}
							locale={locale}
							run={run}
							onClose={() => {
								setActiveSurface(null);
								soundscaperWorkflow?.restoreFocus();
							}}
						/>
					</React.Suspense>
				</div>
			)}
			{productId === 'soundscaper' && activeSurface === 'workspace-onboarding'
				&& WorkspaceOnboardingDialog && (
				<div data-editor-surface="workspace-onboarding">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<WorkspaceOnboardingDialog
							productId={productId}
							controller={controller}
							preferences={preferences}
							copy={copy}
							run={run}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'privacy-policy' && (
				<div data-editor-surface="privacy-policy">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<PrivacyPolicyDialog
							locale={locale}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'local-diagnostics' && (
				<div data-editor-surface="local-diagnostics">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<LocalDiagnosticsDialog
							controller={controller}
							copy={copy}
							fileService={fileService}
							locale={locale}
							productId={productId}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}

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
			{framescaperProxyProject && activeSurface === 'video-proxy' && (
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
			{selectedFramescaperProject
				&& activeFramescaperFinishingSurface
				&& activeFramescaperFinishingSurface !== 'visual-inspector' && (
				<div data-editor-surface="framescaper-finishing">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<FramescaperFinishingDialog
							surface={activeFramescaperFinishingSurface}
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
			{selectedFramescaperProject
				&& activeFramescaperFinishingSurface === 'visual-inspector' && (
				<div data-editor-surface="framescaper-visual-inspector">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<FramescaperVisualInspectorDialog
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
			{selectedFramescaperProject
				&& selectedAuthoringSurface && (
				<div data-editor-surface="framescaper-selected-authoring">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<FramescaperSelectedVisualAuthoringDialog
							surface={selectedAuthoringSurface}
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
			{capabilities.audioEffects && activeSurface === 'mix-render' && (
				<div data-editor-surface="mix-render">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<MixRenderDialog controller={controller} snapshot={snapshot} copy={copy} run={run}
							onClose={() => setActiveSurface(null)} />
					</React.Suspense>
				</div>
			)}
			{capabilities.audioMacros && activeSurface === 'macro-manager' && (
				<div data-editor-surface="macro-manager">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<AudioEditorMacroManagerDialog
							isOpen
							productId={productId}
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
			{fileService.isDesktop && activeSurface === 'local-models' && (
				<div data-editor-surface="local-models">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<LocalModelManagerDialog
							bridge={localModelManagerBridge}
							copy={copy}
							locale={locale}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{fileService.isDesktop && capabilities.assistanceAssets && activeSurface === 'local-assistance' && (
				<div data-editor-surface="local-assistance">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<LocalAssistanceDialog
							projectId={snapshot.project?.id ?? null}
							bridgeScope={fileService.bridge}
							preparation={selectedMediaPreparation}
							copy={copy}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
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
