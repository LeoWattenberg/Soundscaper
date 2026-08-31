/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The package audit reads its inputs out of immutable Git blobs, while the
 * auditors it binds back to them read the same files from the working tree. On
 * Windows those two byte streams are only identical when the file is pinned to
 * LF: Git's default there rewrites line endings on checkout, so an unpinned
 * input digests differently on each side and the audit refuses its own
 * inputs as drifted — which is what took every
 * packaged Windows job down after the earlier failures were cleared.
 *
 * Four of these were pinned already, evidently for this reason. This binds the
 * pairing so the next authority cannot be added without its attribute.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS } from '../scripts/lib/milestone-5-package-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACQUISITIONS = 'config/milestone-5-native-source-acquisitions.json';

test('every Milestone 5 package-audit input is pinned to LF in the working tree', () => {
	// The acquisitions register delegates to further source manifests, and those
	// are digested the same way, so the set to pin is the transitive one: a
	// delegated manifest left unpinned refuses the audit exactly as a
	// top-level authority does.
	const register = JSON.parse(readFileSync(resolve(ROOT, ACQUISITIONS), 'utf8'));
	const delegated = (register.delegatedSources ?? [])
		.map(({ manifestPath }) => manifestPath).filter(Boolean);
	const unpinned = [...Object.values(MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS), ...delegated].filter((path) => {
		const attribute = execFileSync('git', ['check-attr', 'eol', '--', path], {
			cwd: ROOT, encoding: 'utf8',
		}).trim();
		return !attribute.endsWith(': lf');
	});
	assert.deepEqual(unpinned, [],
		'each package-audit input needs a `text eol=lf` entry in .gitattributes');
});
