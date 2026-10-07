/* SPDX-License-Identifier: AGPL-3.0-only */

import { editorOptionalSurfaceModule, editorPath } from './build-chunk-tests.mjs';

// The dialog lifecycle is shared by all products. Giving its complete neutral
// closure one owner keeps optional photo dialogs out of the timeline shell,
// whose theme provider may otherwise acquire a privacy-route initialization
// back-edge through the reachability-placed musical time-code context.
export const EDITOR_DIALOG_FOUNDATION_CHUNK_TEST = /(?:src[\\/]common[\\/]editor[\\/]ui[\\/](?:AudioEditorDialogShell\.tsx|AudioEditorResizableSurface\.jsx|dialog-(?:escape-ownership|focus-ownership|drag-bounds|move-lifecycle)\.ts|focus-restoration\.ts|resizable-surface-mouse-lifecycle\.ts)$|(?:^|[\\/])vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/]DialogHeader[\\/])/;

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const editorUiChunkGroups = [
	{
		name: 'editor-dialog-foundations',
		test: EDITOR_DIALOG_FOUNDATION_CHUNK_TEST,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-shell',
		test: new RegExp(`(?:${editorPath}(?!${editorOptionalSurfaceModule}$)ui[\\\\/](?!(?:lightscaper[\\\\/]|dialogs[\\\\/](?!(?:editor-dialog-model\\.js|AssistanceLoadingDialog\\.tsx)$)|inspector[\\\\/]))|src[\\\\/]common[\\\\/](?:products\\.js|url\\.ts)$|src[\\\\/]common[\\\\/]offline[\\\\/](?:file-handler-launch|install-prompt|share-target-launch)\\.ts$|src[\\\\/]soundscaper[\\\\/](?:editor-capture-toolbar-control|editor-framescaper-overlay-model|editor-video-preview-product-runtime|editor-application-menu-product-runtime|editor-workspace-application-menu-runtime|editor-workspace-panel-runtime)\\.(?:js|tsx?)$|src[\\\\/]framescaper[\\\\/]editor-soundscaper-workflow-product-runtime\\.tsx$)`),
		priority: 70,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
];
