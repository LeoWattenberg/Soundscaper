/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import test from 'node:test';

import { stageDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import {
	createFixture, readJson, writeFixtureFile,
} from './helpers/nightly-tests-staging-fixture.js';

/**
 * What the nightly-tests staging refuses to put in the payload.
 *
 * `tests/desktop-nightly-tests-staging.test.js` checks that a correct checkout produces a
 * hermetic, manifest-bound payload. These check the other direction: a checkout that is
 * wrong in each of the ways it can be — a link leaving its root, a browser file packaging
 * cannot materialize, a destructive output path — fails the staging instead of shipping.
 */

test('nightly test staging rejects symlinked repository content and escaping browser links', async (context) => {
	const fixture = await createFixture(context);
	const outside = join(dirname(fixture.repositoryRoot), 'outside-index.html');
	await writeFile(outside, '<p>outside</p>');
	await rm(join(fixture.repositoryRoot, '.wrangler/browser-products/soundscaper/en/index.html'));
	await symlink(outside, join(fixture.repositoryRoot, '.wrangler/browser-products/soundscaper/en/index.html'));
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/verified Soundscaper browser site.*symbolic link/iu,
	);

	await rm(join(fixture.repositoryRoot, '.wrangler/browser-products/soundscaper/en/index.html'));
	await writeFile(join(fixture.repositoryRoot, '.wrangler/browser-products/soundscaper/en/index.html'), '<p>inside</p>');
	await symlink(outside, join(fixture.browserSourceRoot, 'firefox-102/escape'));
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/browser.*symbolic link.*(?:relative|leaves)/iu,
	);
});

test('nightly test staging admits only the exact optional registry-bound winldd tool', async (context) => {
	const fixture = await createFixture(context);
	await rm(join(fixture.browserSourceRoot, 'winldd-105'), { recursive: true });
	const withoutWinldd = await stageDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		outputRoot: fixture.outputRoot,
		browserSourceRoot: fixture.browserSourceRoot,
	});
	assert.equal(Object.hasOwn(withoutWinldd.manifest.browserRevisions, 'winldd'), false);

	await writeFixtureFile(fixture.browserSourceRoot, 'winldd-105/bin/winldd.exe', 'fixture');
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/installed winldd completion marker.*missing/iu,
	);
	await rm(join(fixture.browserSourceRoot, 'winldd-105'), { recursive: true });
	await writeFixtureFile(fixture.browserSourceRoot, 'winldd-999/INSTALLATION_COMPLETE', '');
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/unexpected entries: winldd-999/iu,
	);
	assert.deepEqual(await readJson(join(fixture.outputRoot, 'stage-manifest.json')), withoutWinldd.manifest);
});

test('nightly test staging drops browser links that packaging cannot materialize', async (context) => {
	const fixture = await createFixture(context);
	await stageDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		outputRoot: fixture.outputRoot,
		browserSourceRoot: fixture.browserSourceRoot,
	});

	const framework = join(fixture.outputRoot, '.local-browsers/webkit-103/WebKit.framework');
	for (const kept of ['WebKit', 'Resources', 'Versions/Current']) {
		assert.equal((await lstat(join(framework, kept))).isSymbolicLink(), true, kept);
	}
	assert.equal(
		(await lstat(join(fixture.outputRoot, '.local-browsers/webkit-103/libalias'))).isSymbolicLink(),
		true,
	);
	for (const dropped of ['Frameworks', 'Modules']) {
		await assert.rejects(() => lstat(join(framework, dropped)), /ENOENT/u, dropped);
	}
	assert.equal((await lstat(join(framework, 'Versions/A/Frameworks'))).isDirectory(), true);
	assert.equal((await lstat(join(framework, 'Versions/A/Modules/nested'))).isDirectory(), true);
});

test('nightly test staging drops framework headers no packaged browser reads', async (context) => {
	const fixture = await createFixture(context);
	await stageDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		outputRoot: fixture.outputRoot,
		browserSourceRoot: fixture.browserSourceRoot,
	});

	const browsers = join(fixture.outputRoot, '.local-browsers');
	const framework = join(browsers, 'webkit-103/WebKit.framework');
	for (const dropped of ['Versions/A/Headers', 'Versions/A/PrivateHeaders', 'Headers', 'PrivateHeaders']) {
		await assert.rejects(() => lstat(join(framework, dropped)), /ENOENT/u, dropped);
	}
	assert.equal((await lstat(join(framework, 'Versions/A/WebKit'))).isFile(), true);
	assert.equal(
		(await lstat(join(framework, 'Versions/A/Resources/Info.plist'))).isFile(),
		true,
	);
	assert.equal(
		(await lstat(join(browsers, 'webkit-103/Headers/keep.h'))).isFile(),
		true,
		'headers outside a framework bundle stay',
	);
});

test('nightly test staging drops the framework linker stubs macOS signing refuses', async (context) => {
	// codesign walks a framework and treats a .tbd sitting beside the binary as a
	// subcomponent of it. A .tbd is a text symbol description only the linker reads, so
	// it carries no signature, and the whole bundle failed with "code object is not
	// signed at all" before the mac package could be produced.
	const fixture = await createFixture(context);
	await stageDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		outputRoot: fixture.outputRoot,
		browserSourceRoot: fixture.browserSourceRoot,
	});

	const browsers = join(fixture.outputRoot, '.local-browsers');
	await assert.rejects(
		() => lstat(join(browsers, 'webkit-103/WebKit.framework/Versions/A/WebKit.tbd')),
		/ENOENT/u,
	);
	assert.equal(
		(await lstat(join(browsers, 'webkit-103/WebKit.framework/Versions/A/WebKit'))).isFile(),
		true,
		'the framework binary itself stays',
	);
	assert.equal(
		(await lstat(join(browsers, 'webkit-103/keep.tbd'))).isFile(),
		true,
		'a stub outside a framework bundle is never walked as a subcomponent',
	);
});

test('nightly test staging refuses destructive or self-referential paths', async (context) => {
	const fixture = await createFixture(context);
	for (const [outputRoot, browserSourceRoot] of [
		[parse(fixture.repositoryRoot).root, fixture.browserSourceRoot],
		[fixture.repositoryRoot, fixture.browserSourceRoot],
		[join(fixture.repositoryRoot, 'src'), fixture.browserSourceRoot],
		[join(fixture.repositoryRoot, '.desktop-build'), fixture.browserSourceRoot],
		[join(fixture.temporaryRoot, 'external-output'), fixture.browserSourceRoot],
		[fixture.browserSourceRoot, fixture.browserSourceRoot],
	]) {
		await assert.rejects(
			() => stageDesktopNightlyTests({
				repositoryRoot: fixture.repositoryRoot,
				outputRoot,
				browserSourceRoot,
			}),
			/output.*(?:repository|source|browser)/iu,
		);
	}
	const redirectedOutput = join(dirname(fixture.repositoryRoot), 'redirected-output');
	await mkdir(redirectedOutput);
	await symlink(redirectedOutput, join(fixture.repositoryRoot, '.desktop-build'));
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: join(fixture.repositoryRoot, '.desktop-build/nightly-tests'),
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/output.*symbolic link/iu,
	);
});
