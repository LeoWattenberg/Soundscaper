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
		// The photo shell composes only scalar selection, culling and name demands.
		// Sharing the broad timeline controller owner makes those few imports pull
		// video commands, storage and effect copy into an otherwise isolated shell.
		name: 'editor-photo-library-scalars',
		test: /src[\\/]common[\\/]editor[\\/]controller[\\/]shared[\\/]photo-library-(?:definition-reader|selection-v1|culling-v1|import-gesture-v1)\.ts$/,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// This inert validator has no domain imports. Both product domains and
		// generic image presentation can share it without acquiring each other.
		name: 'editor-closed-domain-values',
		test: /src[\\/]common[\\/]editor[\\/]closed-domain-value\.ts$/,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Presentation is reached only after the optional photo preview is opened.
		// Keep its body/canvas owner apart from the scalar bootstrap controller.
		name: 'editor-pixel-preview-presentation',
		test: /src[\\/]common[\\/]editor[\\/]controller[\\/]shared[\\/]pixel-preview-presentation-v1\.ts$/,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'lightscaper-editor-copy',
		test: /src[\\/]common[\\/](?:i18n[\\/]lightscaper-editor-copy\.ts|editor[\\/]ui[\\/]lightscaper[\\/]use-lightscaper-editor-copy\.ts)$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
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
