/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { auditFramescaperMediaHost } from '../scripts/lib/framescaper-media-host-build.mjs';
import { auditFramescaperOpenFxHost } from '../scripts/lib/framescaper-openfx-host-build.mjs';
import { auditNativeHelperAddon } from '../scripts/lib/native-helper-addon-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

/**
 * Copies the repository inputs an audit reads into a scratch root, so a tampered
 * source tree can be audited without mutating the shared working tree.
 */
function stageRoot(paths, mutate) {
	const root = mkdtempSync(join(tmpdir(), 'native-source-closure-'));
	try {
		for (const path of paths) {
			cpSync(join(repositoryRoot, path), join(root, path), { recursive: true });
		}
		writeFileSync(join(root, 'outside-the-closure.h'), '#pragma once\n');
		return mutate(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const AUDITS = [
	{
		name: 'media host',
		inputs: ['.gitattributes', 'config', 'native/framescaper-media-host'],
		sourceDirectory: 'native/framescaper-media-host/src',
		audit: auditFramescaperMediaHost,
	},
	{
		name: 'OpenFX host',
		inputs: ['.gitattributes', 'config', 'native/framescaper-openfx-host'],
		sourceDirectory: 'native/framescaper-openfx-host/src',
		audit: auditFramescaperOpenFxHost,
	},
	{
		name: 'native helper addon',
		inputs: ['.gitattributes', 'config', 'native/soundscaper-helper-addon'],
		sourceDirectory: 'native/soundscaper-helper-addon/src',
		audit: auditNativeHelperAddon,
	},
];

for (const { name, inputs, sourceDirectory, audit } of AUDITS) {
	test(`the ${name} source audit accepts its own pinned closure`, () => {
		const findings = stageRoot(inputs, (root) => audit({ repositoryRoot: root }).findings);
		assert.deepEqual(findings, []);
	});

	test(`the ${name} source audit refuses a symlink smuggled into the pinned closure`, () => {
		const findings = stageRoot(inputs, (root) => {
			symlinkSync(
				join(root, 'outside-the-closure.h'),
				join(root, sourceDirectory, 'smuggled_source.h'),
			);
			return audit({ repositoryRoot: root }).findings;
		});
		assert.notDeepEqual(findings, [], 'a symlinked source must not pass the closure gate');
		assert.ok(
			findings.some((finding) => finding.includes('smuggled_source.h')),
			`the finding must name the offending entry, got ${JSON.stringify(findings)}`,
		);
	});
}
