import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createPackage } from '@electron/asar';
import assistance from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import { captureMacSigningInputs, signVerifiedMacStage, verifySignedMacPackage, repinStageDocuments } from '../scripts/lib/desktop-mac-signing-stage.mjs';
import { canonicalSigningJson, signingDigest } from '../scripts/lib/desktop-signing-pins.mjs';
import { signedAssistanceAuthority } from '../scripts/lib/desktop-signed-assistance-authority.mjs';

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'signing-test-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const saved = { ...process.env };
	Object.assign(process.env, { SCAPE_MAC_SIGNING: 'true', CSC_NAME: 'Developer ID Application: Test (ABCDEFGHIJ)',
		CSC_KEYCHAIN: '/temporary/keychain', APPLE_TEAM_ID: 'ABCDEFGHIJ' });
	t.after(() => { process.env = saved; });
	const app = join(root, '.desktop-build/app');
	await mkdir(join(app, 'config'), { recursive: true });
	const manifest = structuredClone(assistance);
	const name = Object.keys(manifest.targets['mac-arm64'].package.files).find(value => value.endsWith('.node'));
	const binary = Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.from('executable-content')]);
	const descriptor = { byteLength: binary.length, sha256: signingDigest(binary) };
	manifest.targets['mac-arm64'].package.files[name] = descriptor;
	const relativePath = `${manifest.runtimePrefix}/node_modules/${manifest.targets['mac-arm64'].package.name}/${name}`;
	const path = join(root, '.desktop-build/runtime', relativePath);
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, binary);
	await writeFile(join(app, 'config/assistance-native-runtime-manifest.json'), canonicalSigningJson(manifest));
	await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'test' }));
	await writeFile(join(root, '.desktop-build/stage-manifest.json'), canonicalSigningJson({
		target: { platform: 'mac', arch: 'arm64' }, assistanceNativeRuntime: assistanceNativeRuntimeStageSummary(manifest, 'mac-arm64'),
	}));
	const resources = join(root, 'output/Resources');
	const context = { electronPlatformName: 'darwin', appOutDir: join(root, 'output'),
		packager: { projectDir: root, getResourcesDir: () => resources } };
	const executeFile = async (_command, args) => {
		const target = args.at(-1);
		if (args[0] === '--force') await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('SIGNATURE')]));
		if (args[0] === '--remove-signature') {
			const bytes = await readFile(target);
			await writeFile(target, bytes.subarray(0, binary.length));
		}
	};
	await captureMacSigningInputs(context);
	return { root, context, executeFile, manifest, path, relativePath, resources, app };
}

test('native signing preserves source authority and packages exactly the repinned stage', async t => {
	const f = await fixture(t);
	await signVerifiedMacStage(f.context, { executeFile: f.executeFile });
	const stage = JSON.parse(await readFile(join(f.root, '.desktop-build/stage-manifest.json')));
	const expected = assistanceNativeRuntimeStageSummary(signedAssistanceAuthority(f.manifest, stage.nativeSigning, 'mac-arm64'), 'mac-arm64');
	assert.deepEqual(stage.assistanceNativeRuntime, expected);
	assert.equal(stage.nativeSigning.files.length, 1);
	await mkdir(f.resources, { recursive: true });
	await cp(join(f.root, '.desktop-build/runtime'), join(f.resources, 'runtime'), { recursive: true });
	await createPackage(f.app, join(f.resources, 'app.asar'));
	assert.equal(await verifySignedMacPackage(f.context), true);
	await writeFile(join(f.resources, 'runtime', f.relativePath), 'tampered');
	await assert.rejects(verifySignedMacPackage(f.context), /changed after signing/);
});

test('signing refuses a signer that changes executable contents', async t => {
	const f = await fixture(t);
	await assert.rejects(signVerifiedMacStage(f.context, { executeFile: async (command, args) => {
		await f.executeFile(command, args);
		if (args[0] === '--force') await writeFile(args.at(-1), Buffer.alloc(30));
	} }), /changed executable content/);
});

test('signing refuses inputs changed since provenance verification began', async t => {
	const f = await fixture(t);
	await writeFile(f.path, Buffer.from('modified'));
	await assert.rejects(signVerifiedMacStage(f.context, { executeFile: f.executeFile }), /verified unsigned runtime/);
});

test('signed assistance receipts cannot substitute source pins or another platform', () => {
	assert.throws(() => signedAssistanceAuthority(assistance, { schemaVersion: 1,
		teamId: 'ABCDEFGHIJ', files: [] }, 'win-x64'), /Invalid/);
	const descriptor = assistance.targets['mac-arm64'].package;
	const path = `${assistance.runtimePrefix}/node_modules/${descriptor.name}/${Object.keys(descriptor.files)[0]}`;
	assert.throws(() => signedAssistanceAuthority(assistance, { schemaVersion: 1,
		teamId: 'ABCDEFGHIJ', files: [{ path, original: { sha256: 'untrusted', byteLength: 1 },
			signed: { sha256: 'a'.repeat(64), byteLength: 100 } }] }, 'mac-arm64'), /source pins/);
});

test('signed package verification refuses an unauthenticated stage and added ASAR files', async t => {
	const f = await fixture(t);
	await assert.rejects(verifySignedMacPackage(f.context), /no verified signing-stage authority/);
	await signVerifiedMacStage(f.context, { executeFile: f.executeFile });
	await mkdir(f.resources, { recursive: true });
	await cp(join(f.root, '.desktop-build/runtime'), join(f.resources, 'runtime'), { recursive: true });
	await writeFile(join(f.app, 'unexpected.js'), 'export const extra = true;');
	await createPackage(f.app, join(f.resources, 'app.asar'));
	await assert.rejects(verifySignedMacPackage(f.context), /changed after signing/);
});

test('distribution pins propagate through nested manifest digests', async t => {
	const root = await mkdtemp(join(tmpdir(), 'signing-pins-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const inner = canonicalSigningJson({ sha256: 'native-before', byteLength: 1 });
	const outer = canonicalSigningJson({ payloadManifest: { sha256: signingDigest(inner), byteLength: inner.length } });
	const replacements = new Map([['native-before', { sha256: 'native-after', byteLength: 2 }]]);
	await repinStageDocuments(new Map([[join(root, 'outer.json'), outer], [join(root, 'inner.json'), inner]]), replacements);
	const actual = JSON.parse(await readFile(join(root, 'outer.json')));
	const updated = await readFile(join(root, 'inner.json'));
	assert.equal(actual.payloadManifest.sha256, signingDigest(updated));
	assert.equal(actual.payloadManifest.byteLength, updated.length);
});
