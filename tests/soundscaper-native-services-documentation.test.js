/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const roadmapUrl = new URL('../roadmap.md', import.meta.url);
const architectureUrl = new URL('../docs/architecture/native-services.md', import.meta.url);

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

test('the native-services architecture records real-time routing and target builds', async () => {
	const architecture = await flattened(architectureUrl);
	assert.match(
		architecture,
		/Real-time audio uses a directly transferred `MessagePort`.*fixed pool.*Main participates in setup and revocation, not per-block relay/iu,
	);
	assert.match(
		architecture,
		/supported producer matrix.*Windows x64.*Windows ARM64.*macOS ARM64.*Linux x64.*Linux ARM64/iu,
	);
	assert.match(
		architecture,
		/Target workflows provision pinned sources.*build the payload.*run required self-tests.*record byte lengths and SHA-256 digests/iu,
	);
});

test('the native-services architecture records plug-in state and continuity', async () => {
	const architecture = await flattened(architectureUrl);
	assert.match(
		architecture,
		/Plug-in discovery and execution are separate helper kinds.*Scanning grants no project audio/iu,
	);
	assert.match(
		architecture,
		/Opaque state is retained exactly and capped at 16 MiB.*State and parameters survive missing, changed, crashed, revoked, or quarantined binaries.*truthful bypass.*verified freeze/iu,
	);
	assert.match(
		architecture,
		/Reported latency is generation-scoped.*canonical path-delay plan.*safe block boundary.*faults the instance/iu,
	);
	assert.match(architecture, /Vendor UI is a helper-owned top-level native window/iu);
});

test('the native-services architecture keeps backend fallback explicit and fail-safe', async () => {
	const architecture = await flattened(architectureUrl);
	assert.match(
		architecture,
		/device candidate belongs to the backend that enumerated it.*reports each refusal.*does not silently turn into a different request/iu,
	);
	assert.match(
		architecture,
		/Input loss during recording commits only the already captured prefix.*never invents recorded silence.*Output loss stops monitoring.*compatible Web fallback/iu,
	);
});

test('the native-services architecture keeps scanning explicit and format-aware', async () => {
	const architecture = await flattened(architectureUrl);
	assert.match(
		architecture,
		/Scanning grants no project audio.*never runs automatically at startup.*consent is per format/iu,
	);
	assert.match(architecture, /VST3 and CLAP.*Audio Units.*LADSPA and LV2.*Vamp/iu);
	assert.match(architecture, /new or changed digest requires an explicit allow decision/iu);
});
