/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODUCTS = ['framescaper', 'soundscaper'];
const SESSION_IDS = Object.freeze({
	framescaper: '11111111-1111-4111-8111-111111111111',
	soundscaper: '22222222-2222-4222-8222-222222222222',
});

export function writeLocalAssistanceSessions(runRoot, evidenceRoot, runtimeScriptPath) {
	for (const productId of PRODUCTS) writeSession(runRoot, evidenceRoot, productId, runtimeScriptPath);
}

export function localAssistanceSessionPath(runRoot, productId) {
	return join(runRoot, 'coverage/v8-local-assistance', SESSION_IDS[productId]);
}

export function rewriteLocalAssistanceManifest(runRoot, productId, update) {
	const path = join(localAssistanceSessionPath(runRoot, productId), 'session.json');
	const manifest = JSON.parse(readFileSync(path, 'utf8'));
	update(manifest);
	writeJson(path, manifest);
}

export function refreshLocalAssistanceFileRecord(runRoot, productId, fileName) {
	const directory = localAssistanceSessionPath(runRoot, productId);
	rewriteLocalAssistanceManifest(runRoot, productId, (manifest) => {
		const record = fileName === 'cdp.json'
			? manifest.cdpProfile
			: manifest.nodeProfiles.find((candidate) => candidate.fileName === fileName);
		Object.assign(record, fileRecord(join(directory, fileName), fileName));
	});
}

export function refreshLocalAssistanceEvidence(fixture, productId, evidence) {
	const directory = localAssistanceSessionPath(fixture.runRoot, productId);
	const manifest = JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8'));
	manifest.productAppAsar.beforeLaunch = { ...evidence.packageArchive };
	manifest.productAppAsar.afterCollection = { ...evidence.packageArchive };
	manifest.executableResources.beforeLaunch = { ...evidence.executableResources };
	manifest.executableResources.afterCollection = { ...evidence.executableResources };
	const nodeFile = manifest.nodeProfiles[0].fileName;
	const nodePath = join(directory, nodeFile);
	const node = JSON.parse(readFileSync(nodePath, 'utf8'));
	const runtime = node.result.find(({ url }) => url.includes('/runtime/'));
	if (runtime && evidence.excludedRuntimeScripts.length === 1) {
		runtime.url = `${fileUrl(manifest.executableResources.path, manifest.platform)}${evidence.excludedRuntimeScripts[0].path}`;
		writeJson(nodePath, node);
	}
	manifest.nodeProfiles = [fileRecord(nodePath, nodeFile)];
	writeJson(join(directory, 'session.json'), manifest);
}

export function rewriteLocalAssistanceLayout(fixture, layout, runtimeScriptPath) {
	const architecture = layout.platform === 'darwin' ? 'arm64' : 'x64';
	const paths = layout.platform === 'win32' ? win32 : posix;
	const hostExecutable = localHostExecutable(layout);
	const payloadRoot = paths.join(localResources(hostExecutable, layout.platform), 'nightly-tests');
	for (const productId of PRODUCTS) {
		const displayName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
		const productRoot = paths.join(payloadRoot, 'products');
		const alias = paths.join(productRoot, `${productId}.asar`);
		const executable = layout.platform === 'win32'
			? paths.join(productRoot, productId, 'win-unpacked', `${displayName}.exe`)
			: layout.platform === 'darwin'
				? paths.join(productRoot, productId, 'mac-arm64', `${displayName}.app`,
					'Contents', 'MacOS', displayName)
				: paths.join(productRoot, productId, 'linux-unpacked', productId);
		const resources = localResources(executable, layout.platform);
		const directory = localAssistanceSessionPath(fixture.runRoot, productId);
		const cdpPath = join(directory, 'cdp.json');
		const cdp = JSON.parse(readFileSync(cdpPath, 'utf8'));
		const preloadEntry = cdp.result[0];
		const preloadSource = cdp['script-source-cache'][preloadEntry.url];
		delete cdp['script-source-cache'][preloadEntry.url];
		preloadEntry.url = `${fileUrl(alias, layout.platform)}desktop/preload.js`;
		cdp['script-source-cache'][preloadEntry.url] = preloadSource;
		writeJson(cdpPath, cdp);
		const nodeFile = 'coverage-4312-1000-0.json';
		const nodePath = join(directory, nodeFile);
		const node = JSON.parse(readFileSync(nodePath, 'utf8'));
		node.result[0].url = `${fileUrl(alias, layout.platform)}desktop/main.mjs`;
		node.result[1].url = `${fileUrl(resources, layout.platform)}${runtimeScriptPath}`;
		node.result[2].url = `${fileUrl(paths.join(localResources(
			hostExecutable, layout.platform,
		), 'app.asar'), layout.platform)}desktop/nightly-tests-main.mjs`;
		writeJson(nodePath, node);
		rewriteLocalAssistanceManifest(fixture.runRoot, productId, (manifest) => {
			manifest.platform = layout.platform;
			manifest.architecture = architecture;
			manifest.hostExecutablePath = hostExecutable;
			manifest.productExecutablePath = executable;
			manifest.productAppAsar.path = alias;
			manifest.executableResources.path = resources;
			manifest.cdpProfile = fileRecord(cdpPath, 'cdp.json');
			manifest.nodeProfiles = [fileRecord(nodePath, nodeFile)];
		});
	}
}

