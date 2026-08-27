/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('current desktop lease testing covers every maintained target while release qualification remains pending', async () => {
	const compatibility = await json('config/project-compatibility.json');
	const rule = compatibility.rules.find(
		({ id }) => id === 'current-desktop-electron-lease-protections',
	);
	assert.ok(rule);
	assert.equal(rule.status, 'partial');
	const claim = `${rule.requiredOutcome} ${rule.currentBehavior}`;
	assert.match(claim, /Soundscaper.*V11.*process-lifetime.*main-owned.*lease/isu);
	assert.match(claim, /Soundscaper V11.*project (?:schema|generation) 30.*user_version 13.*scope v11/isu);
	assert.match(claim, /Framescaper.*V20.*process-lifetime.*main-owned.*lease/isu);
	assert.match(claim, /Framescaper V20.*V19.*V18.*V17.*V12.*immutable/isu);
	assert.match(claim, /seven product-specific workflows.*both products/isu);
	assert.match(claim, /cross-product-simultaneous-open.*once.*paired packages/isu);
	for (const product of ['Soundscaper V11', 'Framescaper V20']) {
		for (const target of ['Windows x64', 'Windows ARM64', 'macOS ARM64', 'Linux x64', 'Linux ARM64']) {
			assert.match(claim, new RegExp(`${product}.*${target}.*pending-external`, 'isu'));
		}
	}
	assert.match(claim, /automated test activation.*all five maintained desktop targets.*human qualification.*milestone-?9/isu);
	assert.match(claim, /no accepted packaged result/isu);

	const security = await json('config/production-security-matrix.json');
	const controls = new Map(security.risks.flatMap(({ currentControls }) => (
		currentControls.map((control) => [control.id, control])
	)));
	const leaseMatrix = controls.get('packaged-cross-platform-electron-lease-matrix');
	const framescaper = controls.get('framescaper-v20-desktop-v17-isolation');
	assert.ok(leaseMatrix);
	assert.ok(framescaper);
	assert.match(leaseMatrix.summary, /Soundscaper.*V11.*Framescaper.*V20.*process-lifetime/isu);
	assert.match(leaseMatrix.summary, /crash-restart-recovery for both selected products.*cross-product-simultaneous-open once/isu);
	assert.match(leaseMatrix.summary, /automated test activation.*all five maintained desktop targets.*human qualification.*milestone-?9/isu);
	assert.match(leaseMatrix.summary, /Windows x64.*Windows ARM64.*macOS ARM64.*Linux x64.*Linux ARM64.*pending-external/isu);
	assert.match(framescaper.summary, /desktop-library V20.*user_version 22.*scope v20/isu);
	assert.match(framescaper.summary, /V19.*read-only.*V28.*reimports.*F31.*resumes idempotently/isu);
	assert.match(leaseMatrix.summary, /separate storage scope and database.*storage and fencing isolation/isu);
});

test('roadmap binds the M2 inventory to the selected product generations', async () => {
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
	assert.match(roadmap, /selected owners.*Soundscaper desktop-library V11.*Framescaper.*desktop-library V20/isu);
	assert.match(roadmap, /seven.*product-specific workflows.*V11 and V20/isu);
	assert.match(roadmap, /cross-product-simultaneous-open.*once.*those packages/isu);
	assert.match(roadmap, /user_version.*22.*scope.*v20/isu);
	assert.match(roadmap, /V19.*read-only.*reimports.*V28.*F31/isu);
	assert.match(roadmap, /without rewriting.*V19.*V18\/V17\/V12/isu);
	assert.match(roadmap, /all five maintained desktop targets.*human qualification.*milestone 9.*no accepted V20 packaged result.*Partial/isu);

	const workflow = await text('.github/workflows/desktop-preview.yml');
	const start = workflow.indexOf('\n  soundscaper-project-library-lease-matrix:');
	const job = workflow.slice(start);
	for (const { runner, platform, arch } of [
		{ runner: 'windows-2025', platform: 'win', arch: 'x64' },
		{ runner: 'windows-11-arm', platform: 'win', arch: 'arm64' },
		{ runner: 'macos-15', platform: 'mac', arch: 'arm64' },
		{ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64' },
		{ runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
	]) assert.match(job, new RegExp(`runner: ${runner}\\n\\s+platform: ${platform}\\n\\s+arch: ${arch}`, 'u'));
});

test('current capability inventory names the selected desktop lease owners', async () => {
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
		'desktop/soundscaper-project-library-v11-main.ts',
		'src/soundscaper/editor-project-v30.ts',
		'scripts/lib/desktop-project-library-lease-matrix.mjs',
	]) assert.ok(soundscaper.evidence.includes(path), path);
	for (const path of [
		'desktop/project-library-product-runtime.js',
		'desktop/project-library-v20-contract.ts',
		'desktop/project-library-v20-database.ts',
		'desktop/project-library-v20-import.ts',
		'desktop/project-library-v20-main.ts',
		'desktop/project-library-v20-main-ipc.ts',
		'desktop/project-library-v20-writer.ts',
		'src/framescaper/desktop-project-library-v20-renderer.ts',
		'src/framescaper/desktop-project-library-v20-store-adapter.ts',
		'tests/desktop-project-library-v12-packaged.test.ts',
		'tests/desktop-project-library-lease-matrix.test.js',
		'tests/desktop-project-library-lease-smoke.test.js',
		'tests/desktop-smoke.test.js',
	]) assert.ok(framescaper.evidence.includes(path), path);
	assert.doesNotMatch(JSON.stringify(framescaper.evidence),
		/project-library-host\.ts|project-library-handoff-smoke|project-library-source-bearing/iu);
});

test('retired V9/V17 packaged handoff claims remain historical only', async () => {
	const compatibility = await json('config/project-compatibility.json');
	const sourceFreeRule = compatibility.rules.find(
		({ id }) => id === 'current-desktop-project-catalog-commit',
	);
	assert.match(sourceFreeRule.currentBehavior, /historical.*pre-V18.*V9.*schema 17/isu);
	assert.match(sourceFreeRule.currentBehavior, /current CI.*retired|no longer runs/isu);
	assert.equal(sourceFreeRule.evidence.includes('.github/workflows/desktop-preview.yml'), false);
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
