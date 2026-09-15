/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STYLES = new URL('../src/common/editor/ui/audio-editor-design-system/', import.meta.url);
const DIALOGS = new URL('../src/common/editor/ui/dialogs/', import.meta.url);

function rule(css, selector) {
	const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)];
	const match = rules.find(([, selectors]) => selectors.trim().endsWith(selector));
	assert.ok(match, `a style rule exists for ${selector}`);
	return match[2];
}

function assertFlatSection(declarations) {
	for (const [, background] of declarations.matchAll(/background(?:-color)?:\s*([^;]+);/gu)) {
		assert.equal(background.trim(), 'transparent');
	}
	assert.doesNotMatch(declarations, /border:\s*1px solid/u);
	assert.doesNotMatch(declarations, /border-radius:\s*[1-9]/u);
}

test('dialog preference sections show their separator lines without inset cards', async () => {
	const [dialogs, preferences, appearance] = await Promise.all([
		readFile(new URL('11-panels-dialogs-generators.css', STYLES), 'utf8'),
		readFile(new URL('12-dialogs-preferences-responsive.css', STYLES), 'utf8'),
		readFile(new URL('AppearancePreferencesPage.jsx', DIALOGS), 'utf8'),
	]);
	const section = rule(dialogs, '.kw-audio-editor-dialog .preference-panel');
	assert.match(section, /background:\s*transparent;/u);
	assert.match(section, /border:\s*0;/u);
	assert.match(section, /padding:\s*0;/u);
	assert.match(appearance, /<\/PreferencePanel>\s*<Separator\s*\/>/u);
	assert.match(rule(preferences, '.kw-audio-editor-preferences__page'), /background:\s*var\(--panel\);/u,
		'flattened sections expose the dialog surface behind unchecked boxes');
	for (const selector of [
		'.kw-audio-editor-preferences__checks .labeled-checkbox',
		'.kw-audio-editor-preferences__toolbar-list > div',
		'.kw-audio-editor-preferences__panel-list > div',
	]) assertFlatSection(rule(preferences, selector));
});

test('supplemental export fields and processing summaries use flat sections', async () => {
	const [exports, processing, models] = await Promise.all([
		readFile(new URL('10b-dialog-export.css', STYLES), 'utf8'),
		readFile(new URL('ProcessingDialogs.css', DIALOGS), 'utf8'),
		readFile(new URL('LocalModelManagerDialog.css', DIALOGS), 'utf8'),
	]);
	for (const selector of [
		'.audio-editor-label-export-dialog__tracks',
		'.audio-editor-export-details',
	]) assertFlatSection(rule(exports, selector));
	const summary = rule(processing, '.kw-processing-details');
	assertFlatSection(summary);
	assert.match(summary, /border-block-start:\s*1px solid var\(--line\);/u);
	assertFlatSection(rule(processing, '.kw-local-assistance__guided-settings-controls'));
	assertFlatSection(rule(models, '[data-local-model-manager] .kw-local-model-manager__notices'));
});

test('effect sections keep inset styling only for knob groups', async () => {
	const css = await readFile(new URL('09-dialogs-effects.css', STYLES), 'utf8');
	assertFlatSection(rule(css, ':is(.audio-editor-audacity-layout__card, .audio-editor-audacity-layout__context-card)'));
	const knobs = rule(css, '.audio-editor-audacity-layout__card--knobs');
	assert.match(knobs, /padding:\s*12px;/u);
	assert.match(knobs, /background:\s*var\(--panel\);/u);
	assert.match(knobs, /border:\s*1px solid var\(--line\);/u);
});

test('plain dialog fieldsets and clip settings have separators without overriding effect groups', async () => {
	const css = await readFile(new URL('11-panels-dialogs-generators.css', STYLES), 'utf8');
	const fieldset = rule(css, ':where(.kw-audio-editor-dialog) fieldset');
	assertFlatSection(fieldset);
	assert.match(fieldset, /border:\s*0;/u);
	assert.match(fieldset, /border-block-start:\s*1px solid var\(--line\);/u);
	assert.match(fieldset, /padding:\s*12px 0;/u);
	assert.match(rule(css, ':where(.kw-audio-editor-dialog) legend'), /padding:\s*0;/u);
	const nyquist = rule(css, '.kw-audio-editor__nyquist-controls');
	assert.match(nyquist, /border:\s*1px solid var\(--line\);/u);
	assert.match(nyquist, /padding:\s*12px;/u);
	assertFlatSection(rule(css, '.kw-audio-editor-dialog .audio-editor-clip-properties__card'));
});

test('export ADM sections are flat while the project inspector keeps its own grouping', async () => {
	const css = await readFile(new URL('15-adm.css', STYLES), 'utf8');
	const sections = rule(css, '.kw-audio-editor-dialog :is(.audio-editor-adm-routing, .audio-editor-adm-objects)');
	assertFlatSection(sections);
	assert.match(sections, /border:\s*0;/u);
	assert.match(sections, /border-block-start:\s*1px solid var\(--line\);/u);
	assert.match(rule(css, '.audio-editor-adm-routing'), /border:\s*1px solid var\(--line\);/u);
	assert.match(rule(css, '.audio-editor-adm-objects'), /border:\s*1px solid var\(--line\);/u);
});
