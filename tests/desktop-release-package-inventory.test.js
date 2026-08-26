/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { extractJob, npmScriptsRunBy } from './helpers/workflow-jobs.js';
import {
	desktopReleaseTargetPackageInventory,
	desktopTranslationSourceName,
	regularDesktopReleaseFileNames,
	validateDesktopReleasePackageInventory,
} from '../scripts/desktop-release-assets.mjs';

const VERSION = '0.2.0-beta.1';
const PACKAGES = [
	`Soundscaper-${VERSION}-linux-x64.AppImage`,
	`Soundscaper-${VERSION}-linux-amd64.deb`,
	`Soundscaper-${VERSION}-linux-arm64.AppImage`,
	`Soundscaper-${VERSION}-linux-arm64.deb`,
	`Soundscaper-${VERSION}-mac-arm64.dmg`,
	`Soundscaper-${VERSION}-win-x64.exe`,
	`Soundscaper-${VERSION}-win-x64.zip`,
	`Soundscaper-${VERSION}-win-arm64.exe`,
	`Soundscaper-${VERSION}-win-arm64.zip`,
];
const FRAMESCAPER_PACKAGES = PACKAGES
	.map((name) => name.replace('Soundscaper-', 'Framescaper-'));

test('target package inventory is the exact shared naming authority', () => {
	const linux = desktopReleaseTargetPackageInventory('framescaper', 'linux-x64', VERSION);
	assert.deepEqual(linux.map(({ label }) => label), [
		'Linux x64 AppImage',
		'Linux x64 Debian package',
	]);
	assert.equal(linux[0].pattern.test(`Framescaper-${VERSION}-linux-x64.AppImage`), true);
	assert.equal(linux[1].pattern.test(`Framescaper-${VERSION}-linux-amd64.deb`), true);
	assert.equal(linux[0].pattern.test(`Soundscaper-${VERSION}-linux-x64.AppImage`), false);
	const windows = desktopReleaseTargetPackageInventory('soundscaper', 'win-arm64', VERSION);
	assert.deepEqual(windows.map(({ label }) => label), [
		'Windows ARM64 installer',
		'Windows ARM64 ZIP',
	]);
	assert.throws(
		() => desktopReleaseTargetPackageInventory('soundscaper', 'mac-x64', VERSION),
		/target/iu,
	);
});

test('Soundscaper release inventory is exact and version-bound', () => {
	assert.doesNotThrow(() => validateDesktopReleasePackageInventory(PACKAGES, VERSION));
	assert.throws(
		() => validateDesktopReleasePackageInventory([...PACKAGES, `Framescaper-${VERSION}-linux-x64.AppImage`], VERSION),
		/Unexpected or duplicate desktop package/iu,
	);
	assert.throws(
		() => validateDesktopReleasePackageInventory(PACKAGES.map((name) => name.replace(VERSION, '0.1.0')), VERSION),
		/Expected exactly one Linux x64 AppImage/iu,
	);
	assert.throws(
		() => validateDesktopReleasePackageInventory([...PACKAGES, `Soundscaper-${VERSION}-linux-x86_64.AppImage`], VERSION),
		/Expected exactly one Linux x64 AppImage/iu,
	);
	for (const name of [`Soundscaper-${VERSION}-win-x64.EXE`, `Soundscaper-${VERSION}-win-x64.msi`]) {
		assert.throws(() => validateDesktopReleasePackageInventory([...PACKAGES, name], VERSION),
			/Unexpected desktop release input/iu);
	}
	for (const name of [
		'ffmpeg-corresponding-source.json',
		'ffmpeg-runtime-manifest.json',
		'ffmpeg-9.0.1.tar.xz',
	]) {
		assert.throws(
			() => validateDesktopReleasePackageInventory([...PACKAGES, name], VERSION),
			/forbidden bundled FFmpeg|Unexpected desktop release input/iu,
		);
	}
});

test('suite release inventory requires exact packages for both desktop products', () => {
	const suite = [...PACKAGES, ...FRAMESCAPER_PACKAGES];
	assert.doesNotThrow(() => validateDesktopReleasePackageInventory(
		suite,
		VERSION,
		['soundscaper', 'framescaper'],
	));
	assert.throws(
		() => validateDesktopReleasePackageInventory(
			suite.filter((name) => name !== `Framescaper-${VERSION}-mac-arm64.dmg`),
			VERSION,
			['soundscaper', 'framescaper'],
		),
		/Framescaper macOS Apple silicon DMG/iu,
	);
});

test('release roots reject symbolic or non-regular entries', () => {
	assert.throws(() => regularDesktopReleaseFileNames([{
		name: 'THIRD_PARTY_LICENSES.md', isFile: () => false, isSymbolicLink: () => true,
	}]), /not a regular file.*THIRD_PARTY_LICENSES/iu);
});

test('translation source output is bound to a positive release ID and release path', () => {
	const descriptor = {
		path: 'releases/123/source/audacity-translations.zip',
		byteLength: 1,
		sha256: '0'.repeat(64),
	};
	assert.equal(desktopTranslationSourceName('123', descriptor), 'Audacity-translations-123-source.zip');
	assert.throws(() => desktopTranslationSourceName('../../../escape', descriptor), /release ID is invalid/iu);
	assert.throws(
		() => desktopTranslationSourceName('124', descriptor),
		/path does not match its release/iu,
	);
	assert.throws(() => desktopTranslationSourceName('123', {
		...descriptor,
		path: 'releases/123/source/%2e%2e/%2e%2e/999/source/evil.zip',
	}), /path does not match its release/iu);
});

test('desktop preview workflow retains only the no-FFmpeg stage manifest', async () => {
	const workflow = await readFile(resolve(import.meta.dirname, '../.github/workflows/desktop-preview.yml'), 'utf8');
	assert.match(workflow, /cp \.desktop-build\/stage-manifest\.json/u);
	assert.doesNotMatch(workflow, /cp desktop\/ffmpeg-corresponding-source\.json/u);
	const targetRows = [...workflow.matchAll(/platform:\s*(linux|mac|win)\s+arch:\s*(x64|arm64)/gu)]
		.map((match) => `${match[1]}-${match[2]}`);
	assert.deepEqual([...new Set(targetRows)].sort(), [
		'linux-arm64', 'linux-x64', 'mac-arm64', 'win-arm64', 'win-x64',
	]);
	assert.doesNotMatch(workflow, /platform:\s*mac,\s*arch:\s*x64/u);
});

// The assembler validates the whole five-target, two-product release matrix and
// fetches the corresponding sources the AGPL obligation depends on. No workflow
// invoked it, so the first run would have been a release.
test('the desktop nightly assembles the release inventory rather than leaving it to a tag', async () => {
	const workflow = await readFile(resolve(import.meta.dirname, '../.github/workflows/desktop-preview.yml'), 'utf8');
	const job = extractJob(workflow, 'release-inventory');
	assert.ok(npmScriptsRunBy(job).has('desktop:release-assets'));
	assert.match(job, /pattern: nightly-\*/u, 'the job must collect every packaged target');
	assert.match(job, /merge-multiple: true/u, 'the targets must land in one release directory');
	assert.match(job, /needs: package/u, 'the assembler needs the packages');
});
