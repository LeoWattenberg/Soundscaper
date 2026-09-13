/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('the media-host producer builds, uploads, downloads, and stages all five native targets', async () => {
	const workflow = await readFile(new URL(
		'.github/workflows/framescaper-media-host-native-build.yml', ROOT,
	), 'utf8');
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		assert.match(workflow, new RegExp(`target: ${target}\\b`, 'u'));
	}
	for (const command of [
		'scripts/ci-provision-framescaper-ffmpeg.mjs',
		'scripts/ci-provision-framescaper-boost.mjs',
		'scripts/ci-provision-framescaper-media-host-sources.mjs',
		'scripts/build-framescaper-media-host.mjs',
		'scripts/stage-framescaper-media-host-build-result.mjs',
	]) assert.match(workflow, new RegExp(command.replaceAll('.', '\\.'), 'u'));
	assert.match(workflow, /--external-source-root="\$FRAMESCAPER_MEDIA_EXTERNAL_SOURCE_ROOT"/u);
	assert.match(workflow, /runner: windows-11-vs2026-arm/u);
	assert.match(workflow, /framescaper-media-host-build-result-\$\{\{ matrix\.target \}\}/u);
	assert.match(workflow, /needs: build[\s\S]*actions\/download-artifact/u);
	assert.match(workflow, /workflow_call:[\s\S]*workflow_dispatch:/u);
	assert.doesNotMatch(workflow, /approval|reviewer|manual verification|policy sign/iu);
});
