/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { authenticateProfessionalNativeBuildOverlay }
	from '../scripts/lib/milestone-5-native-build-overlay.mjs';
import { assembleMilestone5ProductPackageAudit } from '../scripts/lib/milestone-5-package-audit.mjs';
import { createSoundscaperProfessionalNativeBuildResult, stageSoundscaperProfessionalNativeBuildResult }
	from '../scripts/lib/soundscaper-professional-native-build-result.mjs';
import { createSoundscaperProfessionalNativeToolchainReceipt, soundscaperProfessionalNativeToolchainIdentity }
	from '../scripts/lib/soundscaper-professional-native-toolchain.mjs';
import { soundscaperProfessionalNativeBuildSelfTestsFixture }
	from './helpers/soundscaper-professional-native-build-result-fixtures.js';
import sourceRegister from '../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };

const MANIFEST = 'config/soundscaper-professional-native-payload-manifest.json';

test('CI native overlays bind exact HEAD receipts and allow only generated manifest and authenticated staged files', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-native-overlay-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const repositoryRoot = join(root, 'repository');
	await mkdir(join(repositoryRoot, 'config'), { recursive: true });
	await writeFile(join(repositoryRoot, MANIFEST), await readFile(MANIFEST));
	await writeFile(join(repositoryRoot, 'config/milestone-5-native-source-acquisitions.json'),
		await readFile('config/milestone-5-native-source-acquisitions.json'));
	await writeFile(join(repositoryRoot, 'config/production-licensing-matrix.json'),
		await readFile('config/production-licensing-matrix.json'));
	await writeFile(join(repositoryRoot, 'source.ts'), 'export const source = true;\n');
	const git = (args: string[]) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
	git(['init', '--quiet']);
	git(['add', '.']);
	git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
	const sourceRevision = git(['rev-parse', 'HEAD']);
	const resultsRoot = join(root, 'results');
	await mkdir(resultsRoot);
	const resultRoot = join(resultsRoot, 'soundscaper-professional-native-build-result-linux-x64');
	await createCandidate(root, resultRoot, sourceRevision);
	await stageSoundscaperProfessionalNativeBuildResult({ buildResultRoot: resultRoot, repositoryRoot });
	const authenticate = () => authenticateProfessionalNativeBuildOverlay({ repositoryRoot, sourceRevision, resultsRoot });
	const overlay = await authenticate();
	assert.equal(overlay.sourceBinding.status, 'verified-head-native-build-overlay');
	assert.equal(overlay.sourceBinding.sourceRevision, sourceRevision);
	assert.deepEqual(overlay.sourceBinding.buildResultOverlay.targets.map(({ target }: { target: string }) => target), ['linux-x64']);
	const generated = await readFile(join(repositoryRoot, MANIFEST));
	assert.equal(overlay.manifestBytes.equals(generated), true);
	const originalOverlayRoot = process.env.SOUNDSCAPER_M5_NATIVE_BUILD_RESULT_ROOT;
	process.env.SOUNDSCAPER_M5_NATIVE_BUILD_RESULT_ROOT = resultsRoot;
	try {
		const audit = await assembleMilestone5ProductPackageAudit({ repositoryRoot, sourceRevision, productIds: ['soundscaper'] });
		assert.equal(audit.repositoryInputsVerified, true);
		assert.equal(audit.sourceRevision, sourceRevision);
		assert.equal(audit.payloads.built, 1);
		assert.equal(audit.inputDigests[MANIFEST].sha256, overlay.sourceBinding.buildResultOverlay.manifestSha256);
	} finally {
		if (originalOverlayRoot === undefined) delete process.env.SOUNDSCAPER_M5_NATIVE_BUILD_RESULT_ROOT;
		else process.env.SOUNDSCAPER_M5_NATIVE_BUILD_RESULT_ROOT = originalOverlayRoot;
	}

	await writeFile(join(repositoryRoot, 'source.ts'), 'export const source = false;\n');
	await assert.rejects(authenticate(), /worktree or index/u);
	await writeFile(join(repositoryRoot, 'source.ts'), 'export const source = true;\n');
	git(['add', MANIFEST]);
	await assert.rejects(authenticate(), /worktree or index/u);
	git(['reset', '--quiet', 'HEAD', '--', MANIFEST]);
	const changed = JSON.parse(String(generated)) as { addon: { version: string } };
	changed.addon.version = 'foreign';
	await writeFile(join(repositoryRoot, MANIFEST), JSON.stringify(changed));
	await assert.rejects(authenticate(), /exact generated/u);
	await writeFile(join(repositoryRoot, MANIFEST), generated);
	const stagedRoot = join(repositoryRoot, 'native/soundscaper-professional-host/prebuilt/linux-x64');
	await writeFile(join(stagedRoot, 'ambient.so'), 'foreign');
	await assert.rejects(authenticate(), /inventory/u);
	await rm(join(stagedRoot, 'ambient.so'));
	await chmod(join(stagedRoot, 'soundscaper_professional_peer'), 0o755);
	await writeFile(join(stagedRoot, 'soundscaper_professional_peer'), 'tampered');
	await assert.rejects(authenticate(), /digest|byte length/u);
	await assert.rejects(authenticateProfessionalNativeBuildOverlay({ repositoryRoot, sourceRevision: 'f'.repeat(40), resultsRoot }), /revision/u);
});

