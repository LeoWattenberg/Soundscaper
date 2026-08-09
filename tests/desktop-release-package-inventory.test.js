/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	desktopTranslationSourceName,
	regularDesktopReleaseFileNames,
	validateDesktopReleasePackageInventory,
} from '../scripts/desktop-release-assets.mjs';

const VERSION = '0.2.0-beta.1';
const PACKAGES = [
	'ffmpeg-corresponding-source.json',
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
