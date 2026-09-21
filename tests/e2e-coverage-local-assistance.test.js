/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { loadE2EBuildEvidence } from '../scripts/lib/e2e-coverage-build-evidence.mjs';
import { assembleLocalAssistanceRawProfiles } from '../scripts/lib/e2e-coverage-local-assistance.mjs';
import {
	cleanupE2ECoverageAssemblerFixtures,
	makeFixture,
	readJson,
	readProfiles,
	v8Entry,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';
import {
	localAssistanceSessionPath,
	refreshLocalAssistanceFileRecord,
	rewriteLocalAssistanceManifest,
} from './helpers/e2e-coverage-local-assistance-fixture.mjs';

const PRODUCT = 'soundscaper';
const NODE_FILE = 'coverage-4312-1000-0.json';

after(cleanupE2ECoverageAssemblerFixtures);

test('local sessions add authenticated main and preload evidence with reused PIDs isolated by directory', () => {
	const fixture = makeFixture();
	const result = assembleE2ECoverageCapture(fixture);
	for (const realm of ['main', 'preload']) {
		const profiles = readProfiles(join(
			result.outputRoot, `profiles/nightly-electron-soundscaper-${realm}`,
		));
		const canonical = `file:///__soundscaper_e2e__/electron/soundscaper/${realm}/app/desktop/`;
		assert.equal(profiles.flatMap(({ result: entries }) => entries)
			.filter(({ url }) => url.startsWith(canonical)).length, 2,
			`ordinary and local ${realm} executions both remain in the union`);
	}
	assert.equal(readJson(join(
		localAssistanceSessionPath(fixture.runRoot, 'framescaper'), 'session.json',
	)).mainProcessId, readJson(join(
		localAssistanceSessionPath(fixture.runRoot, 'soundscaper'), 'session.json',
	)).mainProcessId, 'same PIDs in separate sessions do not create cross-product attribution');
});

test('local PID binding remains session-scoped when it collides with an ordinary packaged PID', () => {
	const fixture = makeFixture();
	const directory = localAssistanceSessionPath(fixture.runRoot, 'framescaper');
	const replacement = 'coverage-4100-1000-0.json';
	renameSync(join(directory, NODE_FILE), join(directory, replacement));
	rewriteLocalAssistanceManifest(fixture.runRoot, 'framescaper', (manifest) => {
		manifest.mainProcessId = 4100;
		manifest.nodeProfiles[0].fileName = replacement;
	});
	assert.doesNotThrow(() => assembleE2ECoverageCapture(fixture));
});

test('local sessions cannot replace either ordinary packaged runtime or an ordinary main surface', () => {
	const missingRuntime = makeFixture();
	rmSync(join(missingRuntime.runRoot, 'coverage/v8-packaged/packaged-soundscaper.json'));
	assert.throws(() => assembleE2ECoverageCapture(missingRuntime), /both product runtimes/u);

	const missingMain = makeFixture();
	rmSync(join(missingMain.runRoot, 'coverage/v8-packaged/coverage-4101-fixture-0.json'));
	assert.throws(() => assembleE2ECoverageCapture(missingMain), /ordinary packaged coverage.*surface/iu);
});

test('local assistance requires a closed session for both products', () => {
	const fixture = makeFixture();
	rmSync(localAssistanceSessionPath(fixture.runRoot, 'framescaper'), { recursive: true });
	assert.throws(() => assembleE2ECoverageCapture(fixture), /does not identify both product runtimes/u);

	const missingRoot = makeFixture();
	rmSync(join(missingRoot.runRoot, 'coverage/v8-local-assistance'), { recursive: true });
	assert.throws(() => assembleE2ECoverageCapture(missingRoot), /coverage directory is missing/u);
});

test('local session files are hash-bound and their directory inventory is closed', () => {
	const tampered = makeFixture();
	writeJson(localFile(tampered, NODE_FILE), { result: [] });
	assert.throws(() => assembleE2ECoverageCapture(tampered), /differs from its inventory/u);

	const extra = makeFixture();
	writeFileSync(localFile(extra, 'extra.json'), '{}');
	assert.throws(() => assembleE2ECoverageCapture(extra), /incomplete raw profile inventory/u);

	const nested = makeFixture();
	mkdirSync(localFile(nested, 'nested'));
	assert.throws(() => assembleE2ECoverageCapture(nested), /non-file entry/u);

	const linked = makeFixture();
	symlinkSync(localFile(linked, 'cdp.json'), localFile(linked, 'linked.json'));
	assert.throws(() => assembleE2ECoverageCapture(linked), /non-file entry/u);
});

test('local archive and Resources witnesses must equal revision-bound build evidence', () => {
	for (const field of ['productAppAsar', 'executableResources']) {
		const fixture = makeFixture();
		rewriteLocalAssistanceManifest(fixture.runRoot, PRODUCT, (manifest) => {
			manifest[field].beforeLaunch.sha256 = 'f'.repeat(64);
			manifest[field].afterCollection.sha256 = 'f'.repeat(64);
		});
		assert.throws(
			() => assembleE2ECoverageCapture(fixture),
			field === 'productAppAsar' ? /invalid product archive identity/u : /invalid executable-resource identity/u,
		);
	}
});

test('local metadata rejects launch mutation, detached Resources, bad accounting, and non-clean exit', () => {
	const cases = [
		[(manifest) => { manifest.productAppAsar.afterCollection.sha256 = 'e'.repeat(64); }, /invalid product archive identity/u],
		[(manifest) => { manifest.executableResources.path = '/tmp/resources'; }, /invalid executable-resource identity/u],
		[(manifest) => { manifest.targetTypes = ['worker']; }, /invalid runtime metadata/u],
		[(manifest) => { manifest.processExit.code = 2; }, /invalid runtime metadata/u],
	];
	for (const [mutate, expected] of cases) {
		const fixture = makeFixture();
		rewriteLocalAssistanceManifest(fixture.runRoot, PRODUCT, mutate);
		assert.throws(() => assembleE2ECoverageCapture(fixture), expected);
	}
});

test('local session requires its exact main PID thread-zero profile to execute product main code', () => {
	const wrongPid = makeFixture();
	rewriteLocalAssistanceManifest(wrongPid.runRoot, PRODUCT, (manifest) => {
		manifest.mainProcessId = 9999;
	});
	assert.throws(() => assembleE2ECoverageCapture(wrongPid), /no main-process thread 0/u);

	const noMain = makeFixture();
	const profile = readJson(localFile(noMain, NODE_FILE));
	profile.result = profile.result.filter(({ url }) => !url.endsWith('/desktop/main.mjs'));
	writeJson(localFile(noMain, NODE_FILE), profile);
	refreshLocalAssistanceFileRecord(noMain.runRoot, PRODUCT, NODE_FILE);
	assert.throws(() => assembleE2ECoverageCapture(noMain), /main profile recorded no product main code/u);
});

test('local preload evidence requires the exact captured source and preload realm', () => {
	const stale = makeFixture();
	const staleProfile = readJson(localFile(stale, 'cdp.json'));
	const [preloadUrl] = Object.keys(staleProfile['script-source-cache']);
	staleProfile['script-source-cache'][preloadUrl] = 'stale preload source';
	writeJson(localFile(stale, 'cdp.json'), staleProfile);
	refreshLocalAssistanceFileRecord(stale.runRoot, PRODUCT, 'cdp.json');
	assert.throws(() => assembleE2ECoverageCapture(stale), /script bytes are stale/u);

	const wrongRealm = makeFixture();
	const profile = readJson(localFile(wrongRealm, 'cdp.json'));
	const [url] = Object.keys(profile['script-source-cache']);
	const mainUrl = url.replace('/desktop/preload.js', '/desktop/main.mjs');
	profile.result[0].url = mainUrl;
	profile['script-source-cache'][mainUrl] = profile['script-source-cache'][url];
	delete profile['script-source-cache'][url];
	writeJson(localFile(wrongRealm, 'cdp.json'), profile);
	refreshLocalAssistanceFileRecord(wrongRealm.runRoot, PRODUCT, 'cdp.json');
	assert.throws(() => assembleE2ECoverageCapture(wrongRealm), /unmapped product script/u);
});

test('local classifier rejects unknown alias, launcher, payload, Resources, and absolute scripts', () => {
	const mutations = [
		['file:///opt/nightly/resources/nightly-tests/products/soundscaper.asar/desktop/unknown.mjs', /unmapped product script/u],
		['file:///opt/nightly/resources/app.asar/desktop/nightly-tests-main-extra.mjs', /unapproved launcher script/u],
		['file:///opt/nightly/resources/nightly-tests/foreign.mjs', /unapproved staged script/u],
		['file:///opt/nightly/resources/nightly-tests/products/soundscaper/linux-unpacked/resources/runtime/unknown.js', /un-inventoried product resource/u],
		['file:///tmp/foreign.js', /unapproved absolute script/u],
		['file:///tmp/electron.asar/foreign.js', /unapproved absolute script/u],
		['file:///tmp/foreign', /unapproved absolute script/u],
		['file:///opt/nightly/resources/nightly-tests/products/soundscaper/linux-unpacked/resources/runtime/foreign', /un-inventoried product resource/u],
	];
	for (const [url, expected] of mutations) {
		const fixture = makeFixture();
		const profile = readJson(localFile(fixture, NODE_FILE));
		profile.result.push(v8Entry(url));
		writeJson(localFile(fixture, NODE_FILE), profile);
		refreshLocalAssistanceFileRecord(fixture.runRoot, PRODUCT, NODE_FILE);
		assert.throws(() => assembleE2ECoverageCapture(fixture), expected);
	}
});

test('only Electron internal ASAR paths below authenticated Resources roots are ignored', () => {
	const fixture = makeFixture();
	const profile = readJson(localFile(fixture, NODE_FILE));
	profile.result.push(
		v8Entry('file:///opt/nightly/resources/electron.asar/browser/init.js'),
		v8Entry('file:///opt/nightly/resources/nightly-tests/products/soundscaper/linux-unpacked/resources/electron.asar/browser/init.js'),
	);
	writeJson(localFile(fixture, NODE_FILE), profile);
	refreshLocalAssistanceFileRecord(fixture.runRoot, PRODUCT, NODE_FILE);
	assert.doesNotThrow(() => assembleE2ECoverageCapture(fixture));
});

test('local Node evidence rejects unbound non-file executable URLs', () => {
	for (const url of [
		'data:text/javascript,globalThis.spoofed=true',
		'blob:https://example.invalid/spoofed',
		'evalmachine.<anonymous>',
		'file:///%zz',
		'node:internal/../spoofed',
	]) {
		const fixture = makeFixture();
		const profile = readJson(localFile(fixture, NODE_FILE));
		profile.result.push(v8Entry(url));
		writeJson(localFile(fixture, NODE_FILE), profile);
		refreshLocalAssistanceFileRecord(fixture.runRoot, PRODUCT, NODE_FILE);
		assert.throws(() => assembleE2ECoverageCapture(fixture), /unapproved non-file script/u);
	}
});

test('local-only mapped descriptors carry their authenticated source-map cache', () => {
	const fixture = makeFixture();
	const evidence = loadE2EBuildEvidence({
		evidenceRoot: fixture.evidenceRoot,
		repositoryRoot: fixture.repositoryRoot,
		sourceRevision: fixture.expectedRevision,
	});
	const product = evidence.electron.get(PRODUCT);
	const main = product.scripts.find(({ realm }) => realm === 'main');
	const mapped = { ...main, sourceMap: { lineLengths: [1], data: {
		version: 3, sources: ['file:///__soundscaper_repo__/desktop/mapped.ts'], names: [], mappings: 'AAAA',
	}, url: null } };
	const scripts = product.scripts.map((script) => script === main ? mapped : script);
	const electron = new Map(evidence.electron);
	electron.set(PRODUCT, {
		...product,
		scripts,
		scriptsByArtifactPath: new Map(scripts.map((script) => [script.artifactPath, script])),
		scriptsByPackagedPath: new Map(scripts.map((script) => [script.packagedPath, script])),
	});
	const profiles = assembleLocalAssistanceRawProfiles({
		directory: join(fixture.runRoot, 'coverage/v8-local-assistance'),
		evidence: { ...evidence, electron },
		runRuntime: { platform: 'linux', arch: 'x64' },
	});
	assert.deepEqual(
		profiles.get('nightly-electron-soundscaper-main')[0].profile['source-map-cache'][main.coverageUrl],
		mapped.sourceMap,
	);
});

test('only the exact Playwright evaluation URL is excluded from local CDP evidence', () => {
	const exact = makeFixture();
	const accepted = readJson(localFile(exact, 'cdp.json'));
	accepted.result.push(v8Entry('__playwright_evaluation_script__'));
	writeJson(localFile(exact, 'cdp.json'), accepted);
	refreshLocalAssistanceFileRecord(exact.runRoot, PRODUCT, 'cdp.json');
	assert.doesNotThrow(() => assembleE2ECoverageCapture(exact));

	const near = makeFixture();
	const rejected = readJson(localFile(near, 'cdp.json'));
	rejected.result.push(v8Entry('__playwright_evaluation_script__-near'));
	writeJson(localFile(near, 'cdp.json'), rejected);
	refreshLocalAssistanceFileRecord(near.runRoot, PRODUCT, 'cdp.json');
	assert.throws(() => assembleE2ECoverageCapture(near), /unapproved host script/u);
});

test('excluded Resources source bytes are authenticated when observed by CDP', () => {
	const fixture = makeFixture();
	const profile = readJson(localFile(fixture, 'cdp.json'));
	const url = 'file:///opt/nightly/resources/nightly-tests/products/soundscaper/linux-unpacked/resources/runtime/fixture-vendor/index.js';
	profile.result.push(v8Entry(url));
	profile['script-source-cache'][url] = 'stale runtime bytes';
	writeJson(localFile(fixture, 'cdp.json'), profile);
	refreshLocalAssistanceFileRecord(fixture.runRoot, PRODUCT, 'cdp.json');
	assert.throws(() => assembleE2ECoverageCapture(fixture), /excluded runtime script bytes are stale/u);
});

test('local raw roots cannot be selected as assembler output and remain intact on rejection', () => {
	const fixture = makeFixture();
	const session = localAssistanceSessionPath(fixture.runRoot, PRODUCT);
	assert.throws(() => assembleE2ECoverageCapture({
		...fixture,
		outputRoot: join(session, 'assembled'),
	}), /dedicated directory/u);
	assert.equal(existsSync(join(session, 'session.json')), true);
});

function localFile(fixture, name) {
	return join(localAssistanceSessionPath(fixture.runRoot, PRODUCT), name);
}
