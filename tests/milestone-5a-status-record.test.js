/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const roadmapUrl = new URL('../roadmap.md', import.meta.url);
const planUrl = new URL('../docs/milestone-5a-soundscaper-native.md', import.meta.url);

async function flattened(url) {
	return (await readFile(url, 'utf8')).replace(/\s+/gu, ' ');
}

test('the roadmap records selected S30 over the exact S29 native-audio foundation', async () => {
	const roadmap = await flattened(roadmapUrl);
	assert.match(
		roadmap,
		/Soundscaper.*S30.*exact S29 native-audio implementation.*persistent helper.*MessagePort.*AudioWorklet/iu,
	);
	assert.match(
		roadmap,
		/input.*recording publication.*output.*monitoring.*Web Core fallback/iu,
	);
	assert.doesNotMatch(roadmap, /no helper job reaches the open path/iu);
});

test('the 5A plan distinguishes reached real-time routes from external qualification', async () => {
	const plan = await flattened(planUrl);
	assert.match(
		plan,
		/product route.*direct helper-to-worklet `MessagePort`.*bounded.*packet pool/iu,
	);
	assert.match(
		plan,
		/five-target.*packaged.*physical.*remain.*pending-external/iu,
	);
	assert.doesNotMatch(plan, /no product surface consumes the (?:real-time )?plane/iu);
});

test('the 5A plan records production plug-in insertion, vendor state and continuity', async () => {
	const plan = await flattened(planUrl);
	assert.match(
		plan,
		/instantiate.*project insertion.*native-plugin.*effect graph.*persistent.*MessagePort/iu,
	);
	assert.match(
		plan,
		/vendor.*save-state.*load-state.*16 MiB.*\.scape.*desktop.*AUP4/iu,
	);
	assert.match(
		plan,
		/V21.*PDC.*bypass.*frozen.*missing.*crashed.*quarantined/iu,
	);
});

test('the 5A-0 and 5A-1 gates keep physical evidence open', async () => {
	const plan = await flattened(planUrl);
	assert.match(plan, /packaged synthetic audio loop.*pending-external/iu);
	assert.match(
		plan,
		/never silently substituted.*`_near`.*PipeWire negotiates its quantum.*granted record must carry what the device actually gave.*refuse/iu,
	);
	assert.match(plan, /30-minute physical loopback.*pending-external/iu);
});

test('the 5A-2 gate records cross-platform scanning and unqualified packages', async () => {
	const plan = await flattened(planUrl);
	assert.match(
		plan,
		/`SoundscaperNativeServicesDialog`.*native menu.*format.*folder.*scan.*quarantined digest/iu,
	);
	assert.match(plan, /JUCE.*VST3.*Audio Units.*LV2.*direct CLAP/iu);
	assert.doesNotMatch(plan, /refusal on `win32`/iu);
	assert.match(plan, /packaged scan fixture.*pending-external/iu);
});
