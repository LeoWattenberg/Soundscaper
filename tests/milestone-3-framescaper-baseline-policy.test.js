/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('Milestone 3 behavior is folded into direct Framescaper family-v1 authority', async () => {
	const register = await json('config/project-compatibility.json');
	const rules = new Map(register.rules.map((rule) => [rule.id, rule]));
	for (const [id, claim] of [
		['family-v1-product-isolation', /direct unversioned bootstraps, controllers, domains, stores, and desktop libraries/iu],
		['framescaper-v1-nested-sequence-native', /family-v1 sequence domain.*bounded depth.*cycles.*aliases/iu],
		['framescaper-v1-multicamera-native', /family-v1 sequence domain.*multicamera groups.*source timing/iu],
		['framescaper-v1-video-proxy-preservation', /family v1 validates proxy attachments.*format 1.*pre-release format 2 requires re-import/iu],
	]) {
		const rule = rules.get(id);
		assert.ok(rule, id);
		assert.equal(rule.status, 'implemented', id);
		assert.match(rule.currentBehavior, claim, id);
		assert.equal(rule.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
		for (const reference of rule.evidence) await evidenceExists(reference);
	}
	assert.doesNotMatch(JSON.stringify(register.rules.map(({ id, requiredOutcome, currentBehavior }) => ({ id, requiredOutcome, currentBehavior }))), /\bF(?:18|2\d|3[0-2])\b/u);
});

test('security selects family-v1 admission and desktop isolation', async () => {
	const security = await json('config/production-security-matrix.json');
	const risks = new Map(security.risks.map((risk) => [risk.id, risk]));
	for (const [riskId, controlId, claim] of [
		['external-project-document-validation', 'framescaper-v1-editorial-document-admission', /schemaFamily.*framescaper.*schemaVersion.*1.*direct unversioned domain validators/iu],
		['external-media-parser-bounds', 'framescaper-v1-proxy-reattestation', /originals as authority.*proxy\/timing pair.*current source/iu],
		['shared-desktop-project-library-integrity', 'framescaper-v1-desktop-isolation', /FSCP.*user_version 1.*framescaper-project-library\/v1/iu],
		['shared-desktop-project-library-integrity', 'family-v1-desktop-library-isolation', /Soundscaper and Framescaper.*family-v1 handshakes.*user_version 1/iu],
	]) {
		const control = risks.get(riskId)?.currentControls.find(({ id }) => id === controlId);
		assert.ok(control, `${riskId}/${controlId}`);
		assert.match(control.summary, claim);
		assert.equal(control.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
		for (const reference of control.evidence) await evidenceExists(reference.path);
	}
});

test('historical Milestone 3 prose remains provenance while stable qualification stays open', async () => {
	const [roadmap, plan, verification] = await Promise.all([
		text('roadmap.md'),
		text('docs/milestones-1-to-4-activation-plan.md'),
		text('docs/milestone-9-guided-verification.md'),
	]);
	assert.match(roadmap, /Milestone 3.*Status:.*In progress/isu);
	assert.match(plan, /Milestone 3/iu);
	assert.match(verification, /Generate a proxy.*cancel generation.*regenerate.*detach.*relink/isu);
	assert.match(verification, /Stable 1\.0 release conclusion \| pending/iu);

	const matrix = await json('config/milestone-3-timing-probe-matrix.json');
	assert.deepEqual(new Set(matrix.electronRows.map(({ status }) => status)), new Set(['pending-external']));
	const compatibility = await json('config/project-compatibility.json');
	assert.equal(compatibility.rules.find(({ id }) => id === 'current-desktop-electron-lease-protections').status, 'partial');
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}

async function evidenceExists(reference) {
	const [path] = reference.split('#');
	await assert.doesNotReject(access(new URL(path, root)), `missing evidence ${reference}`);
}
