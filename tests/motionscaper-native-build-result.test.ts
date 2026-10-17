/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { stageMotionscaperNativePayload } from '../scripts/lib/motionscaper-native-staging.ts';
import { createMotionscaperStageInventory } from '../scripts/lib/motionscaper-desktop-package.mjs';
import { verifyMotionscaperNativeBuildResult } from '../scripts/lib/motionscaper-native-build-result.ts';
import { MOTION_NATIVE_PRECISION, MOTION_NATIVE_SELF_TEST } from '../scripts/lib/motionscaper-native-build.ts';

const root = resolve('.');
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
async function fixture(): Promise<{ directory: string; receipt: Record<string, unknown> }> {
	const directory = await mkdtemp(join(tmpdir(), 'motionscaper-native-result-'));
	const binary = Buffer.alloc(64); binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); binary.writeUInt16LE(62, 18);
	const notices = `${await readFile(join(root, 'native/motionscaper-media-host/THIRD_PARTY_NOTICES.md'), 'utf8')}\n\n${await readFile(join(root, 'native/framescaper-media-host/THIRD_PARTY_NOTICES.md'), 'utf8')}`;
	const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
	const receipt: Record<string, unknown> = {
		schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1, target: 'linux-x64',
		sourceRevision: revision, sourceManifestSha256: digest(await readFile(join(root, 'native/motionscaper-media-host/source-manifest.json'))),
		dependencySourceSha256: digest(await readFile(join(root, 'native/framescaper-media-host/source-manifest.json'))),
		dependencyRecipeSha256: 'a'.repeat(64), toolchainIdentity: 'b'.repeat(64), buildCommandsSha256: 'c'.repeat(64),
		payload: { path: 'motionscaper-media-host', byteLength: binary.length, sha256: digest(binary) },
		notices: { path: 'THIRD_PARTY_NOTICES.md', byteLength: Buffer.byteLength(notices), sha256: digest(notices) },
		precision: MOTION_NATIVE_PRECISION, selfTest: MOTION_NATIVE_SELF_TEST,
		dependencyInspections: [{ artifactPath: 'motionscaper-media-host', architecture: {
			schemaVersion: 1, target: 'linux-x64', format: 'elf64-le', architecture: 'x64', machine: 'EM_X86_64',
		}, imports: ['libc.so.6'], rpaths: [] }],
		tests: [{ id: 'motionscaper-native-ctest', status: 'passed', outputSha256: 'd'.repeat(64) },
			{ id: 'motionscaper-native-self-test', status: 'passed', outputSha256: 'e'.repeat(64) }],
	};
	await writeFile(join(directory, 'motionscaper-media-host'), binary);
	await writeFile(join(directory, 'THIRD_PARTY_NOTICES.md'), notices);
	await writeReceipt(directory, receipt);
	return { directory, receipt };
}
async function writeReceipt(directory: string, receipt: Record<string, unknown>): Promise<void> {
	await writeFile(join(directory, 'build-result.json'), `${JSON.stringify(receipt, null, '\t')}\n`);
}
await test('Motionscaper native artifact rechecks source, target, payload closure, and effective precision', async () => {
	const { directory, receipt } = await fixture();
	try {
		const verified = await verifyMotionscaperNativeBuildResult({ repositoryRoot: root, resultRoot: directory, target: 'linux-x64' });
		assert.equal(verified.receipt.payload.path, 'motionscaper-media-host');
		assert.equal(verified.receipt.precision.encoderInputBits, 10);
		await assert.rejects(verifyMotionscaperNativeBuildResult({ repositoryRoot: root, resultRoot: directory, target: 'linux-arm64' }), /target/u);
		await writeFile(join(directory, 'foreign-plugin.so'), 'extra');
		await assert.rejects(verifyMotionscaperNativeBuildResult({ repositoryRoot: root, resultRoot: directory, target: 'linux-x64' }), /inventory/u);
		await rm(join(directory, 'foreign-plugin.so'));
		await writeReceipt(directory, { ...receipt, productId: 'framescaper' });
		await assert.rejects(verifyMotionscaperNativeBuildResult({ repositoryRoot: root, resultRoot: directory, target: 'linux-x64' }), /identity/u);
		await writeReceipt(directory, { ...receipt, precision: { ...MOTION_NATIVE_PRECISION, encoderInputBits: 16 } });
		await assert.rejects(verifyMotionscaperNativeBuildResult({ repositoryRoot: root, resultRoot: directory, target: 'linux-x64' }), /precision/u);
		await writeReceipt(directory, receipt);
		await writeFile(join(directory, 'motionscaper-media-host'), 'tampered');
		await assert.rejects(verifyMotionscaperNativeBuildResult({ repositoryRoot: root, resultRoot: directory, target: 'linux-x64' }), /digest/u);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

await test('Motionscaper staging admits exactly its verified native helper and retains codec notices', async () => {
	const { directory } = await fixture(); const staged = await mkdtemp(join(tmpdir(), 'motionscaper-native-stage-'));
	try {
		for (const path of ['app/desktop', 'renderer', 'runtime']) await mkdir(join(staged, path), { recursive: true });
		for (const path of ['app/desktop/main.mjs', 'app/desktop/preload.cjs', 'app/desktop/product.json', 'app/package.json', 'renderer/index.html']) await writeFile(join(staged, path), 'fixture');
		const manifest = await stageMotionscaperNativePayload({ repositoryRoot: root, buildRoot: staged, targetId: 'linux-x64', buildResultRoot: directory });
		assert.equal(manifest.helper?.path, 'runtime/motionscaper-media-host/motionscaper-media-host');
		assert.match(await readFile(join(staged, 'app/desktop/native-notices.md'), 'utf8'), /32,768/u);
		const inventory = await createMotionscaperStageInventory(staged);
		assert.equal(inventory.filter((entry: { path: string }) => entry.path.startsWith('runtime/')).length, 1);
		await writeFile(join(staged, 'runtime/foreign.node'), 'foreign');
		await assert.rejects(createMotionscaperStageInventory(staged), /undeclared/u);
	} finally { await rm(directory, { recursive: true, force: true }); await rm(staged, { recursive: true, force: true }); }
});
