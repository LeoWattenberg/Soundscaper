#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Builds the native helper addon for the host target and repins the source
 * manifest. This needs a compiler and therefore never runs in the canonical
 * gate: `npm run audit:native-helper-addon` verifies the checked-in bytes
 * instead. Only the host's own target is produced — the other claimed targets
 * stay `pending-external` until a real build host exists for them.
 */

import { resolve } from 'node:path';

import {
	buildNativeHelperAddon,
	repinNativeHelperAddonSources,
} from './lib/native-helper-addon-build.mjs';

const root = resolve(import.meta.dirname, '..');

function optionValue(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const includeArgument = optionValue('include') ?? process.env.SOUNDSCAPER_NODE_API_INCLUDE;
const build = buildNativeHelperAddon({
	repositoryRoot: root,
	compiler: optionValue('compiler') ?? process.env.CC ?? 'cc',
	includeDirectories: includeArgument ? includeArgument.split(',').map((entry) => entry.trim()) : undefined,
});
repinNativeHelperAddonSources({ repositoryRoot: root, build });

console.log(`Built ${build.target.id} native helper addon`);
console.log(`  payload    ${build.outputPath}`);
console.log(`  byteLength ${build.payload.byteLength}`);
console.log(`  sha256     ${build.payload.sha256}`);
console.log(`  toolchain  ${build.toolchainIdentity}`);
