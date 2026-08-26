/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Technical_README's desktop-preview table is the platform claim a reader sees
// first, and nothing used to compare it against the inventory the packaging
// matrix and the release assembler actually build. It advertised a macOS Intel
// DMG for a macOS-arm64-only matrix until this check existed.
const ROOT = new URL('../', import.meta.url);
const ROW = /^\| (?<platform>[A-Za-z ]+?) \| (?<architectures>[^|]+?) \| [^|]+ \|$/gmu;
const OS_BY_PLATFORM = Object.freeze({ Windows: 'windows', macOS: 'macos', Linux: 'linux' });
const ARCHITECTURE_NAMES = Object.freeze({ x64: ['x64', 'Intel'], arm64: ['ARM64', 'Apple silicon'] });

const readme = await readFile(new URL('Technical_README.md', ROOT), 'utf8');
const capabilities = JSON.parse(await readFile(new URL('config/production-capabilities.json', ROOT), 'utf8'));

function advertisedTargets() {
	const targets = [];
	for (const match of readme.matchAll(ROW)) {
		const { platform, architectures } = match.groups;
		const os = OS_BY_PLATFORM[platform];
		if (os === undefined) continue;
		for (const name of architectures.split(',').map((value) => value.trim())) {
			const architecture = Object.entries(ARCHITECTURE_NAMES)
				.find(([, names]) => names.includes(name))?.[0];
			assert.ok(architecture, `Technical_README names an unknown architecture "${name}" for ${platform}.`);
			targets.push(`${os}-${architecture}`);
		}
	}
	return targets.sort();
}

test('the desktop-preview table advertises exactly the inventory desktop targets', () => {
	const declared = capabilities.desktopTargets
		.map(({ os, architecture }) => `${os}-${architecture}`)
		.sort();
	const advertised = advertisedTargets();
	assert.ok(advertised.length > 0, 'the desktop-preview table must list at least one platform row');
	assert.deepEqual(advertised, declared);
});