function writeSession(runRoot, evidenceRoot, productId, runtimeScriptPath) {
	const sessionId = SESSION_IDS[productId];
	const directory = localAssistanceSessionPath(runRoot, productId);
	const productRoot = '/opt/nightly/resources/nightly-tests/products';
	const alias = `${productRoot}/${productId}.asar`;
	const executable = `${productRoot}/${productId}/linux-unpacked/${productId}`;
	const resources = `${productRoot}/${productId}/linux-unpacked/resources`;
	const evidence = JSON.parse(readFileSync(
		join(evidenceRoot, 'electron', productId, 'manifest.json'), 'utf8',
	));
	const preload = evidence.scripts.find(({ realm }) => realm === 'preload');
	const main = evidence.scripts.find(({ realm }) => realm === 'main');
	const preloadUrl = `file://${alias}/${preload.packagedPath.slice('app.asar/'.length)}`;
	const mainUrl = `file://${alias}/${main.packagedPath.slice('app.asar/'.length)}`;
	const cdp = {
		result: [v8Entry(preloadUrl)],
		'script-source-cache': {
			[preloadUrl]: readFileSync(join(evidenceRoot, 'electron', productId, preload.artifactPath), 'utf8'),
		},
		'source-map-cache': {},
	};
	const nodeFile = 'coverage-4312-1000-0.json';
	const node = { result: [
		v8Entry(mainUrl),
		v8Entry(`file://${resources}/${runtimeScriptPath}`),
		v8Entry('file:///opt/nightly/resources/app.asar/desktop/nightly-tests-main.mjs'),
		v8Entry('node:internal/bootstrap'),
	] };
	writeJson(join(directory, 'cdp.json'), cdp);
	writeJson(join(directory, nodeFile), node);
	writeJson(join(directory, 'session.json'), {
		architecture: 'x64',
		captureKind: 'local-assistance-cdp-precise-coverage',
		capturesChildTargets: true,
		cdpProfile: fileRecord(join(directory, 'cdp.json'), 'cdp.json'),
		childTargetStrategy: 'recursive-auto-attach-paused',
		executableResources: {
			path: resources,
			beforeLaunch: evidence.executableResources,
			afterCollection: evidence.executableResources,
		},
		hostExecutablePath: '/opt/nightly/soundscaper-nightly-tests',
		kind: 'soundscaper-local-assistance-runtime',
		mainProcessId: 4312,
		nodeProfiles: [fileRecord(join(directory, nodeFile), nodeFile)],
		pausedTargetCounts: {},
		platform: 'linux',
		processExit: { code: 0, signal: null },
		productAppAsar: {
			path: alias,
			beforeLaunch: evidence.packageArchive,
			afterCollection: evidence.packageArchive,
		},
		productExecutablePath: executable,
		productId,
		schemaVersion: 1,
		sessionId,
		sourceRevision: evidence.sourceRevision,
		targetCounts: {},
		targetTypes: [],
	});
}

function fileRecord(path, fileName) {
	const bytes = readFileSync(path);
	return { fileName, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex') };
}

function localHostExecutable(layout) {
	if (layout.platform === 'darwin') {
		return '/Applications/Nightly Tests.app/Contents/MacOS/Soundscaper Nightly Tests';
	}
	if (layout.platform === 'win32') {
		return layout.executable('framescaper').startsWith('\\\\')
			? '\\\\server\\share\\soundscaper-nightly-tests.exe'
			: 'C:\\Nightly builds\\soundscaper-nightly-tests.exe';
	}
	return '/opt/nightly/soundscaper-nightly-tests';
}

function localResources(executable, platform) {
	const paths = platform === 'win32' ? win32 : posix;
	return platform === 'darwin'
		? paths.resolve(paths.dirname(executable), '../Resources')
		: paths.resolve(paths.dirname(executable), 'resources');
}

function fileUrl(path, platform) {
	const url = pathToFileURL(path, { windows: platform === 'win32' }).href;
	return url.endsWith('/') ? url : `${url}/`;
}

function v8Entry(url) {
	return { scriptId: '1', url, functions: [{ functionName: '', isBlockCoverage: true,
		ranges: [{ startOffset: 0, endOffset: 1, count: 1 }] }] };
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}
