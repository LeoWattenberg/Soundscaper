#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Verifies that the checked-in native helper addon sources and per-target
 * payloads are exactly the pinned bytes. This runs in ordinary CI on every
 * machine and needs no compiler: a tampered source, a swapped binary, or a
 * target claiming to be built without its payload fails the canonical gate.
 */

import { resolve } from 'node:path';

import { auditNativeHelperAddon } from './lib/native-helper-addon-build.mjs';

const root = resolve(import.meta.dirname, '..');
const { manifest, findings } = auditNativeHelperAddon({ repositoryRoot: root });

if (findings.length > 0) {
	throw new Error(`Native helper addon audit failed:\n${findings.join('\n')}`);
}

const built = Object.entries(manifest.targets).filter(([, record]) => record.status === 'built');
const pending = Object.entries(manifest.targets).filter(([, record]) => record.status === 'pending-external');
console.log(`Native helper addon ${manifest.addonVersion} (Node-API ${manifest.napiVersion}): `
	+ `${manifest.sourceFiles.length} pinned sources, ${built.length} built target(s), ${pending.length} pending-external.`);
for (const [id, record] of built) {
	console.log(`  built  ${id}  ${record.payload.sha256}`);
}
for (const [id, record] of pending) {
	console.log(`  pending ${id}  ${record.blockedBy}`);
}
