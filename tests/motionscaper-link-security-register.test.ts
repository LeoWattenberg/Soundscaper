/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadPolicyNarratives } from '../scripts/lib/policy-narratives.mjs';

test('Motion bridge header exceptions have explicit development authority and derived security evidence', async () => {
	const matrix = JSON.parse(await readFile(new URL('../config/production-security-matrix.json', import.meta.url), 'utf8')) as {
		risks: readonly { id: string; status: string; currentControls: readonly { id: string }[]; developmentControls?: readonly {
			id: string; policyAuthority: string; summary: string; evidence: readonly { kind: string; path: string }[];
		}[] }[];
	};
	const risk = matrix.risks.find(risk => risk.id === 'cross-origin-project-transfer'); assert.ok(risk);
	const control = risk.developmentControls?.find(control => control.id === 'isolated-motion-composition-bridge'); assert.ok(control);
	assert.equal(risk.status, 'partial'); assert.equal(control.policyAuthority, 'motionscaper-framescaper-successor-development');
	assert.equal(risk.currentControls.some(control => control.id === 'isolated-motion-composition-bridge'), false);
	assert.match(control.summary, /\/composition-link\/send\//u); assert.match(control.summary, /\/composition-link\/receive\//u);
	assert.match(control.summary, /same-origin-allow-popups/u); assert.match(control.summary, /unsafe-none/u); assert.match(control.summary, /credentialless/u);
	assert.match(control.summary, /serialized saved updates/u); assert.match(control.summary, /unqualified|unfinished/u);
	assert.match(control.summary, /paired picture\/PCM/u); assert.match(control.summary, /Conform/u);
	assert.match(control.summary, /decoded MP4/u); assert.match(control.summary, /packaged Linux x64/u);
	for (const path of ['tests/browser/motionscaper-linked-editors.spec.ts', 'desktop/motionscaper-successor-native-qualification.ts',
		'src/framescaper/editor-project-successor-portable-publication.ts', 'src/framescaper/editor-composition-link-conform-core.ts']) {
		assert.ok(control.evidence.some(evidence => evidence.path === path), path);
	}
	for (const evidence of control.evidence) {
		assert.ok(['implementation', 'test', 'workflow', 'audit', 'document'].includes(evidence.kind));
		await access(new URL(`../${evidence.path}`, import.meta.url));
	}
	const narratives = await loadPolicyNarratives(fileURLToPath(new URL('../', import.meta.url))) as readonly { binding: { marker: string }; rendered: string }[];
	const narrative = narratives.find(narrative => narrative.binding.marker === control.id); assert.ok(narrative);
	assert.match(narrative.rendered, /same-origin-allow-popups/u);
	const document = await readFile(new URL('../docs/policies/security.md', import.meta.url), 'utf8'); assert.ok(document.includes(narrative.rendered));
});
