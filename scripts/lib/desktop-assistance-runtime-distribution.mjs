/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build the optional AI distribution after authenticating target-native payloads. */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, open, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { assistanceNativeRuntimeStageSummary } from '../../desktop/assistance-native-runtime-payload.mjs';
import { signedAssistanceFamilySummary } from './desktop-signed-assistance-family-summary.mjs';
import { createAssistanceRuntimeArchive } from './desktop-assistance-runtime-archive.mjs';

const execute = promisify(execFile);
const MANIFEST_PATH = 'config/assistance-runtime-distribution.json';
const MACH_O = new Set(['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
const FAMILY_IDS = ['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p'];

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function describeFile(path, executable) {
	const info = await lstat(path);
	assert(info.isFile() && !info.isSymbolicLink(), `Assistance runtime is not a regular file: ${path}`);
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return { byteLength: info.size, sha256: hash.digest('hex'), executable };
}

async function signMacFile(path, { executeFile = execute, team, identity, keychain }) {
	const handle = await open(path, 'r');
	const magic = Buffer.alloc(4);
	try { await handle.read(magic, 0, 4, 0); }
	finally { await handle.close(); }
	if (!MACH_O.has(magic.toString('hex'))) return false;
	// The original bytes were authenticated against source pins immediately
	// before signing. Apple does not promise that removing a replacement
	// signature recreates the exact unsigned Mach-O bytes, so authenticate the
	// resulting identity and bind its actual bytes to the archive instead.
	await executeFile('codesign', ['--force', '--sign', identity, '--keychain', keychain,
		'--options', 'runtime', '--preserve-metadata=entitlements', '--timestamp', path]);
	await executeFile('codesign', ['--verify', '--strict', '--test-requirement',
		`anchor apple generic and certificate leaf[subject.OU] = "${team}"`, path]);
	return true;
}

function signingOptions(targetId, environment, executeFile, runtimeRoot) {
	if (targetId !== 'mac-arm64' || environment.SCAPE_MAC_SIGNING !== 'true') return null;
	const { CSC_NAME: identity, CSC_KEYCHAIN: keychain, APPLE_TEAM_ID: team } = environment;
	assert(identity?.startsWith('Developer ID Application: ')
		&& identity.endsWith(`(${team})`)
		&& keychain && /^[A-Z0-9]{10}$/u.test(team ?? ''),
		'Mac assistance runtime signing credentials are incomplete.');
	return { executeFile, team, identity, keychain, runtimeRoot, files: [] };
}

async function refreshedFile(path, file, signing) {
	const executable = typeof file.executable === 'boolean'
		? file.executable : Boolean((await lstat(path)).mode & 0o111);
	const unsigned = await describeFile(path, executable);
	assert(unsigned.byteLength === file.byteLength && unsigned.sha256 === file.sha256,
		`Assistance runtime changed after staging: ${file.path}`);
	const signed = signing ? await signMacFile(path, signing) : false;
	if (executable) await chmod(path, 0o755);
	const output = await describeFile(path, executable);
	if (signed) signing.files.push({ path: relative(signing.runtimeRoot, path).replaceAll('\\', '/'),
		original: { byteLength: unsigned.byteLength, sha256: unsigned.sha256 },
		signed: { byteLength: output.byteLength, sha256: output.sha256 } });
	return { path: file.path, ...output };
}

/** Re-pin signed bytes in the original authority documents before sealing archives. */
export async function prepareAssistanceRuntimeDistributionSources({
	targetId, runtimeRoot, assistanceSpeechRuntime, assistanceRuntimeFamilies, kokoroG2pRuntime,
	environment = process.env, executeFile = execute,
}) {
	const signing = signingOptions(targetId, environment, executeFile, runtimeRoot);
	const speech = structuredClone(assistanceSpeechRuntime.manifest);
	const speechSummary = assistanceSpeechRuntime.summary;
	assert(speechSummary.status === 'built' && speechSummary.target === targetId,
		'Assistance speech target is not built.');
	const speechFiles = [];
	for (const [path, file] of Object.entries(speechSummary.payload.files)) {
		const absolute = resolve(runtimeRoot, speech.runtimePrefix, path);
		const refreshed = await refreshedFile(absolute, { path, ...file }, signing);
		speechFiles.push(refreshed);
		const [, packageName, ...remainder] = path.split('/');
		const packageFile = remainder.join('/');
		const descriptor = packageName === speech.commonPackage.name
			? speech.commonPackage.files[packageFile] : speech.targets[targetId].package.files[packageFile];
		assert(descriptor && descriptor.byteLength === file.byteLength && descriptor.sha256 === file.sha256,
			'Assistance speech manifest and staged file disagree.');
		descriptor.byteLength = refreshed.byteLength;
		descriptor.sha256 = refreshed.sha256;
	}
	const speechResult = {
		...assistanceSpeechRuntime,
		manifest: speech,
		summary: assistanceNativeRuntimeStageSummary(speech, targetId),
	};
	const familyRegister = JSON.parse(assistanceRuntimeFamilies.manifestBytes.toString('utf8'));
	for (const familyId of ['onnxruntime-node', 'whisper-cpp', 'llama-cpp']) {
		const family = familyRegister.manifests[familyId];
		const target = family.targets.find(({ id }) => id === targetId);
		assert(target.status === 'authenticated', `Assistance ${familyId} target is not authenticated.`);
		for (const file of target.files) {
			const refreshed = await refreshedFile(resolve(runtimeRoot, family.runtimePrefix, targetId, file.path), file, signing);
			file.byteLength = refreshed.byteLength;
			file.sha256 = refreshed.sha256;
		}
	}
	const familyBytes = Buffer.from(`${JSON.stringify(familyRegister, null, 2)}\n`);
	const familySummary = signedAssistanceFamilySummary(assistanceRuntimeFamilies.summary, familyRegister);
	familySummary.manifest = { path: 'config/assistance-runtime-family-supply-candidates.json',
		byteLength: familyBytes.byteLength, sha256: digest(familyBytes) };
	const familyResult = { ...assistanceRuntimeFamilies,
		manifestBytes: familyBytes, summary: familySummary };
	const kokoro = structuredClone(kokoroG2pRuntime.manifest);
	assert(kokoro.targetId === targetId, 'Kokoro G2P target is invalid.');
	const kokoroFiles = [];
	for (const file of kokoro.files) {
		// Windows does not expose PE executability through POSIX mode bits.
		const runtimeFile = file.path === kokoro.executable
			? { ...file, executable: true } : file;
		const refreshed = await refreshedFile(resolve(runtimeRoot, kokoro.runtimePrefix, targetId, file.path),
			runtimeFile, signing);
		file.byteLength = refreshed.byteLength;
		file.sha256 = refreshed.sha256;
		kokoroFiles.push(refreshed);
	}
	const kokoroBytes = Buffer.from(`${JSON.stringify(kokoro, null, 2)}\n`);
	const kokoroResult = { ...kokoroG2pRuntime, manifest: kokoro, manifestBytes: kokoroBytes,
		summary: { targetId, fileCount: kokoro.files.length,
			byteLength: kokoro.files.reduce((sum, file) => sum + file.byteLength, 0) } };
	return { speech: speechResult, families: familyResult, kokoro: kokoroResult, speechFiles, kokoroFiles,
		familyRegister, signingFiles: signing?.files ?? [] };
}

/** Produce all five immutable, target-specific bundles and remove their install bytes. */
export async function stageDesktopAssistanceRuntimeDistribution({
	targetId, runtimeRoot, archiveRoot, assistanceSpeechRuntime,
	assistanceRuntimeFamilies, kokoroG2pRuntime, environment, executeFile,
}) {
	const sources = await prepareAssistanceRuntimeDistributionSources({ targetId, runtimeRoot,
		assistanceSpeechRuntime, assistanceRuntimeFamilies, kokoroG2pRuntime, environment, executeFile });
	const { speech, families, kokoro, speechFiles, kokoroFiles, familyRegister, signingFiles } = sources;
	const bundleInputs = [{ familyId: 'sherpa-onnx-node', runtimeVersion: speech.manifest.version,
		runtimePrefix: speech.manifest.runtimePrefix, installPath: speech.manifest.runtimePrefix,
		files: speechFiles }];
	for (const familyId of ['onnxruntime-node', 'whisper-cpp', 'llama-cpp']) {
		const family = familyRegister.manifests[familyId];
		bundleInputs.push({ familyId, runtimeVersion: family.runtimeVersion,
			runtimePrefix: family.runtimePrefix, installPath: `${family.runtimePrefix}/${targetId}`,
			files: family.targets.find(({ id }) => id === targetId).files });
	}
	bundleInputs.push({ familyId: 'kokoro-g2p', runtimeVersion: kokoro.manifest.runtimeVersion,
		runtimePrefix: kokoro.manifest.runtimePrefix,
		installPath: `${kokoro.manifest.runtimePrefix}/${targetId}`, files: kokoroFiles });
	const archives = [];
	for (const input of bundleInputs) {
		archives.push(await createAssistanceRuntimeArchive({ ...input, targetId, runtimeRoot, archiveRoot }));
	}
	assert(JSON.stringify(archives.map(({ bundle }) => bundle.familyId)) === JSON.stringify(FAMILY_IDS),
		'Assistance distribution family inventory is incomplete.');
	const manifest = { schemaVersion: 1, targetId, bundles: archives.map(({ bundle }) => bundle) };
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	const summary = { targetId, manifest: { path: MANIFEST_PATH, byteLength: manifestBytes.byteLength,
		sha256: digest(manifestBytes) }, signingFiles, bundles: archives.map(({ bundle }) => ({
		familyId: bundle.familyId, sha256: bundle.archive.sha256,
		byteLength: bundle.archive.byteLength,
	})) };
	await rm(resolve(runtimeRoot, 'assistance'), { recursive: true, force: true });
	return { manifest, manifestBytes, summary, archives, speech, families, kokoro };
}