async function createCandidate(root: string, resultRoot: string, sourceRevision: string) {
	const professionalInstallRoot = join(root, 'professional');
	const isolationInstallRoot = join(root, 'isolation');
	for (const [path, bytes] of [
		[join(professionalInstallRoot, 'soundscaper_professional.node'), 'addon'],
		[join(professionalInstallRoot, 'soundscaper_professional_peer'), 'peer'],
		[join(professionalInstallRoot, 'soundscaper_delivery_fs'), 'delivery'],
		[join(isolationInstallRoot, 'bin/milestone5-native-isolation-launcher'), 'launcher'],
		[join(isolationInstallRoot, 'profiles/linux-v1.json'), '{}'],
		[join(isolationInstallRoot, 'profiles/linux-broker-v1.json'), '{}'],
	] as const) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes);
	}
	const identity = {
		cmakeVersion: '4.2.1', generator: 'Ninja', generatorPlatform: '', systemName: 'Linux',
		systemProcessor: 'x86_64', osxArchitectures: '',
		cCompiler: { id: 'Clang', version: '19.1.0' }, cxxCompiler: { id: 'Clang', version: '19.1.0' },
	};
	const toolchainReceipt = createSoundscaperProfessionalNativeToolchainReceipt({
		target: 'linux-x64', professional: identity, isolation: identity, osAudioCodec: null,
	});
	await createSoundscaperProfessionalNativeBuildResult({
		target: 'linux-x64', professionalInstallRoot, isolationInstallRoot, runtimeRoot: null,
		buildResultRoot: resultRoot, sourceRevision, buildPlanSha256: 'a'.repeat(64),
		toolchainReceipt, toolchainIdentity: soundscaperProfessionalNativeToolchainIdentity(toolchainReceipt),
		sourceAuthentication: { schemaVersion: 1, status: 'authenticated', sources: sourceRegister.sources
			.filter(({ id }) => !['asio-sdk', 'x264', 'x265', 'libvpx', 'libopus', 'zlib'].includes(id))
			.map((source) => ({ id: source.id, authenticationStatus: 'authenticated',
				archiveEvidence: { byteLength: source.archive.byteLength, sha256: source.archive.sha256 },
				extractedTreeEvidence: source.extractedTree })) },
		buildSelfTests: soundscaperProfessionalNativeBuildSelfTestsFixture('linux-x64'),
		packagedAppAuthority: { schemaVersion: 1, kind: 'soundscaper-professional-packaged-electron-authority',
			target: 'linux-x64', sourceRevision, contentManifest: {
				path: 'package/resources/milestone-5-package-content.json', byteLength: 1,
				sha256: '5'.repeat(64), closureSha256: '6'.repeat(64),
			}, executable: { path: 'package/Soundscaper', byteLength: 1, sha256: '7'.repeat(64) },
			rootFileCount: 2, rootTotalBytes: 2, rootClosureSha256: '8'.repeat(64) },
		inspectDependencies: ({ path }: { path: string }) => ({ architecture: { schemaVersion: 1, target: 'linux-x64', architecture: 'x64',
			format: 'elf64-le', machine: 'EM_X86_64' }, imports: [],
			rpaths: path.includes('soundscaper_professional_peer') ? ['$ORIGIN/runtime'] : [] }),
		runSelfTest: ({ expectedStatus }: { expectedStatus: number }) => ({ status: expectedStatus, stdout: 'passed', stderr: '' }),
	});
}
