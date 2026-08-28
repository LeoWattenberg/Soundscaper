/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('family-v1 desktop lease controls are isolated and remain partially qualified', async () => {
	const [compatibility, security] = await Promise.all([
		json('config/project-compatibility.json'),
		json('config/production-security-matrix.json'),
	]);
	const rule = compatibility.rules.find(({ id }) => id === 'current-desktop-electron-lease-protections');
	assert.equal(rule.status, 'partial');
	assert.match(rule.currentBehavior, /distinct roots.*application IDs.*user_version 1.*v1 IPC namespaces.*monotonic lease tokens/iu);
	assert.match(rule.currentBehavior, /No pre-release library is opened, copied forward, enumerated, mutated, or deleted/iu);
	assert.match(rule.currentBehavior, /stable 1\.0 stays blocked.*pending external/iu);

	const controls = new Map(security.risks.flatMap(({ currentControls }) => currentControls.map((control) => [control.id, control])));
	const isolation = controls.get('family-v1-desktop-library-isolation');
	const leaseMatrix = controls.get('packaged-cross-platform-electron-lease-matrix');
	assert.match(isolation.summary, /exact family-v1 handshakes.*user_version 1.*product-qualified IPC namespaces/iu);
	assert.match(isolation.summary, /without any pre-release importer or copy-forward chain/iu);
	assert.match(leaseMatrix.summary, /renewable process-lifetime.*writer lease.*monotonic fencing token/iu);
	assert.match(leaseMatrix.summary, /five target rows remain pending-external.*stable 1\.0.*fail-closed/iu);
});

test('capability inventory names only current family-v1 desktop owners', async () => {
	const capabilities = await json('config/production-capabilities.json');
	for (const [family, expected] of Object.entries({
		soundscaper: [
			'desktop/soundscaper-project-library-contract.ts',
			'desktop/soundscaper-project-library-main.ts',
			'src/soundscaper/editor-project.ts',
		],
		framescaper: [
			'desktop/framescaper-project-library-contract.ts',
			'desktop/framescaper-project-library-main.ts',
			'src/framescaper/editor-project.ts',
			'desktop/framescaper-baseline-artifact-smoke.js',
		],
	})) {
		const product = capabilities.products[family];
		assert.deepEqual(product.projectSchemaIdentity, {
			schemaFamily: family,
			schemaVersion: 1,
			evidence: product.projectSchemaIdentity.evidence,
		});
		const evidence = product.platforms['electron-enhanced'].evidence;
		for (const path of expected) assert.ok(evidence.includes(path), `${family}: ${path}`);
		assert.doesNotMatch(JSON.stringify(evidence), /(?:soundscaper-project-library-v1[01]|project-library-v(?:10|1[2-9]|20)|framescaper-v(?:18|20|27)-artifact)/u);
	}
});

test('lease workflow still exercises every maintained target while stable evidence remains pending', async () => {
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

	const compatibility = await json('config/project-compatibility.json');
	assert.equal(compatibility.baselineDecision.stableReleaseAdmission, 'blocked-on-remaining-milestone-9-evidence');
	const verification = await text('docs/milestone-9-guided-verification.md');
	assert.match(verification, /Stable 1\.0 release conclusion \| pending/iu);
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}
