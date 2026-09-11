/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { assistanceNativeRuntimeStageSummary } from '../../desktop/assistance-native-runtime-payload.mjs';
import { canonicalSigningJson, rebindSigningPins, signingDigest } from './desktop-signing-pins.mjs';
import { signedAssistanceFamilySummary } from './desktop-signed-assistance-family-summary.mjs';

const execute = promisify(execFile);
const signedStages = new WeakMap();
const unsignedStages = new WeakMap();
const MACH_O = new Set(['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

export async function captureMacSigningInputs(context) {
	const root = resolve(context.packager.projectDir, '.desktop-build/runtime');
	unsignedStages.set(context.packager, await digestStageFiles(root));
}

/** Called only after every ordinary beforePack provenance check succeeds. */
export async function signVerifiedMacStage(context, dependencies = {}) {
	const executeFile = dependencies.executeFile ?? execute;
	if (context.electronPlatformName !== 'darwin' || process.env.SCAPE_MAC_SIGNING !== 'true') return;
	if (signedStages.has(context.packager)) throw new Error('A signed stage must be prepared again before repackaging.');
	const identity = process.env.CSC_NAME;
	const keychain = process.env.CSC_KEYCHAIN;
	const team = process.env.APPLE_TEAM_ID;
	if (!identity || !keychain || !/^[A-Z0-9]{10}$/u.test(team ?? '')) throw new Error('Mac signing credentials are incomplete.');
	const root = resolve(context.packager.projectDir, '.desktop-build');
	const runtime = await stageFiles(join(root, 'runtime'));
	const originalInputs = unsignedStages.get(context.packager);
	if (!originalInputs) throw new Error('Mac signing inputs were not captured before provenance verification.');
	assertSameFiles(originalInputs,
		new Map([...runtime].map(([name, bytes]) => [name, signingDigest(bytes)])), 'verified unsigned runtime');
	const app = await stageFiles(join(root, 'app'));
	const replacements = new Map();
	const signingFiles = [];
	const signedCopies = new Map();
	const temporary = await mkdtemp(join(tmpdir(), 'scape-signing-'));
	try {
		for (const [name, bytes] of runtime) {
			if (!MACH_O.has(bytes.subarray(0, 4).toString('hex'))) continue;
			const path = join(root, 'runtime', name);
			const originalHash = signingDigest(bytes);
			const cached = signedCopies.get(originalHash);
			if (cached) {
				await writeFile(path, cached);
				signingFiles.push({ path: name,
					original: { sha256: originalHash, byteLength: bytes.length },
					signed: replacements.get(originalHash) });
				continue;
			}
			const original = join(temporary, 'original');
			const signed = join(temporary, 'signed');
			await copyFile(path, original);
			if (!(await readFile(original)).equals(bytes)) throw new Error(`Native input changed before signing: ${name}`);
			await executeFile('codesign', ['--force', '--sign', identity, '--keychain', keychain,
				'--options', 'runtime', '--preserve-metadata=entitlements', '--timestamp', path]);
			await executeFile('codesign', ['--verify', '--strict', '--test-requirement',
				`anchor apple generic and certificate leaf[subject.OU] = "${team}"`, path]);
			await copyFile(path, signed);
			// Re-signing must not alter executable contents. Compare both inputs
			// after Apple's own tool removes their signature envelopes.
			try { await executeFile('codesign', ['--remove-signature', original]); }
			catch (error) {
				if (!String(error.stderr).includes('code object is not signed at all')) throw error;
			}
			await executeFile('codesign', ['--remove-signature', signed]);
			if (!(await readFile(original)).equals(await readFile(signed))) {
				throw new Error(`Signing changed executable content: ${name}`);
			}
			const output = await readFile(path);
			signedCopies.set(originalHash, output);
			replacements.set(originalHash, { sha256: signingDigest(output), byteLength: output.length });
			signingFiles.push({ path: name,
				original: { sha256: signingDigest(bytes), byteLength: bytes.length },
				signed: { sha256: signingDigest(output), byteLength: output.length } });
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
	const documents = new Map();
	for (const [prefix, files] of [['runtime', runtime], ['app', app]]) {
		for (const [name, bytes] of files) {
			if (name.endsWith('.json')) documents.set(join(root, prefix, name), bytes);
			else if (/\.[cm]?js$/u.test(name) && [...replacements.keys()].some(hash => bytes.includes(hash))) {
				throw new Error(`Native signing pins are embedded in executable JavaScript: ${name}`);
			}
		}
	}
	documents.set(join(root, 'stage-manifest.json'), await readFile(join(root, 'stage-manifest.json')));
	await repinStageDocuments(documents, replacements);
	const assistance = JSON.parse(await readFile(join(root, 'app/config/assistance-native-runtime-manifest.json'), 'utf8'));
	const stagePath = join(root, 'stage-manifest.json');
	const stage = JSON.parse(await readFile(stagePath, 'utf8'));
	stage.assistanceNativeRuntime = assistanceNativeRuntimeStageSummary(assistance, `mac-${stage.target.arch}`);
	if (stage.assistanceRuntimeFamilies !== undefined) {
		const families = JSON.parse(await readFile(join(root, 'app/config/assistance-runtime-family-supply-candidates.json'), 'utf8'));
		stage.assistanceRuntimeFamilies = signedAssistanceFamilySummary(stage.assistanceRuntimeFamilies, families);
	}
	stage.nativeSigning = { schemaVersion: 1, teamId: team, files: signingFiles };
	await writeFile(stagePath, canonicalSigningJson(stage));
	signedStages.set(context.packager, {
		runtime: await digestStageFiles(join(root, 'runtime')),
		app: await digestStageFiles(join(root, 'app')),
		stage: signingDigest(await readFile(stagePath)), root,
	});
}

export async function repinStageDocuments(documents, replacements) {
	let changed = true;
	for (let iteration = 0; changed && iteration < 32; iteration += 1) {
		changed = false;
		for (const [path, original] of documents) {
			const value = JSON.parse(original.toString());
			const updated = rebindSigningPins(value, replacements);
			if (JSON.stringify(value) === JSON.stringify(updated)) continue;
			const bytes = canonicalSigningJson(updated);
			const oldHash = signingDigest(original);
			const sha256 = signingDigest(bytes);
			if (replacements.get(oldHash)?.sha256 === sha256) continue;
			replacements.set(oldHash, { sha256, byteLength: bytes.length });
			await writeFile(path, bytes);
			changed = true;
		}
	}
	if (changed) throw new Error('Signed manifest dependency graph did not converge.');
}

/** Exact copy verification replaces the original-byte verifiers only for the
 * stage this process has just authenticated, signed and repinned itself. */
export async function verifySignedMacPackage(context) {
	const signed = signedStages.get(context.packager);
	if (!signed) {
		if (context.electronPlatformName === 'darwin' && process.env.SCAPE_MAC_SIGNING === 'true') {
			throw new Error('Mac package has no verified signing-stage authority.');
		}
		return false;
	}
	const resources = context.packager.getResourcesDir(context.appOutDir);
	const runtime = await digestStageFiles(join(resources, 'runtime'));
	assertSameFiles(signed.runtime, runtime, 'signed runtime');
	const asar = join(resources, 'app.asar');
	const installed = new Map();
	for (const path of listPackage(asar)) {
		const name = path.replace(/^[/\\]/u, '').replaceAll('\\', '/');
		const metadata = statFile(asar, name);
		if ('files' in metadata) continue;
		if ('link' in metadata) throw new Error('Signed application contains an unexpected ASAR link.');
		installed.set(name, signingDigest(extractFile(asar, name)));
	}
	assertSameFiles(signed.app, installed, 'signed application');
	if (signed.stage !== signingDigest(await readFile(join(signed.root, 'stage-manifest.json')))) {
		throw new Error('Signed runtime manifest changed during packaging.');
	}
	return true;
}

function assertSameFiles(expected, actual, label) {
	if (expected.size !== actual.size || [...expected].some(([name, hash]) => actual.get(name) !== hash)) {
		throw new Error(`The ${label} changed after signing.`);
	}
}

async function digestStageFiles(root) {
	return new Map([...await stageFiles(root)].map(([name, bytes]) => [name, signingDigest(bytes)]));
}

async function stageFiles(root) {
	const files = new Map();
	async function walk(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Signing stage contains a symlink: ${path}`);
			if (entry.isDirectory()) await walk(path);
			else {
				if (!(await lstat(path)).isFile()) throw new Error(`Signing stage contains a special file: ${path}`);
				files.set(relative(root, path).replaceAll('\\', '/'), await readFile(path));
			}
		}
	}
	await walk(root);
	return files;
}
