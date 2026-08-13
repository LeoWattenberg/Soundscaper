/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('current desktop lease qualification is product-isolated and remains pending external', async () => {
	const compatibility = await json('config/project-compatibility.json');
	const rule = compatibility.rules.find(
		({ id }) => id === 'current-desktop-electron-lease-protections',
	);
	assert.ok(rule);
	assert.equal(rule.status, 'partial');
	const claim = `${rule.requiredOutcome} ${rule.currentBehavior}`;
	assert.match(claim, /Soundscaper.*V9.*short-lived.*writer (?:session|lease)/isu);
	assert.match(claim, /Framescaper.*V10.*process-lifetime.*main-owned.*lease/isu);
	assert.match(claim, /Framescaper.*session.*recovery/isu);
	assert.match(claim, /cross-product.*(?:physical|storage).*isolation.*not.*shared mutable catalog/isu);
	assert.match(claim, /historical.*eight.*V9.*V17/isu);
	assert.match(claim, /does not authorize.*Framescaper V17/isu);
	for (const product of ['Soundscaper V9', 'Framescaper V10']) {
		for (const target of ['Windows x64', 'Linux x64']) {
			assert.match(claim, new RegExp(`${product}.*${target}.*pending-external`, 'isu'));
		}
	}
	assert.match(claim, /no accepted packaged result/isu);

	const security = await json('config/production-security-matrix.json');
	const controls = new Map(security.risks.flatMap(({ currentControls }) => (
		currentControls.map((control) => [control.id, control])
	)));
	const v9 = controls.get('packaged-cross-platform-electron-lease-matrix');
	const v10 = controls.get('framescaper-v18-desktop-v10-isolation');
	assert.ok(v9);
	assert.ok(v10);
	assert.match(v9.summary, /Soundscaper.*V9.*seven.*workflow/isu);
	assert.match(v9.summary, /cross-product-simultaneous-open.*historical.*not run/isu);
	assert.match(v9.summary, /Windows x64.*Linux x64.*pending-external/isu);
	assert.match(v10.summary, /process-lifetime.*lease.*session.*recovery/isu);
	assert.match(v10.summary, /Windows x64.*Linux x64.*pending-external/isu);
	assert.match(`${v9.summary} ${v10.summary}`, /separate.*(?:scope|database|storage).*cross-product.*isolation/isu);
});

test('roadmap preserves the frozen M2 inventory as history without re-admitting Framescaper V17', async () => {
	const closure = await json('config/milestone-2-closure.json');
	const item = closure.items.find(({ id }) => id === 'm2-electron-lease-matrix');
	assert.equal(closure.scopeRevision, 2);
	assert.deepEqual(item.workflowIds, [
		'same-project-simultaneous-open',
		'cross-product-simultaneous-open',
		'writer-lease-transfer',
		'stale-lease-takeover',
		'conflicting-canonical-commit',
		'renderer-loss-during-operation',
		'orderly-process-restart',
		'crash-restart-recovery',
	]);

	const roadmap = await text('roadmap.md');
	assert.match(roadmap, /eight.*workflow.*frozen historical.*V9.*V17/isu);
	assert.match(roadmap, /current executable qualification.*Soundscaper V9.*Framescaper V10/isu);
	assert.match(roadmap, /does not.*re-admit.*Framescaper V17/isu);
	assert.match(roadmap, /Windows x64.*Linux x64.*accepted packaged results.*absent.*Partial/isu);
});

test('current capability inventory separates V9 and V10 package evidence', async () => {
	const capabilities = await json('config/production-capabilities.json');
	const linuxX64 = capabilities.desktopTargets.find(
		({ os, architecture }) => os === 'linux' && architecture === 'x64',
	);
	assert.equal(linuxX64.packageGate, 'smoke-tested');
	for (const path of [
		'desktop/desktop-smoke.js',
		'scripts/lib/desktop-smoke.mjs',
		'scripts/desktop-smoke.mjs',
		'tests/desktop-smoke.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(linuxX64.evidence.includes(path), path);
	assert.doesNotMatch(JSON.stringify(linuxX64.evidence), /project-library-handoff-smoke/iu);

	const soundscaper = capabilities.products.soundscaper.platforms['electron-enhanced'];
	const framescaper = capabilities.products.framescaper.platforms['electron-enhanced'];
	assert.equal(soundscaper.status, 'partial');
	assert.equal(framescaper.status, 'partial');
	for (const path of [
		'desktop/project-library-host.ts',
		'desktop/project-library-lease-smoke.js',
		'scripts/lib/desktop-project-library-lease-matrix.mjs',
	]) assert.ok(soundscaper.evidence.includes(path), path);
	for (const path of [
		'desktop/project-library-v10-main.ts',
		'desktop/project-library-v10-main-session.ts',
		'desktop/project-library-v10-lifecycle-host.ts',
		'desktop/framescaper-v18-artifact-smoke.js',
		'tests/desktop-project-library-v10-main.test.ts',
		'tests/desktop-smoke.test.js',
	]) assert.ok(framescaper.evidence.includes(path), path);
	assert.doesNotMatch(JSON.stringify(framescaper.evidence),
		/project-library-host\.ts|project-library-handoff-smoke|project-library-source-bearing/iu);
});

test('retired V9/V17 packaged handoff claims remain historical only', async () => {
	const compatibility = await json('config/project-compatibility.json');
	const rule = compatibility.rules.find(
		({ id }) => id === 'current-desktop-packaged-source-bearing-handoff',
	);
	assert.equal(rule.status, 'implemented');
	assert.equal(rule.policyBoundary.authorizesFramescaperV17Activation, false);
	assert.match(rule.currentBehavior, /historical.*pre-V18.*V9.*schema 17/isu);
	assert.match(rule.currentBehavior, /current CI.*retired|no longer runs/isu);
	assert.doesNotMatch(rule.currentBehavior, /maintained Linux x64 CI job runs/iu);

	const security = await json('config/production-security-matrix.json');
	const controls = new Map(security.risks.flatMap(({ currentControls }) => (
		currentControls.map((control) => [control.id, control])
	)));
	for (const id of [
		'packaged-linux-x64-source-free-project-library-handoff',
		'packaged-linux-x64-source-bearing-project-library-handoff',
	]) {
		const control = controls.get(id);
		assert.ok(control, id);
		assert.match(control.summary, /historical.*V9.*schema 17/isu, id);
		assert.match(control.summary, /current CI.*retired|no longer runs/isu, id);
		assert.doesNotMatch(control.summary, /maintained.*CI job (?:builds|runs)/iu, id);
		assert.equal(control.evidence.some(
			({ kind, path }) => kind === 'workflow' && path === '.github/workflows/desktop-preview.yml',
		), false, id);
	}
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, ROOT), 'utf8');
}
