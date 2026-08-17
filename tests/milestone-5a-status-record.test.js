/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const roadmapUrl = new URL('../roadmap.md', import.meta.url);
const planUrl = new URL('../docs/milestone-5a-soundscaper-native.md', import.meta.url);

async function flattened(url) {
	return (await readFile(url, 'utf8')).replace(/\s+/gu, ' ');
}

test('the roadmap states the native audio open path that exists at HEAD', async () => {
	const roadmap = await flattened(roadmapUrl);
	assert.doesNotMatch(roadmap, /Only dlopen ALSA\/JACK discovery exists; no device opens/iu);
	assert.match(
		roadmap,
		/opens PipeWire and ALSA streams through an ordered candidate chain.*JACK.*discovery-only.*no helper job reaches the open path yet/iu,
	);
});

test('the 5A plan records the real-time plane as implemented but unproven', async () => {
	const plan = await flattened(planUrl);
	assert.doesNotMatch(plan, /No helper -> AudioWorklet path exists/iu);
	assert.match(
		plan,
		/direct helper-to-worklet `MessagePort` transport exists.*closed protocol validator.*reusable packet pool/iu,
	);
	assert.match(
		plan,
		/no product surface consumes the plane.*packaged synthetic loopback.*has never been run.*unmet rather than met/iu,
	);
});

test('the 5A plan stops claiming the product implementations are all absent', async () => {
	const plan = await flattened(planUrl);
	assert.doesNotMatch(plan, /There is no OS audio backend, scanner, plug-in host/iu);
	assert.match(
		plan,
		/OS audio backend, scanner, registry, plug-in host and M5 collector now exist.*vendor UI host.*provisioned native lab do not/iu,
	);
});

test('the 5A-0 and 5A-1 gates name what is unmet rather than softening it', async () => {
	const plan = await flattened(planUrl);
	assert.match(
		plan,
		/packaged synthetic audio loop has never been run against the M5 limits/iu,
	);
	assert.match(
		plan,
		/never silently substituted.*`_near`.*PipeWire negotiates its quantum.*granted record must carry what the device actually gave.*refuse/iu,
	);
	assert.match(plan, /30-minute physical loopback.*has not been run/iu);
});

test('the 5A-2 gate records its results surface, packaged fixture, and Windows scan path', async () => {
	const plan = await flattened(planUrl);
	assert.match(
		plan,
		/acceptance clause was written when the tier had no dialog at all.*`SoundscaperNativeServicesDialog` is now that surface.*opened from the native menu family and nowhere else/iu,
	);
	assert.match(plan, /No packaged scan fixture has been run on any target/iu);
	assert.match(
		plan,
		/soundscaper_plugin_list_candidates.*soundscaper_plugin_inspect.*refusal on `win32`.*VST3, CLAP and the fixture format.*can never be scanned/iu,
	);
});
