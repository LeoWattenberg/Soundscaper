/* SPDX-License-Identifier: AGPL-3.0-only */

import { editorOptionalSurfaceModule, editorPath } from './build-chunk-tests.mjs';
import { mediaRetentionChunkGroups } from './build-chunk-media-retention.mjs';
import { fileSavingChunkGroups } from './build-chunk-file-saving.mjs';

// The dialog lifecycle is shared by all products. Giving its complete neutral
// closure one owner keeps optional photo dialogs out of the timeline shell,
// whose theme provider may otherwise acquire a privacy-route initialization
// back-edge through the reachability-placed musical time-code context.
export const EDITOR_DIALOG_FOUNDATION_CHUNK_TEST = /(?:src[\\/]common[\\/]editor[\\/]ui[\\/](?:AudioEditorDialogShell\.tsx|AudioEditorResizableSurface\.jsx|dialog-(?:escape-ownership|focus-ownership|drag-bounds|move-lifecycle)\.ts|file-input-selection\.ts|focus-restoration\.ts|resizable-surface-mouse-lifecycle\.ts)$|(?:^|[\\/])vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/]DialogHeader[\\/])/;

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const editorUiChunkGroups = [
	...mediaRetentionChunkGroups,
	...fileSavingChunkGroups,
	{
		// IDs, safe text, cancellation, ordering, worker lifetimes, file failures
		// and the archive limit share no product domain imports. One neutral owner
		// avoids timeline passengers and preserves startup request ceilings.
		name: 'editor-neutral-foundations',
		test: /src[\\/]common[\\/]editor[\\/](?:platform[\\/]bounded-transfer\.ts|(?:abort-error|abort-race|code-unit-order|error-diagnostic-message|image-export-graphic-request|image-export-text-v1|native-media-plan-canonical-form|photo-library-develop-(?:(?:proxy|original|full-resolution)-port-v1|proxy-port-v2)|photo-library-saved-collection-port-v1|safe-visual-text|scape-archive-limits|scape-blob-budget|scape-project-format|web-file-limit-failure|worker-error-transport|worker-protocol|worker-request-broker)\.ts|stable-id\.js)$/,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// The photo shell composes scalar selection, culling, review and name demands.
		// Sharing the broad timeline controller owner makes those few imports pull
		// video commands, storage and effect copy into an otherwise isolated shell.
		name: 'editor-photo-library-scalars',
		test: /src[\\/]common[\\/]editor[\\/]controller[\\/]shared[\\/]photo-library-(?:definition-reader|develop-command(?:-v2)?|develop-workflow-v[12]|develop-settings-intent(?:-v2)?|develop-settings-workflow-v[12]|selection-v1|culling-v1|compare-v1|survey-v1|import-gesture-v1|backup-save-v1|original-recovery-v1|restore-v1|workflow-slot(?:-v2)?|query-navigation|saved-command)\.ts$/,
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
		// Presentation is reached only after an optional photo or Frame preview opens.
		// Keep its body/canvas owner apart from the scalar bootstrap controller.
		name: 'editor-pixel-preview-presentation',
		test: /src[\\/]common[\\/]editor[\\/](?:controller[\\/]shared[\\/](?:pixel-preview-presentation-v1|photo-library-develop-presentation-v[12]|image-develop-draft-presentation-v1|image-brush-mask-authoring-v1|photo-library-brush-mask-authoring-v1|(?:image|photo-library)-repair-spots-authoring-v1|internal[\\/]image-repair-spots-authoring-kernel-v1)|imaging[\\/]photo-develop-display-frame-v1|photo-develop-mask-display-v1|image-brush-mask-resource-port-v1)\.ts$/,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Text controls and full glyph copy stay behind the existing export menus.
		name: 'editor-export-text-dialog',
		test: /src[\\/]common[\\/](?:i18n[\\/]image-export-text-copy\.ts|editor[\\/]ui[\\/]PhotoTextWatermarkFields\.tsx)$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Full shared watermark presentation is reached through the export dialogs.
		name: 'editor-export-graphic-dialog',
		test: /src[\\/]common[\\/](?:i18n[\\/]image-export-graphic-copy\.ts|editor[\\/]ui[\\/]GraphicWatermarkFields\.tsx)$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'lightscaper-editor-copy',
		test: /src[\\/]common[\\/](?:i18n[\\/]lightscaper-(?:editor|develop-menu|photo-(?:(?:png|jpeg)-export-menu|framescaper-handoff-menu)|metadata-query|saved-filter|restore)-copy\.ts|editor[\\/]ui[\\/]lightscaper[\\/]use-lightscaper-editor-copy\.ts)$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'lightscaper-photo-batch-export-menu-copy',
		test: /src[\\/]common[\\/]i18n[\\/]lightscaper-photo-batch-export-menu-copy\.ts$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Full editable-copy guidance is loaded only with the File Photo dialog.
		name: 'lightscaper-photo-framescaper-handoff-copy',
		test: /src[\\/]common[\\/]i18n[\\/]lightscaper-photo-framescaper-handoff-copy\.ts$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Reusable export settings copy stays behind the existing menu-opened dialog.
		name: 'lightscaper-photo-export-presets-copy',
		test: /src[\\/]common[\\/]i18n[\\/]lightscaper-photo-export-presets-copy\.ts$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'lightscaper-photo-batch-export-copy',
		test: /src[\\/]common[\\/]i18n[\\/]lightscaper-photo-batch-export-copy\.ts$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'lightscaper-photo-jpeg-export-copy',
		test: /src[\\/]common[\\/]i18n[\\/]lightscaper-photo-jpeg-export-copy\.ts$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// The full export dialog labels stay behind its menu-opened lazy entry.
		// Only the small menu label belongs to ordinary photo shell copy.
		name: 'lightscaper-photo-png-export-copy',
		test: /src[\\/]common[\\/]i18n[\\/]lightscaper-photo-png-export-copy\.ts$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Develop and import presets read these labels only after their surfaces open.
		// Co-owning them with the ordinary photo catalog would preload visual copy.
		name: 'lightscaper-develop-copy',
		test: /src[\\/]common[\\/]i18n[\\/]lightscaper-develop(?:-settings)?-copy\.ts$/,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Both photo and timeline surfaces read this inert shared label table.
		// The complete timeline copy owner also contains unrelated audio catalogs.
		name: 'editor-visual-effect-copy',
		test: /src[\\/]common[\\/]i18n[\\/]video-effect-copy\.js$/,
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
