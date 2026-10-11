/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MOTIONSCAPER_DESKTOP_CHANNELS } from '../desktop/motionscaper-desktop-contract.ts';
import { loadPolicyNarratives } from '../scripts/lib/policy-narratives.mjs';

test('Motion native channels have explicit development authority and derived security evidence', async () => {
	const register = JSON.parse(await readFile(new URL('../config/production-security-matrix.json', import.meta.url), 'utf8')) as {
		risks: readonly { id: string; currentControls: readonly { id: string }[]; developmentControls?: readonly {
			id: string; policyAuthority: string; summary: string; evidence: readonly { kind: string; path: string }[];
		}[] }[];
	};
	const risk = register.risks.find(item => item.id === 'electron-renderer-ipc-boundary'); assert.ok(risk);
	const control = risk.developmentControls?.find(item => item.id === 'isolated-motion-desktop-capabilities'); assert.ok(control);
	assert.equal(control.policyAuthority, 'motionscaper-development');
	assert.equal(risk.currentControls.some(item => item.id === control.id), false);
	for (const channel of Object.values(MOTIONSCAPER_DESKTOP_CHANNELS)) assert.ok(control.summary.includes(channel), channel);
	for (const phrase of ['main-private', '16', 'no payload', 'take', 'acknowledge', 'unqualified']) assert.ok(control.summary.includes(phrase), phrase);
	for (const path of ['desktop/motionscaper-launch-authority.ts', 'desktop/motionscaper-launch-ipc.ts',
		'tests/browser/motionscaper-desktop-launch.spec.ts', 'docs/development/motionscaper-native-launch-qualification.md']) {
		assert.ok(control.evidence.some(item => item.path === path), path);
	}
	for (const item of control.evidence) await access(new URL(`../${item.path}`, import.meta.url));
	const narratives = await loadPolicyNarratives(fileURLToPath(new URL('../', import.meta.url))) as readonly { binding: { marker: string }; rendered: string }[];
	const narrative = narratives.find(item => item.binding.marker === control.id); assert.ok(narrative);
	assert.ok((await readFile(new URL('../docs/policies/security.md', import.meta.url), 'utf8')).includes(narrative.rendered));
});
