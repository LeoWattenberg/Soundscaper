/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('selected V28 retains V18 editorial foundations and completes the V14 proxy carrier route', async () => {
	const register = await json('config/project-compatibility.json');
	const rules = new Map(register.rules.map((rule) => [rule.id, rule]));
	assert.equal(rules.size, register.rules.length, 'compatibility rule IDs must remain unique');

	const expected = new Map([
		['framescaper-v18-product-isolation', [
			/selected exact V28.*library V19.*Soundscaper.*project V29.*desktop library V11/isu,
			/V20 through V24.*historical reimport.*V25 and V26.*opaque read-only/isu,
		]],
		['framescaper-v18-nested-sequence-native', [
			/subsequence.*menu/isu,
			/playback.*delivery/isu,
			/copy-only preservation/isu,
		]],
		['framescaper-v18-multicamera-native', [
			/sample-canonical/isu,
			/exact CFR.*verified.*VFR/isu,
			/playback.*delivery/isu,
		]],
		['framescaper-v18-video-proxy-preservation', [
			/format 2.*desktop library V19/isu,
			/Selected V28 reaches generation, attach, detach, relink, regenerate/isu,
			/Original, Proxy, or Auto.*lazy menu dialog/isu,
			/source domain before occurrence retime.*delivery.*authenticated original/isu,
		]],
	]);
	for (const [id, claims] of expected) {
		const rule = rules.get(id);
		assert.ok(rule, `missing ${id}`);
		assert.equal(rule.status, 'implemented', id);
		for (const claim of claims) assert.match(rule.currentBehavior, claim, id);
		for (const reference of rule.evidence) await evidenceExists(reference);
	}
	assert.ok(rules.get('framescaper-v18-nested-sequence-native').evidence.includes(
		'tests/browser/framescaper-v18-nested-authoring.spec.js',
	));
	assert.ok(rules.get('framescaper-v18-multicamera-native').evidence.includes(
		'tests/browser/framescaper-v18-multicamera.spec.js',
	));
	const proxyPreservation = rules.get('framescaper-v18-video-proxy-preservation');
	assert.doesNotMatch(proxyPreservation.currentBehavior,
		/delete and duplicate remain fail-closed/iu);
	assert.match(proxyPreservation.currentBehavior,
		/desktop library V19.*delete.*duplicate.*main-first.*(?:CAS|compare-and-swap)/isu);
	assert.match(proxyPreservation.currentBehavior,
		/retains immutable.*(?:revisions|bodies).*no physical reclamation.*never reuses.*project ID/isu);
	assert.match(proxyPreservation.currentBehavior,
		/package.*source-free.*does not qualify.*delete.*duplicate/isu);

	const proxyUse = rules.get('video-proxy-fallback');
	assert.equal(proxyUse.status, 'implemented');
	// The proxy is generated, invalidated with the source it stands in for, and
	// re-proved before every preview, while the original stays authoritative for
	// export and delivery. What is still missing is a surface to reach it from.
	assert.match(proxyUse.currentBehavior, /originals remain authoritative/isu);
	assert.match(proxyUse.currentBehavior, /reattests each session/isu);
	assert.match(proxyUse.currentBehavior, /source domain before (?:an )?occurrence retime(?: curve)?/isu);
	assert.match(proxyUse.currentBehavior, /retiming does not detach/isu);
	assert.match(proxyUse.currentBehavior, /drops? stale state in the same transaction/isu);
	assert.match(proxyUse.currentBehavior, /generation, attach existing, detach, relink, regenerate/isu);
	assert.match(proxyUse.currentBehavior, /Auto adapts.*preview pressure/isu);
	assert.match(proxyUse.currentBehavior, /delivery.*refuse.*unavailable/isu);
});

