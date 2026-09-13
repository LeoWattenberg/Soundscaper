/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('OpenFX target-native CI builds and staging-verifies all five package targets', () => {
	const workflow = readFileSync(resolve(repositoryRoot,
		'.github/workflows/framescaper-openfx-native-build.yml'), 'utf8');
	for (const [target, runner] of [
		['linux-x64', 'ubuntu-24.04'],
		['linux-arm64', 'ubuntu-24.04-arm'],
		['mac-arm64', 'macos-15'],
		['win-x64', 'windows-2025'],
		['win-arm64', 'windows-11-vs2026-arm'],
	]) {
		assert.match(workflow, new RegExp(`target: ${target}\\n\\s+runner: ${runner}`, 'u'));
	}
	assert.match(workflow, /ci-provision-framescaper-boost\.mjs/u);
	assert.match(workflow, /ci-provision-framescaper-openfx-source\.mjs/u);
	assert.match(workflow, /build-framescaper-openfx-host\.mjs/u);
	assert.match(workflow,
		/name: framescaper-openfx-native-build-result-\$\{\{ matrix\.target \}\}/u);
	assert.match(workflow, /stage-framescaper-openfx-host-build-result\.mjs/u);
	assert.match(workflow, /audit:framescaper-openfx-host/u);
	assert.match(workflow, /workflow_call:/u);
	assert.match(workflow, /workflow_dispatch:/u);
	assert.doesNotMatch(workflow, /sign|approval|reviewer|manual verification/iu);
});
