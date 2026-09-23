/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createPackage } from '@electron/asar';

import { preserveDesktopNightlyProductCoverageEvidence } from '../scripts/lib/desktop-nightly-product-coverage-evidence.mjs';

const REVISION = '0123456789abcdef0123456789abcdef01234567';
const TARGET = 'linux-x64';

function sha256(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}

function distributionManifest() {
	const families = [
		['sherpa-onnx-node', '1.13.5', 'sherpa-onnx'],
		['onnxruntime-node', '1.29.0', 'onnxruntime-node'],
		['whisper-cpp', 'v1.9.3', 'whisper-cpp'],
		['llama-cpp', 'b10509', 'llama-cpp'],
		['kokoro-g2p', '0.9.4', 'kokoro-g2p'],
	] as const;
	return {
		schemaVersion: 1,
		targetId: TARGET,
		bundles: families.map(([familyId, runtimeVersion, prefix]) => {
			const runtimePrefix = `assistance/${prefix}/${runtimeVersion}`;
			const archiveSha256 = sha256(familyId);
			return {
				familyId, runtimeVersion, runtimePrefix,
				installPath: familyId === 'sherpa-onnx-node'
					? runtimePrefix : `${runtimePrefix}/${TARGET}`,
				archive: {
					url: `https://assets.soundscaper.org/runtime/assistance/${familyId}/${runtimeVersion}/${TARGET}/${archiveSha256}.tar.gz`,
					byteLength: 128, sha256: archiveSha256,
				},
				files: [{ path: 'bin/runtime', byteLength: 1, sha256: archiveSha256, executable: true }],
			};
		}),
	};
}

async function write(path: string, value: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, value);
}

async function fixture(workspace: string) {
	const buildRoot = join(workspace, '.desktop-build');
	const productOutput = join(workspace, 'release', 'soundscaper');
	const resources = join(productOutput, 'linux-unpacked/resources');
	const app = join(workspace, 'packaged-app');
	const distribution = distributionManifest();
	const distributionBytes = Buffer.from(`${JSON.stringify(distribution, null, 2)}\n`);
	const stage = {
		schemaVersion: 1,
		productId: 'soundscaper',
		sourceRevision: REVISION,
		target: { platform: 'linux', arch: 'x64' },
		assistanceRuntimeDistribution: {
			targetId: TARGET,
			manifest: {
				path: 'config/assistance-runtime-distribution.json',
				byteLength: distributionBytes.byteLength,
				sha256: sha256(distributionBytes),
			},
			signingFiles: [],
			bundles: distribution.bundles.map(({ familyId, archive }) => ({
				familyId, sha256: archive.sha256, byteLength: archive.byteLength,
			})),
		},
	};
	await write(join(buildRoot, 'app/desktop/main.mjs'), 'void 0;\n');
	await write(join(app, 'desktop/main.mjs'), 'void 0;\n');
	await write(join(buildRoot, 'app/config/assistance-runtime-distribution.json'),
		distributionBytes.toString('utf8'));
	await write(join(app, 'config/assistance-runtime-distribution.json'),
		distributionBytes.toString('utf8'));
	await write(join(buildRoot, 'renderer/index.html'), '<main>Ready</main>\n');
	await write(join(resources, 'renderer/index.html'), '<main>Ready</main>\n');
	await write(join(buildRoot, 'renderer/assets/editor.js'), 'void 0;\n');
	await write(join(resources, 'renderer/assets/editor.js'), 'void 0;\n');
	await write(join(buildRoot, 'renderer-source-maps/editor.js.map'),
		JSON.stringify({ version: 3, sources: [] }));
	await write(join(buildRoot, 'stage-manifest.json'), `${JSON.stringify(stage, null, 2)}\n`);
	await createPackage(app, join(resources, 'app.asar'));
	return { buildRoot, productOutput, resources };
}

async function preserve(buildRoot: string, productOutput: string) {
	return preserveDesktopNightlyProductCoverageEvidence({
		buildRoot, productId: 'soundscaper', productOutput, sourceRevision: REVISION,
	});
}

test('nightly coverage binds downloadable runtime authority without packaging AI files', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-downloadable-runtime-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const { buildRoot, productOutput } = await fixture(workspace);
	const manifest = await preserve(buildRoot, productOutput);
	assert.deepEqual(manifest.excludedRuntimeScripts, []);
	const stagePath = join(buildRoot, 'stage-manifest.json');
	const stage = JSON.parse(await readFile(stagePath, 'utf8'));
	stage.assistanceRuntimeDistribution.manifest.sha256 = '0'.repeat(64);
	await writeFile(stagePath, `${JSON.stringify(stage, null, 2)}\n`);
	await assert.rejects(preserve(buildRoot, productOutput), /assistance runtime distribution/iu);
});

test('nightly coverage rejects AI files staged beside a downloadable runtime manifest', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-embedded-ai-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const { buildRoot, productOutput } = await fixture(workspace);
	await write(join(buildRoot, 'runtime/assistance/sherpa-onnx/1.13.5/forbidden.js'), 'void 0;\n');
	await assert.rejects(preserve(buildRoot, productOutput), /preinstalled assistance runtime/iu);
});