test('production capability and security registers select only executable V28 surfaces', async () => {
	const capabilities = await json('config/production-capabilities.json');
	assert.equal(capabilities.products.soundscaper.projectFeatures.nestedSequences, false);
	assert.equal(capabilities.products.soundscaper.projectFeatures.multicamera, false);
	assert.equal(capabilities.products.framescaper.projectFeatures.nestedSequences, true);
	assert.equal(capabilities.products.framescaper.projectFeatures.multicamera, true);
	assert.equal(Object.hasOwn(capabilities.products.framescaper.projectFeatures, 'videoProxy'), false);

	const security = await json('config/production-security-matrix.json');
	const risks = new Map(security.risks.map((risk) => [risk.id, risk]));
	const projectAdmission = control(risks, 'external-project-document-validation',
		'framescaper-v18-editorial-document-admission');
	assert.match(projectAdmission.summary, /profile.*before.*travers/isu);
	assert.match(projectAdmission.summary, /schema 28.*unified exact V14/isu);
	assert.match(projectAdmission.summary, /V20 retime\/proxy.*V22 dissolve.*V24 visual/isu);
	assert.match(projectAdmission.summary, /desktop-library V19.*user_version 21.*scope v19/isu);
	assert.match(projectAdmission.summary, /Soundscaper.*project V29.*desktop library V11/isu);

	const proxyAdmission = control(risks, 'external-media-parser-bounds',
		'framescaper-v18-proxy-reattestation');
	assert.match(proxyAdmission.summary, /bounded.*digest.*timing/isu);
	assert.match(proxyAdmission.summary, /preview-only/isu);
	assert.match(proxyAdmission.summary, /export.*delivery.*original/isu);

	const historicalDesktop = control(risks, 'shared-desktop-project-library-integrity',
		'framescaper-v18-desktop-v10-isolation');
	assert.match(historicalDesktop.summary, /V10.*schema 18.*Framescaper/isu);
	assert.match(historicalDesktop.summary, /unselected compatibility-boundary/isu);
	const selectedDesktop = control(risks, 'shared-desktop-project-library-integrity',
		'framescaper-v20-desktop-v17-isolation');
	assert.match(selectedDesktop.summary, /desktop-library V19.*project schema 28.*user_version 21.*scope v19/isu);
	assert.match(selectedDesktop.summary, /V18.*read-only.*V27.*reimports.*V28.*resumes idempotently/isu);

	for (const item of [projectAdmission, proxyAdmission, historicalDesktop, selectedDesktop]) {
		for (const reference of item.evidence) await evidenceExists(reference.path);
	}
});

test('milestone narratives report local V27 activation without closing external qualification', async () => {
	const roadmap = await text('roadmap.md');
	assert.match(roadmap, /Milestone 3.*Status:.*In progress/isu);
	assert.match(roadmap, /Selected V27.*set\/reset.*constant.*ramp.*reverse.*freeze.*Edit menu/isu);
	assert.match(roadmap, /exact ordinal authority.*preview.*browser export.*NTSC.*verified VFR/isu);
	assert.match(roadmap, /proxy\s+lifecycle.*generation, attach, detach, relink.*Original\/Proxy\/Auto.*offline editing.*atomic cleanup/isu);
	assert.match(roadmap, /fixed-GPU, Safari, Windows, signing.*external.*remain/isu);

	const plan = await text('docs/milestones-1-to-4-activation-plan.md');
	assert.match(plan, /Milestone 3 — V20 retime and proxy activation/iu);
	assert.match(plan, /Proxy selection occurs in the source domain.*occurrence retime/isu);
	assert.match(plan, /Framescaper V27.*does not inherit V25\/V26/isu);
	const verification = await text('docs/milestones-1-to-4-guided-verification.md');
	assert.match(verification, /Generate a proxy.*cancel generation.*regenerate.*detach.*relink/isu);
	assert.match(verification, /Verifier conclusion \| pending/iu);
});

test('milestone 3 closure blockers remain explicit and unpromoted', async () => {
	const matrix = await json('config/milestone-3-timing-probe-matrix.json');
	assert.equal(matrix.electronRows.length, 4);
	assert.deepEqual(new Set(matrix.electronRows.map(({ status }) => status)), new Set(['pending-external']));

	const budgets = await json('config/quality-budgets.json');
	const ownerHost = byId(budgets.environments, 'owner-qualified-windows-x64-rtx3090-01');
	assert.equal(ownerHost.status, 'unprovisioned');
	assert.ok(ownerHost.eligibleWorkloadIds.includes('m3-longform-editorial'));
	const m3Profile = budgets.packagedRuntimeQualification.profiles.find(
		({ diagnosticKey }) => diagnosticKey === 'm3-longform-editorial',
	);
	assert.equal(m3Profile.status, 'pending-external');
	assert.equal(m3Profile.environmentId, 'owner-qualified-windows-x64-rtx3090-01');
	assert.equal(byId(budgets.fixtures, 'm3-longform-editorial-2h-v1').status, 'provisional');
	assert.equal(byId(budgets.workloads, 'm3-longform-editorial').status, 'provisional');

	const compatibility = await json('config/project-compatibility.json');
	assert.equal(byId(compatibility.rules, 'current-desktop-electron-lease-protections').status, 'partial');
	for (const path of [
		'docs/milestone-3b-native-video-retime-workflow.md',
		'docs/milestone-3b-video-retime-export-plan.md',
	]) assert.match(await text(path), /hard-stop|hard stop|hard-stopped/iu, path);
});

function control(risks, riskId, controlId) {
	const risk = risks.get(riskId);
	assert.ok(risk, `missing ${riskId}`);
	const result = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(result, `missing ${riskId}/${controlId}`);
	return result;
}

function byId(values, id) {
	const result = values.find((value) => value.id === id);
	assert.ok(result, `missing ${id}`);
	return result;
}

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
