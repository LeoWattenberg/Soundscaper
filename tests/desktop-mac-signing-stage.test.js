import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createPackage } from '@electron/asar';
import assistance from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import familyCandidates from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import { captureMacSigningInputs, signVerifiedMacStage, verifySignedMacPackage, repinStageDocuments,
	signedKokoroG2pSummary } from '../scripts/lib/desktop-mac-signing-stage.mjs';
import { canonicalSigningJson, rebindSigningPins, signingDigest } from '../scripts/lib/desktop-signing-pins.mjs';
import { signedAssistanceAuthority } from '../scripts/lib/desktop-signed-assistance-authority.mjs';
import { validateDesktopRuntimeManifests } from '../scripts/desktop-release-assets.mjs';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';

test('mac signing refreshes Kokoro G2P closure bytes after Mach-O signing', () => {
	const manifest = { schemaVersion: 1, runtimeVersion: '0.9.4', targetId: 'mac-arm64',
		runtimePrefix: 'assistance/kokoro-g2p/0.9.4', executable: 'kokoro-g2p',
		files: [{ path: 'kokoro-g2p', byteLength: 140, sha256: 'a'.repeat(64) }] };
	const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
	const summary = signedKokoroG2pSummary({ targetId: 'mac-arm64', fileCount: 1, byteLength: 100 }, bytes);
	assert.equal(summary.byteLength, 140);
	assert.equal(summary.manifest.byteLength, bytes.byteLength);
	assert.equal(summary.manifest.sha256, signingDigest(bytes));
});

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
	const signedStageBytes = await readFile(join(f.root, '.desktop-build/stage-manifest.json'));
	assert.equal(signedStageBytes.toString('utf8'),
		`${JSON.stringify(JSON.parse(signedStageBytes.toString('utf8')), null, 2)}\n`);
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

