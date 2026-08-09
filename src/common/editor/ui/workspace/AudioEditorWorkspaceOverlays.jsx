import React from 'react';
import ScapeOpenDecisionDialog from './ScapeOpenDecisionDialog.jsx';

const AudioEditorEffectsOverlay = React.lazy(() => import('../inspector/AudioEditorEffectsOverlay.jsx'));
const AudioEditorMacroManagerDialog = React.lazy(() => import('../inspector/AudioEditorMacroManagerDialog.jsx'));
const ClipPropertiesDialog = React.lazy(() => import('../inspector/ClipPropertiesDialog.jsx'));
const ExportDialog = React.lazy(() => import('../inspector/ExportDialog.jsx'));
const LabelExportDialog = React.lazy(() => import('../inspector/LabelExportDialog.jsx'));
const SelectionEffectsDialog = React.lazy(() => import('../inspector/SelectionEffectsDialog.jsx'));
const EditorDialog = React.lazy(() => import('../dialogs/EditorDialog.jsx'));
const GeneratorDialog = React.lazy(() => import('../dialogs/GeneratorDialog.jsx'));
const NyquistDialog = React.lazy(() => import('../dialogs/NyquistDialog.jsx'));
const SpectralSelectionDialog = React.lazy(() => import('../dialogs/SpectralSelectionDialog.jsx'));
const WorkspacePreferencesDialog = React.lazy(() => import('../dialogs/WorkspacePreferencesDialog.jsx'));

function LazyInspectorFallback({ copy }) {
	return <div className="audio-editor-timeline-loading" role="status" aria-live="polite">{copy.loading}</div>;
}

export default function AudioEditorWorkspaceOverlays({ model }) {
	const {
		activeSurface,
		applicationMenus,
		capabilities,
		closeNyquist,
		controller,
		copy,
		dialog,
		dialogSourceKey,
		dialogValue,
		effectWindow,
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
	return <>

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
							locale={locale}
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
					type={dialog}
					value={dialogValue}
					onValueChange={setDialogValue}
					sourceKey={dialogSourceKey}
					onSourceKeyChange={setDialogSourceKey}
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
