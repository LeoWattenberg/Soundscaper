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

test('package generation binds every declared target and its platform environment', async () => {
	const fixture = await producerFixture();
	try {
		const workflowPath = join(fixture, '.github/workflows/desktop-preview.yml');
		const source = await readFile(workflowPath, 'utf8');
		await writeFile(workflowPath, source
			.replaceAll(`          - runner: ubuntu-24.04-arm
            platform: linux
            arch: arm64`, `          - runner: ubuntu-24.04-arm
            platform: linux
            arch: x64`)
			.replaceAll('          SOUNDSCAPER_DESKTOP_TARGET_ARCH: ${{ matrix.target.arch }}',
				'          # target architecture environment removed'), 'utf8');
		const audit = auditNativePayloadProducers(fixture);
		assert.equal(audit.status, 'failed');
		assert.ok(audit.findings.some((finding) => finding.includes('linux-arm64 package row')));
		assert.ok(audit.findings.some((finding) => finding.includes('target architecture')));
	} finally { await rm(fixture, { recursive: true, force: true }); }
});

async function producerFixture() {
	const fixture = await mkdtemp(join(tmpdir(), 'soundscaper-native-producers-'));
	const registerPath = resolve(ROOT, 'config/native-payload-producers.json');
	const register = JSON.parse(await readFile(registerPath, 'utf8'));
	const paths = new Set(['config/native-payload-producers.json']);
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
