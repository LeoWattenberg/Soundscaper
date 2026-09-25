/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { auditNativePayloadProducers } from '../scripts/lib/native-payload-producers.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('every native payload is produced by repository CI or target packaging', () => {
	const audit = auditNativePayloadProducers(ROOT);
	assert.deepEqual(audit, { status: 'passed', findings: [] });
});

test('commented-out CI commands and broken per-target rows cannot satisfy the producer audit', async () => {
	const fixture = await producerFixture();
	try {
		const workflowPath = join(fixture, '.github/workflows/framescaper-openfx-native-build.yml');
		const source = await readFile(workflowPath, 'utf8');
		await writeFile(workflowPath, source
			.replace('node scripts/build-framescaper-openfx-host.mjs',
				'# node scripts/build-framescaper-openfx-host.mjs')
			.replace('runner: ubuntu-24.04-arm', 'runner: ubuntu-24.04'), 'utf8');
		const audit = auditNativePayloadProducers(fixture);
		assert.equal(audit.status, 'failed');
		assert.ok(audit.findings.some((finding) => finding.includes('build command')));
		assert.ok(audit.findings.some((finding) => finding.includes('linux-arm64/ubuntu-24.04-arm')));
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

test('a broken package-generation import chain cannot satisfy the producer audit', async () => {
	const fixture = await producerFixture();
	try {
		const pipelinePath = join(fixture, 'scripts/lib/desktop-assistance-runtime-families.mjs');
		const source = await readFile(pipelinePath, 'utf8');
		await writeFile(pipelinePath, source.replace(
			"import { stageDesktopLlamaCppRuntime } from './desktop-assistance-llama-runtime.mjs';",
			"// import removed from './desktop-assistance-llama-runtime.mjs';",
		), 'utf8');
		const audit = auditNativePayloadProducers(fixture);
		assert.equal(audit.status, 'failed');
		assert.ok(audit.findings.some((finding) => finding.includes('assistance-llama-cpp pipeline')));
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

test('package generation binds helper-backed targets and its platform environment', async () => {
	const fixture = await producerFixture();
	try {
		const workflowPath = join(fixture, '.github/workflows/desktop-nightly-tests.yml');
		const workflow = await readFile(workflowPath, 'utf8');
		await writeFile(workflowPath, workflow
			.replaceAll('          SOUNDSCAPER_DESKTOP_TARGET_ARCH: ${{ matrix.target.arch }}',
				'          # target architecture environment removed'), 'utf8');
		const helperPath = join(fixture, 'scripts/lib/desktop-nightly-tests-target-matrix.mjs');
		const helper = await readFile(helperPath, 'utf8');
		await writeFile(helperPath, helper.replace(
			"runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64'",
			"runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'x64'",
		), 'utf8');
		const audit = auditNativePayloadProducers(fixture);
		assert.equal(audit.status, 'failed');
		assert.ok(audit.findings.some((finding) => finding.includes('nightly-with-tests target matrix')));
		assert.ok(audit.findings.some((finding) => finding.includes('target architecture')));
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

test('helper-backed nightly package targets reject a substituted runner or architecture', async () => {
	const fixture = await producerFixture();
	try {
		const helperPath = join(fixture, 'scripts/lib/desktop-nightly-tests-target-matrix.mjs');
		const source = await readFile(helperPath, 'utf8');
		await writeFile(helperPath, source.replace(
			"runner: 'windows-11-arm', platform: 'win', arch: 'arm64'",
			"runner: 'windows-2025', platform: 'win', arch: 'x64'",
		), 'utf8');
		const audit = auditNativePayloadProducers(fixture);
		assert.equal(audit.status, 'failed');
		assert.ok(audit.findings.some((finding) => finding.includes('nightly-with-tests target matrix')));
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

test('helper-backed nightly package targets reject a Windows selection that omits Windows', async () => {
	const fixture = await producerFixture();
	try {
		const helperPath = join(fixture, 'scripts/lib/desktop-nightly-tests-target-matrix.mjs');
		const source = await readFile(helperPath, 'utf8');
		await writeFile(helperPath, source.replace("platform === 'win'", "platform === 'linux'"), 'utf8');
		const audit = auditNativePayloadProducers(fixture);
		assert.equal(audit.status, 'failed');
		assert.ok(audit.findings.some((finding) => finding.includes('nightly-with-tests target matrix')));
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

test('helper-backed nightly package targets reject an x64-only selection that also includes ARM64', async () => {
	const fixture = await producerFixture();
	try {
		const helperPath = join(fixture, 'scripts/lib/desktop-nightly-tests-target-matrix.mjs');
		const source = await readFile(helperPath, 'utf8');
		await writeFile(helperPath, source.replace(
			"if (selection === 'win-x64') return WIN_X64_TARGETS;",
			"if (selection === 'win-x64') return WINDOWS_TARGETS;",
		), 'utf8');
		const audit = auditNativePayloadProducers(fixture);
		assert.equal(audit.status, 'failed');
		assert.ok(audit.findings.some((finding) => finding.includes('nightly-with-tests target matrix')));
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

async function producerFixture() {
	const fixture = await mkdtemp(join(tmpdir(), 'soundscaper-native-producers-'));
	const registerPath = resolve(ROOT, 'config/native-payload-producers.json');
	const register = JSON.parse(await readFile(registerPath, 'utf8'));
	const paths = new Set(['config/native-payload-producers.json']);
	paths.add('scripts/lib/desktop-nightly-tests-target-matrix.mjs');
	for (const producer of register.ciProducers) {
		for (const path of [
			...producer.manifestPaths, producer.workflowPath, producer.dispatchWorkflowPath,
			producer.buildCommand, producer.stageCommand, ...producer.sourceCommands,
		]) paths.add(path);
	}
	for (const producer of register.packageProducers) {
		for (const path of [producer.manifestPath, producer.workflowPath,
			producer.packageCommand, ...producer.pipelinePaths]) paths.add(path);
	}
	for (const path of paths) {
		const destination = join(fixture, path);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(resolve(ROOT, path), destination);
	}
	return fixture;
}
