/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PrivacyPolicyDialog from '../src/common/editor/ui/dialogs/PrivacyPolicyDialog.tsx';

test('the editor dialog renders the complete localized privacy policy', () => {
	for (const [locale, expected] of [
		['en', ['Privacy Policy', 'Effective', 'Scope and overview', 'Controller and contact']],
		['de', ['Datenschutzerklärung', 'Gültig ab', 'Geltungsbereich und Überblick', 'Verantwortlicher und Kontakt']],
	] as const) {
		const markup = renderToStaticMarkup(<PrivacyPolicyDialog
			locale={locale}
			onClose={() => undefined}
		/>);
		assert.match(markup, /role="dialog"/u);
		assert.match(markup, /data-privacy-policy-dialog="true"/u);
		assert.equal((markup.match(/<section id=/gu) || []).length, 13);
		for (const text of expected) assert.ok(markup.includes(text), `${locale} is missing ${text}`);
		assert.match(markup, /privacy@support\.soundscaper\.org/u);
		assert.match(markup, /Cloudflare/u);
	}
});

test('the Help menu and workspace overlay own the privacy policy instead of opening an external page', async () => {
	const [runtime, overlays] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/workspace/workspace-application-menu-runtime.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8'),
	]);
	assert.match(runtime, /privacyPolicy:\s*\(\)\s*=>\s*openSurface\('privacy-policy'\)/u);
	assert.doesNotMatch(runtime, /privacyPolicy:\s*\(\)\s*=>\s*openExternal/u);
	assert.match(overlays, /activeSurface === 'privacy-policy'/u);
	assert.match(overlays, /PrivacyPolicyDialog/u);
});
