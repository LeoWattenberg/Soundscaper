/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('Framescaper V18 editorial compatibility claims match maintained scope', async () => {
	const register = await json('config/project-compatibility.json');
	const rules = new Map(register.rules.map((rule) => [rule.id, rule]));
	assert.equal(rules.size, register.rules.length, 'compatibility rule IDs must remain unique');

	const expected = new Map([
		['framescaper-v18-product-isolation', [
			/exact.*Framescaper.*V18.*Soundscaper.*V17/isu,
			/desktop.*V10/isu,
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
			/format 2.*desktop V10/isu,
			/Generation, retention-by-invalidation, and preview consumption are maintained/isu,
			/attach and detach are not yet menu-reached/isu,
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
		/desktop V10.*delete.*duplicate.*main-first.*(?:CAS|compare-and-swap)/isu);
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
	assert.match(proxyUse.currentBehavior, /re-attests every session/isu);
	assert.match(proxyUse.currentBehavior, /drop it in the same transaction/isu);
	assert.match(proxyUse.currentBehavior, /attach and detach are not yet menu-reached/isu);
});

test('production capability and security registers describe only the qualified V18 surfaces', async () => {
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
	assert.match(projectAdmission.summary, /nested.*multicamera.*owned requirement/isu);
	assert.match(projectAdmission.summary, /copy-only.*Soundscaper/isu);

	const proxyAdmission = control(risks, 'external-media-parser-bounds',
		'framescaper-v18-proxy-reattestation');
	assert.match(proxyAdmission.summary, /bounded.*digest.*timing/isu);
	assert.match(proxyAdmission.summary, /preview-only/isu);
	assert.match(proxyAdmission.summary, /export.*delivery.*original/isu);

	const desktop = control(risks, 'shared-desktop-project-library-integrity',
		'framescaper-v18-desktop-v10-isolation');
	assert.match(desktop.summary, /V10.*schema 18.*Framescaper/isu);
	assert.match(desktop.summary, /proxy.*timing.*body/isu);
	assert.match(desktop.summary, /delete.*duplicate.*main-first.*compare-and-swap/isu);
	assert.match(desktop.summary, /delete-intent.*(?:restart|resumes).*shadow.*binding/isu);
	assert.match(desktop.summary, /does not durably capture.*locator.*crash-.*power-loss.*unqualified/isu);
	assert.match(desktop.summary, /no physical reclamation.*never reuses.*project ID/isu);
	assert.match(desktop.summary, /ambiguous IPC.*authoritative/isu);
	assert.match(desktop.summary, /Windows x64.*Linux x64.*pending-external/isu);
	assert.match(desktop.summary, /unselected compatibility-boundary.*No current packaged route.*delete or duplicate.*remain unqualified/isu);

	for (const item of [projectAdmission, proxyAdmission, desktop]) {
		for (const reference of item.evidence) await evidenceExists(reference.path);
	}
});

test('milestone narratives report implemented V18 slices without closing milestone 3', async () => {
	const roadmap = await text('roadmap.md');
	assert.match(roadmap, /Milestone 3.*Status:.*In progress/isu);
	assert.match(roadmap, /nested sequences.*Implemented/isu);
	assert.match(roadmap, /multicamera.*Implemented/isu);
	assert.match(roadmap, /proxy.*preservation.*implemented/isu);
	assert.match(roadmap, /capture-only.*post-commit.*generation/isu);
	assert.match(roadmap, /general user-invoked editorial generator.*unavailable/isu);
	assert.match(roadmap, /milestone-5 exact ordinal oracle.*native execution validation.*V20 still lacks retime\s+authoring.*videoRetime.*unavailable/isu);
	assert.doesNotMatch(roadmap, /maintained retime workflows, nested sequences, subsequence time mapping, and\s+flattening remain later slices/iu);
	assert.doesNotMatch(roadmap, /no selector, proxy behavior, capability flip, or Soundscaper change is authorized/iu);

	const packets = await text('docs/milestone-3b-work-packets.md');
	assert.match(packets, /3B-5.*nested sequence.*implemented/isu);
	assert.match(packets, /3B-6.*multicamera.*implemented/isu);
	assert.match(packets, /3B-6.*proxy.*preservation.*implemented/isu);
	assert.match(packets, /3B-6.*generation.*proxy-consuming.*unavailable/isu);

	const isolation = await text('docs/milestone-3b-framescaper-v18-product-isolation.md');
	assert.match(isolation, /production selection.*implemented/iu);
	assert.doesNotMatch(isolation, /Contract only — production selection is not authorized/iu);
	assert.doesNotMatch(isolation, /This contract authorizes no V18 validator or reachable runtime profile/iu);

	const proxy = await text('docs/milestone-3b-video-proxy-v18.md');
	assert.match(proxy, /durable.*V18.*implemented/isu);
	assert.match(proxy, /re-attestation.*implemented/isu);
	assert.match(proxy, /generation.*menu.*unavailable/isu);
	assert.doesNotMatch(proxy, /durable proxy storage and c-c remain unauthorized/iu);
});

test('milestone 3 closure blockers remain explicit and unpromoted', async () => {
	const matrix = await json('config/milestone-3-timing-probe-matrix.json');
	assert.equal(matrix.electronRows.length, 4);
	assert.deepEqual(new Set(matrix.electronRows.map(({ status }) => status)), new Set(['pending-external']));

	const budgets = await json('config/quality-budgets.json');
	const ownerHost = byId(budgets.environments, 'owner-qualified-windows-x64-rtx3090-01');
	assert.equal(ownerHost.status, 'active');
	assert.ok(ownerHost.eligibleWorkloadIds.includes('m3-longform-editorial'));
	const m3Profile = budgets.packagedRuntimeQualification.profiles.find(
		({ diagnosticKey }) => diagnosticKey === 'm3-longform-editorial',
	);
	assert.equal(m3Profile.status, 'active');
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
