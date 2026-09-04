/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const COMPONENT_DIRECTORIES = [
	'src/common/editor/ui/dialogs/',
	'src/common/editor/ui/inspector/',
	'src/common/editor/ui/workspace/',
];

/**
 * Every dialog that confirms or dismisses through a row of buttons renders that
 * row with the design-system footer, handed to `AudioEditorDialogShell`'s
 * `footer` slot. The slot matters as much as the component: the shell renders it
 * as a sibling of the body, so a row built inside `children` scrolls away with
 * the content and misses the footer's bar, border and inset entirely.
 */
const FOOTER_SLOT = /\n\s*footer=\{(?:.|\n){0,400}?<(?<element>[\w.]+)/u;
const FOOTER_CLASS = /className="(?:[^"]*\s)?audio-editor-dialog-footer(?:\s[^"]*)?"/u;

const DIALOGS_WITH_A_CONFIRM_ROW = Object.freeze([
	'dialogs/EditorDialog.jsx',
	'dialogs/FramescaperFinishingDialog.tsx',
	'dialogs/FramescaperVisualInspectorDialog.tsx',
	'dialogs/GeneratorDialog.jsx',
	'dialogs/ImportAnalysisDialogs.tsx',
	'dialogs/LocalAssistanceDialog.tsx',
	'dialogs/LocalDiagnosticsDialog.tsx',
	'dialogs/LocalModelManagerDialog.tsx',
	'dialogs/MixRenderDialog.tsx',
	'dialogs/NyquistDialog.jsx',
	'dialogs/PrivacyPolicyDialog.tsx',
	'dialogs/SpectralSelectionDialog.jsx',
	'dialogs/TakeCompDialog.tsx',
	'dialogs/TakeCycleRecoveryDialog.tsx',
	'dialogs/WorkspacePreferencesDialog.jsx',
	'inspector/AudioEditorMacroManagerDialog.jsx',
	'inspector/ClipPropertiesDialog.jsx',
	'inspector/ClipResampleDialog.jsx',
	'inspector/DeliveryQueueDialog.jsx',
	'inspector/EffectPicker.jsx',
	'inspector/EffectPresetBar.jsx',
	'inspector/ExportChannelMappingDialog.tsx',
	'inspector/ExportDialog.jsx',
	'inspector/ExportDialogMetadataPanel.jsx',
	'inspector/LabelExportDialog.jsx',
	'inspector/SelectionEffectsDialog.jsx',
	'inspector/VideoCompositionDialog.tsx',
	'workspace/ScapeOpenDecisionDialog.jsx',
]);

test('every dialog with a confirm row renders it through the shared footer', async () => {
	const missing: string[] = [];
	for (const relative of DIALOGS_WITH_A_CONFIRM_ROW) {
		const source = await readFile(new URL(`src/common/editor/ui/${relative}`, ROOT), 'utf8');
		const slot = FOOTER_SLOT.exec(source);
		if (slot?.groups?.element !== 'DialogFooter') {
			missing.push(`${relative}: the shell's footer slot holds ${slot?.groups?.element ?? 'nothing'}`);
		} else if (!FOOTER_CLASS.test(source)) {
			missing.push(`${relative}: the footer misses the audio-editor-dialog-footer class`);
		}
	}
	assert.deepEqual(missing, []);
});

test('no dialog hands the shell a hand-rolled action row instead of the footer', async () => {
	const handRolled: string[] = [];
	for (const directory of COMPONENT_DIRECTORIES) {
		const base = new URL(directory, ROOT);
		for (const entry of await readdir(base)) {
			if (!/\.(?:tsx|jsx)$/u.test(entry)) continue;
			const source = await readFile(new URL(entry, base), 'utf8');
			const slot = FOOTER_SLOT.exec(source);
			if (slot && slot.groups?.element !== 'DialogFooter') {
				handRolled.push(`${directory}${entry}: <${slot.groups?.element}`);
			}
		}
	}
	assert.deepEqual(handRolled, [], 'a footer slot must hold a DialogFooter, not a bare element');
});

/**
 * `.kw-audio-editor-dialog__actions` survives as an in-body right-aligned
 * cluster for panel and list-row controls. It must never come back as a
 * dialog's own confirm row, which is what the shared footer is for.
 */
test('the in-body action-row class never reaches a footer slot', async () => {
	for (const directory of COMPONENT_DIRECTORIES) {
		const base = new URL(directory, ROOT);
		for (const entry of await readdir(base)) {
			if (!/\.(?:tsx|jsx)$/u.test(entry)) continue;
			const source = await readFile(new URL(entry, base), 'utf8');
			assert.doesNotMatch(
				source,
				/footer=\{[^}]*kw-audio-editor-dialog__actions/u,
				`${directory}${entry} passes the in-body action row into the footer slot`,
			);
		}
	}
});

/**
 * The site's stale-build prompt is the one deliberate exemption. It is mounted
 * by the site shell to survive an editor chunk that failed to load, so it may
 * not import the shell or the design system at all; it right-aligns its own
 * buttons in `site.css` instead.
 */
test('the stale-build prompt stays independent of the editor dialog chunk', async () => {
	const [dialog, css] = await Promise.all([
		readFile(new URL('src/common/site/StaleBuildDialog.jsx', ROOT), 'utf8'),
		readFile(new URL('src/common/site/site.css', ROOT), 'utf8'),
	]);
	assert.doesNotMatch(dialog, /@soundscaper\/design-system/u);
	assert.doesNotMatch(dialog, /AudioEditorDialogShell/u);
	assert.match(css, /\.stale-build-actions \{[^}]*justify-content: flex-end;/u);
});

/**
 * Right alignment and the inset around the buttons are the footer's own job, so
 * they are asserted once here rather than per dialog.
 */
test('the shared footer right-aligns its buttons and insets them', async () => {
	const [vendored, overrides] = await Promise.all([
		readFile(new URL('vendor/audacity-design-system/components/src/Footer/Footer.css', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/audio-editor-design-system/10-effects-vendor-overrides.css', ROOT), 'utf8'),
	]);
	assert.match(vendored, /\.footer \{[^}]*padding: 8px;/u);
	assert.match(vendored, /\.footer__button-group \{[^}]*margin-left: auto;/u);
	assert.match(vendored, /\.footer__button-group \{[^}]*gap: 8px;/u);
	assert.match(
		overrides,
		/\.audio-editor-dialog-footer \.footer__button-group \{[^}]*justify-content: flex-end;/u,
		'a wrapped footer row must still hold its buttons against the right edge',
	);
	assert.match(
		overrides,
		/\.audio-editor-dialog-footer \{[^}]*flex-wrap: wrap;/u,
		'a dialog with several actions must wrap rather than overflow its panel',
	);
});