test('mac release accepts the separately signed and archived Sherpa receipt', async t => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-release-signing-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const saved = { ...process.env };
	Object.assign(process.env, { SCAPE_MAC_SIGNING: 'true', CSC_NAME: 'Developer ID Application: Test (ABCDEFGHIJ)',
		CSC_KEYCHAIN: '/temporary/keychain', APPLE_TEAM_ID: 'ABCDEFGHIJ' });
	t.after(() => { process.env = saved; });
	const build = join(root, '.desktop-build');
	const app = join(build, 'app');
	await mkdir(join(app, 'config'), { recursive: true });
	await mkdir(join(build, 'runtime'), { recursive: true });
	const native = structuredClone(assistance);
	const packageName = native.targets['mac-arm64'].package.name;
	const fileName = Object.keys(native.targets['mac-arm64'].package.files).find(name => name.endsWith('.node'));
	const original = native.targets['mac-arm64'].package.files[fileName];
	const signed = { byteLength: original.byteLength + 9, sha256: 'd'.repeat(64) };
	native.targets['mac-arm64'].package.files[fileName] = signed;
	const signedPath = `${native.runtimePrefix}/node_modules/${packageName}/${fileName}`;
	const signingFiles = [{ path: signedPath, original, signed }];
	const familyIds = ['onnxruntime-node', 'whisper-cpp', 'llama-cpp'];
	const families = { manifests: Object.fromEntries(familyIds.map(familyId => [familyId, {
		runtimeVersion: '1.0.0', runtimePrefix: `assistance/${familyId}/1.0.0`,
		targets: [{ id: 'mac-arm64', status: 'authenticated', files: [{ path: 'engine', byteLength: 1,
			sha256: 'a'.repeat(64), executable: familyId !== 'onnxruntime-node' }] }],
	}])) };
	const kokoro = { runtimeVersion: '0.9.4', runtimePrefix: 'assistance/kokoro-g2p/0.9.4', targetId: 'mac-arm64',
		executable: 'kokoro-g2p', files: [{ path: 'kokoro-g2p', byteLength: 1, sha256: 'a'.repeat(64) }] };
	const bundles = ['sherpa-onnx-node', ...familyIds, 'kokoro-g2p'].map(familyId => {
		const runtimeVersion = familyId === 'sherpa-onnx-node' ? native.version
			: familyId === 'kokoro-g2p' ? kokoro.runtimeVersion : '1.0.0';
		const runtimePrefix = familyId === 'sherpa-onnx-node' ? native.runtimePrefix
			: `assistance/${familyId}/${runtimeVersion}`;
		const files = familyId === 'sherpa-onnx-node'
			? [native.commonPackage, native.targets['mac-arm64'].package].flatMap(descriptor =>
				Object.entries(descriptor.files).map(([name, file]) => ({
					path: `node_modules/${descriptor.name}/${name}`, ...file, executable: false })))
			: [{ path: familyId === 'kokoro-g2p' ? 'kokoro-g2p' : 'engine', byteLength: 1,
				sha256: 'a'.repeat(64), executable: familyId !== 'onnxruntime-node' }];
		return { familyId, runtimeVersion, runtimePrefix,
			installPath: familyId === 'sherpa-onnx-node' ? runtimePrefix : `${runtimePrefix}/mac-arm64`,
			archive: { url: `https://assets.soundscaper.org/runtime/assistance/${familyId}/${runtimeVersion}/mac-arm64/${'b'.repeat(64)}.tar.gz`,
				sha256: 'b'.repeat(64), byteLength: 64 }, files };
	});
	const distributionBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, targetId: 'mac-arm64', bundles })}\n`);
	const receipt = { targetId: 'mac-arm64', signingFiles,
		manifest: { path: 'config/assistance-runtime-distribution.json',
			byteLength: distributionBytes.length, sha256: signingDigest(distributionBytes) },
		bundles: bundles.map(bundle => ({ familyId: bundle.familyId,
			sha256: bundle.archive.sha256, byteLength: bundle.archive.byteLength })) };
	for (const [name, value] of [
		['assistance-native-runtime-manifest.json', native],
		['assistance-runtime-family-supply-candidates.json', families],
		['assistance-kokoro-g2p-runtime-manifest.json', kokoro],
	]) await writeFile(join(app, 'config', name), canonicalSigningJson(value));
	await writeFile(join(app, 'config/assistance-runtime-distribution.json'), distributionBytes);
	await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'test' }));
	const stagePath = join(build, 'stage-manifest.json');
	await writeFile(stagePath, canonicalSigningJson({ target: { platform: 'mac', arch: 'arm64' },
		assistanceNativeRuntime: assistanceNativeRuntimeStageSummary(native, 'mac-arm64'),
		assistanceRuntimeDistribution: receipt }));
	const context = { electronPlatformName: 'darwin', appOutDir: join(root, 'output'),
		packager: { projectDir: root, getResourcesDir: () => join(root, 'output/Resources') } };
	await captureMacSigningInputs(context);
	await signVerifiedMacStage(context, { executeFile: async () => {
		throw new Error('The assistance archive was signed before packaging.');
	} });
	const stage = JSON.parse(await readFile(stagePath));
	assert.deepEqual(stage.nativeSigning.files, signingFiles);
	const release = { name: 'runtime-manifest-soundscaper-mac-arm64.json', value: {
		...stage, productId: 'soundscaper', desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		nativeAddons: { target: 'mac-arm64', targetSource: 'declared', status: 'ci-generated',
			payload: null, buildResult: null, blockedBy: null },
		framescaperNativeHosts: null } };
	assert.doesNotThrow(() => validateDesktopRuntimeManifests([release], ['soundscaper']));
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

test('signing refreshes ONNX, Whisper and llama runtime totals from their repinned file inventories', async t => {
	const f = await fixture(t);
	const binary = await readFile(f.path);
	const descriptor = { byteLength: binary.length, sha256: signingDigest(binary) };
	const manifests = {};
	const families = [];
	for (const familyId of ['onnxruntime-node', 'whisper-cpp', 'llama-cpp']) {
		const manifest = structuredClone(familyCandidates.manifests[familyId]);
		const entrypoint = familyId === 'onnxruntime-node' ? 'runtime.node' : familyId === 'llama-cpp' ? 'llama-completion' : 'whisper-cli';
		const file = { path: entrypoint, executable: familyId !== 'onnxruntime-node', ...descriptor };
		manifest.targets = manifest.targets.map(target => target.id !== 'mac-arm64' ? target : {
			id: target.id, status: 'authenticated', entrypoint, files: [file],
		});
		manifests[familyId] = manifest;
		const path = join(f.root, '.desktop-build/runtime', manifest.runtimePrefix, 'mac-arm64', entrypoint);
		await mkdir(join(path, '..'), { recursive: true });
		await writeFile(path, binary);
		families.push({ familyId, runtimeVersion: manifest.runtimeVersion, targetId: 'mac-arm64', files: 1,
			byteLength: binary.length, provenance: familyId !== 'onnxruntime-node'
				? { files: [file], installedBytes: binary.length }
				: { fileCount: 1, byteLength: binary.length } });
	}
	const manifestPath = 'config/assistance-runtime-family-supply-candidates.json';
	const familyBytes = canonicalSigningJson({ schemaVersion: 1, manifests });
	await writeFile(join(f.app, manifestPath), familyBytes);
	const stagePath = join(f.root, '.desktop-build/stage-manifest.json');
	const stage = JSON.parse(await readFile(stagePath));
	stage.assistanceRuntimeFamilies = { targetId: 'mac-arm64', families,
		manifest: { path: manifestPath, byteLength: familyBytes.length, sha256: signingDigest(familyBytes) } };
	await writeFile(stagePath, canonicalSigningJson(stage));
	await captureMacSigningInputs(f.context);
	await signVerifiedMacStage(f.context, { executeFile: f.executeFile });
	const signed = JSON.parse(await readFile(stagePath)).assistanceRuntimeFamilies;
	const signedManifestBytes = await readFile(join(f.app, manifestPath));
	assert.equal(signed.manifest.sha256, signingDigest(signedManifestBytes));
	assert.equal(signed.manifest.byteLength, signedManifestBytes.length);
	for (const family of signed.families) {
		assert.equal(family.byteLength, binary.length + 9);
		if (family.familyId !== 'onnxruntime-node') assert.equal(family.provenance.installedBytes, family.byteLength);
		else assert.equal(family.provenance.byteLength, family.byteLength);
	}
});

test('signing pin replacement preserves numeric file counts without inventing an empty inventory', () => {
	const summary = { files: 17, byteLength: 1234, sourceSha256: 'unchanged-source' };
	assert.deepEqual(rebindSigningPins(summary, new Map()), summary);
});
