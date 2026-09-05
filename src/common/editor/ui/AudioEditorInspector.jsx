// Compatibility facade for the Inspector features that were split out of this module.
// Every panel is named through a dynamic import, the way the workspace and overlay owners
// already reach them: a static re-export would make all seven optional chunks static
// dependencies of the eagerly loaded `editor-shell` chunk that owns this file.
import { lazyEditorModule } from '../../offline/lazy-module.tsx';

export const AnalysisPanel = lazyEditorModule(() => import('./inspector/AnalysisPanel.jsx'));
export const AudioEditorEffectsOverlay = lazyEditorModule(() => import('./inspector/AudioEditorEffectsOverlay.jsx'));
export const AudioEditorMacroManagerDialog = lazyEditorModule(() => import('./inspector/AudioEditorMacroManagerDialog.jsx'));
export const ClipPropertiesDialog = lazyEditorModule(() => import('./inspector/ClipPropertiesDialog.jsx'));
export const ExportDialog = lazyEditorModule(() => import('./inspector/ExportDialog.jsx'));
export const LabelExportDialog = lazyEditorModule(() => import('./inspector/LabelExportDialog.jsx'));
export const SelectionEffectsDialog = lazyEditorModule(() => import('./inspector/SelectionEffectsDialog.jsx'));
