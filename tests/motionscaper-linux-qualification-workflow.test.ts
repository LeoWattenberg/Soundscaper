/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJob } from './helpers/workflow-jobs.js';

test('Motion Linux candidate and nightly packages require real launch, scene and successor qualification', async () => {
	for (const [file, job] of [['motionscaper-desktop-preview.yml', 'package'], ['desktop-nightly-tests.yml', 'package-with-tests']]) {
		const source = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
		const selected = extractJob(source, job!);
		assert.match(selected, /uses: \.\/\.github\/actions\/motionscaper-linux-qualification/u);
		assert.match(selected, /name: Qualify complete Linux Motion workflows\n\s+if: runner.os == 'Linux'/u);
		assert.ok(selected.indexOf('uses: ./.github/actions/motionscaper-linux-qualification') < selected.indexOf('uses: actions/upload-artifact@'));
	}
	const action = await readFile(new URL('../.github/actions/motionscaper-linux-qualification/action.yml', import.meta.url), 'utf8');
	assert.match(action, /SCAPE_FRAMESCAPER_DESKTOP_PROFILE: framescaper-successor-v2/u);
	assert.match(action, /SCAPE_FRAMESCAPER_LINE: successor/u);
	assert.match(action, /node scripts\/motionscaper-linux-qualification.ts/u);
	assert.match(action, /name: motionscaper-linux-qualification-/u);
	assert.doesNotMatch(action, /continue-on-error|--no-sandbox|--publish always/u);
});

test('Motion reference decoder is a separate Linux-only test artifact after verified native build', async () => {
	const workflow = await readFile(new URL('../.github/workflows/motionscaper-media-host-native-build.yml', import.meta.url), 'utf8');
	assert.ok(workflow.indexOf('scripts/motionscaper-reference-artifact-build.ts') > workflow.indexOf('Reverify committed source and exact artifact closure'));
	assert.match(workflow, /name: Build separate Linux reference decoder\n\s+if: runner.os == 'Linux'/u);
	assert.match(workflow, /name: motionscaper-reference-decoder-\$\{\{ matrix.target \}\}/u);
	assert.match(workflow, /motionscaper-media-work\/media-build\/ffmpeg-install/u);
});
