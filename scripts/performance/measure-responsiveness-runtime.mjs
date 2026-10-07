/* SPDX-License-Identifier: AGPL-3.0-only */
// node --import tsx scripts/performance/measure-responsiveness-runtime.mjs <baseline-root> <current-root> <output.json>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [baselineRoot, currentRoot, requestedOutput] = process.argv.slice(2);
if (!baselineRoot || !currentRoot || !requestedOutput) {
	throw new Error('Supply baseline checkout, current checkout and output JSON path.');
}
const output = resolve(requestedOutput);
const roots = [resolve(baselineRoot), resolve(currentRoot)];
const modules = await Promise.all(roots.map(async root => ({
	meter: await import(pathToFileURL(resolve(root, 'src/common/editor/production-audio/strip-meter-session.ts')).href),
	automation: await import(pathToFileURL(resolve(root, 'src/common/editor/engine/automation-lane-scheduler-v21.ts')).href),
	pdc: await import(pathToFileURL(resolve(root, 'src/common/editor/engine/project-pdc-plan.ts')).href),
})));
const pcm = Array.from({ length: 8 }, (_, channel) => Float32Array.from({ length: 65_536 }, (_, frame) => (
	Math.sin(frame * (channel + 1) * 0.0047)
)));
const meterInput = { channels: pcm, channelLabels: pcm.map((_, index) => String(index)) };
const tempoMap = { mode: 'musical', events: Array.from({ length: 200 }, (_, index) => ({
	beat: { num: index, den: 1 }, bpm: { num: 120, den: 1 },
})) };
const lane = {
	id: 'curve', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
	timebase: 'musical-beats', points: [
		{ id: 'start', position: { num: 0, den: 1 }, value: 0 },
		{ id: 'end', position: { num: 10, den: 1 }, value: 1 },
	], segments: [{ kind: 'eased' }],
};
const options = { fromFrame: 0, toFrame: 240_000, sampleRate: 48_000, tempoMap };
const project = {
	sampleRate: 48_000, tracks: Array.from({ length: 20_000 }, (_, index) => ({
		type: 'audio', id: String(index), effects: [],
	})), mixer: { groups: [], sends: [] },
};
const cases = [
	['Unchanged 128-strip snapshot / 10000 queries', module => {
		const store = module.meter.createSessionStripMeterStore();
		for (let index = 0; index < 128; index += 1) store.update({ kind: 'track', id: String(index) }, meterInput);
		return () => {
			let snapshot;
			for (let query = 0; query < 10_000; query += 1) snapshot = store.snapshot();
			return snapshot;
		};
	}],
	['Curved musical automation / 200 tempos', module => () => module.automation.compileAutomationLaneEventsV21(lane, options)],
	['PDC plan / 20000 tracks', module => () => module.pdc.compileProjectPdcPlan(project)],
];
const results = [];
for (const [name, prepare] of cases) {
	const operations = modules.map(prepare);
	assert.deepEqual(operations[1](), operations[0]());
	const samples = [[], []];
	for (let trial = 0; trial < 39; trial += 1) {
		for (const index of trial % 2 ? [1, 0] : [0, 1]) {
			const begin = performance.now();
			operations[index]();
			const duration = performance.now() - begin;
			if (trial >= 32) samples[index].push(duration);
		}
	}
	results.push({ name, baselineMs: samples[0], currentMs: samples[1] });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
	node: process.version, cpu: cpus()[0]?.model,
	checkouts: roots.map(root => ({ root,
		revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
	})),
	method: 'Exact result parity outside timing; 32 alternating warmups and seven alternating measured trials per revision; fixture construction excluded. Shared-host local timings, not end-to-end latency.',
	results,
}, null, '\t') + '\n');
process.stdout.write(`Saved ${String(results.length)} runtime kernel pairs to ${output}\n`);
