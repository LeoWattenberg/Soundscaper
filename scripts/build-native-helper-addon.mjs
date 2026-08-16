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

import { repinNativeAddonPayloadManifest } from './lib/native-addon-payload-manifest.mjs';
import { buildFixturePlugins, fixturePluginSourcePins } from './lib/native-fixture-plugins.mjs';
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
const fixtures = buildFixturePlugins({
	repositoryRoot: root,
	targetId: build.target.id,
	compiler: optionValue('compiler') ?? process.env.CC ?? 'cc',
});
repinNativeHelperAddonSources({
	repositoryRoot: root,
	build,
	fixtures: { ...fixtures, sourceFiles: fixturePluginSourcePins(root) },
});
await repinNativeAddonPayloadManifest({ repositoryRoot: root });

console.log(`Built ${build.target.id} native helper addon`);
console.log(`  payload    ${build.outputPath}`);
console.log(`  byteLength ${build.payload.byteLength}`);
console.log(`  sha256     ${build.payload.sha256}`);
console.log(`  toolchain  ${build.toolchainIdentity}`);
console.log(`  fixtures   ${String(fixtures.files.length)} benign format fixtures in ${fixtures.outputRoot}`);
