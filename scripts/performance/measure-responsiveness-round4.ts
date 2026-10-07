// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */
// node scripts/performance/measure-responsiveness-round4.ts <baseline-root> <current-root> <output.json>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, freemem, hostname, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

interface Operation { run(): unknown; capture(result: unknown): unknown }
interface Kernel { prepare(): Operation }
interface KernelRuntime { createKernel(name: string): Kernel }
interface HostSnapshot { sampledAt: string; freeMemoryBytes: number; loadAverage: readonly number[] }
interface TimedPair { order: readonly string[]; beforeMs: number; afterMs: number; hostBefore: HostSnapshot; hostAfter: HostSnapshot }
interface KernelResult {
	name: string; dimensions: Record<string, number | string>; paritySha256: string;
	beforeMedianMs: number; afterMedianMs: number; rawAlternatingPairs: TimedPair[];
}

// Each bundle resolves factories, authority/projection brands and command imports
// exclusively from its own checkout, including the frozen baseline.
const ENTRY = `
import {compileParallelStackPlan} from './src/common/editor/engine/parallel-stack-plan.ts';
import {stripParameterDescriptor} from './src/common/editor/effect-parameter-descriptors.ts';
import {ScheduledParameterRegistry} from './src/common/editor/engine/scheduled-parameter-registry.ts';
function strip(id,effects=[]) { return {id,name:id,color:'',collapsed:false,gain:.75,pan:0,mute:false,solo:false,effectsActive:true,effects,channelCount:2}; }
function parallelFixture() {
 const tracks=Array.from({length:80},(_,i)=>({...strip('track-'+i,[{id:'limiter-'+i,type:'limiter',params:{lookahead:.001}},{id:'crush-'+i,type:'bitcrusher',params:{bitDepth:8}}]),type:'audio'}));
 const groups=Array.from({length:120},(_,i)=>strip('group-'+i));
 const edge=(id,source,destination)=>({id,kind:'assignment',source,destination,position:'post-fader',level:1,enabled:true,channelMap:[0,1]});
 const edges=tracks.map(track=>edge('edge-'+track.id,{kind:'track',id:track.id},{kind:'mixer-node',id:'group-119'}));
 for(let i=119;i>=0;i--)edges.push(edge('edge-group-'+i,{kind:'mixer-node',id:'group-'+i},i?{kind:'mixer-node',id:'group-'+(i-1)}:{kind:'master'}));
 edges.push(edge('main',{kind:'master'},{kind:'output',id:'main'}));
 const vcas=Array.from({length:24},(_,i)=>({id:'vca-'+i,name:'VCA',gain:.99,mute:false,members:[...tracks.map(track=>({kind:'track',id:track.id})),...groups.map(group=>({kind:'mixer-node',id:group.id}))]}));
 return {schemaFamily:'soundscaper',schemaVersion:1,sampleRate:48000,masterChannels:2,tracks,master:strip('master'),mixer:{schemaVersion:1,groups,sends:[],cues:[],vcas,outputs:[{id:'main',name:'Main',role:'main',channelCount:2}],edges}};
}
export function createKernel(name) {
 if(name==='parallel-compile-reverse-groups'){const template=parallelFixture();return {prepare(){const draft=structuredClone(template);return {run:()=>compileParallelStackPlan(draft,{sampleRate:48000,workerCount:4}),capture:result=>result};}};}
 if(name==='message-parameter-window'){const descriptor=stripParameterDescriptor({kind:'strip',strip:{kind:'track',id:'track'},parameterId:'pan'},32);
  const events=Array.from({length:4096},(_,frame)=>({kind:'set',frame,value:0}));
  const options={fromFrame:0,contextStartTime:0,sampleRate:44100,contextSampleRate:48000,transportRate:1.2};
  return {prepare(){let packet;const target=new ScheduledParameterRegistry().registerMessageTarget(descriptor,value=>{packet=value;});
   return {run(){target.schedule(events,options);return packet;},capture:result=>result};}};}
 throw new Error('Unknown round4 kernel: '+name);
}
`;

const workloads: readonly { name: string; dimensions: Record<string, number | string> }[] = [
	{ name: 'parallel-compile-reverse-groups', dimensions: { tracks: 80, groups: 120, effects: 160, vcas: 24, vcaMembers: 200, tasks: 202, workerCount: 4, sampleRate: 48_000, groupOrder: 'reverse dependency order' } },
	{ name: 'message-parameter-window', dimensions: { events: 4096, sampleRate: 44_100, contextSampleRate: 48_000, transportRate: '1.2', latencyFrames: 32 } },
];
const [beforeArgument, afterArgument, outputArgument] = process.argv.slice(2);
if (!beforeArgument || !afterArgument || !outputArgument) throw new Error('Supply baseline checkout, current checkout and output JSON path.');
const roots = [resolve(beforeArgument), resolve(afterArgument)];
const output = resolve(outputArgument);
const warmups = 32;
const trials = 9;
const startedAt = new Date().toISOString();
const temporary = await mkdtemp(resolve(tmpdir(), 'soundscaper-round4-kernels-'));
const git = (root: string, args: readonly string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const checkouts = roots.map(root => ({
	root, revision: git(root, ['rev-parse', 'HEAD']),
	trackedSourceChanges: git(root, ['status', '--porcelain', '--untracked-files=no', '--', 'src/common/editor']),
}));
const host = {
	node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
	hostname: hostname(), platform: platform(), release: release(), architecture: process.arch,
	cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(),
	freeMemoryBytesAtStart: freemem(), loadAverageAtStart: loadavg(),
};

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)]!;
}
function timed(operation: Operation): { ms: number; result: unknown } {
	const began = performance.now();
	const result = operation.run();
	return { ms: performance.now() - began, result };
}
function hostSnapshot(): HostSnapshot {
	return { sampledAt: new Date().toISOString(), freeMemoryBytes: freemem(), loadAverage: loadavg() };
}
async function load(root: string, label: string): Promise<{ runtime: KernelRuntime; sha256: string }> {
	const bundled = await build({ stdin: { contents: ENTRY, resolveDir: root, sourcefile: 'round4-kernel-entry.js', loader: 'js' },
		bundle: true, platform: 'node', format: 'esm', target: 'node26.5', write: false, logLevel: 'warning' });
	const source = bundled.outputFiles[0]!.text;
	const file = resolve(temporary, `${label}.mjs`);
	await writeFile(file, source);
	const runtime = await import(pathToFileURL(file).href) as KernelRuntime;
	return { runtime, sha256: createHash('sha256').update(source).digest('hex') };
}

try {
	const bundles = await Promise.all(roots.map((root, index) => load(root, index ? 'after' : 'before')));
	const results: KernelResult[] = [];
	for (const workload of workloads) {
		const kernels = bundles.map(bundle => bundle.runtime.createKernel(workload.name));
		const parity = kernels.map(kernel => {
			const operation = kernel.prepare();
			return operation.capture(operation.run());
		});
		assert.deepEqual(parity[1], parity[0], `${workload.name}: exact output parity before timing`);
		const paritySha256 = createHash('sha256').update(JSON.stringify(parity[0])).digest('hex');
		const rawAlternatingPairs: TimedPair[] = [];
		for (let iteration = 0; iteration < warmups + trials; iteration += 1) {
			const hostBefore = hostSnapshot();
			const order = iteration % 2 ? [1, 0] : [0, 1];
			const operations = kernels.map(kernel => kernel.prepare());
			const times = [0, 0];
			const captures: unknown[] = [];
			for (const index of order) {
				const operation = operations[index]!;
				const measured = timed(operation);
				times[index] = measured.ms;
				captures[index] = operation.capture(measured.result);
			}
			assert.deepEqual(captures[1], captures[0], `${workload.name}: exact pair ${String(iteration)}`);
			if (iteration >= warmups) rawAlternatingPairs.push({
				order: order.map(index => index ? 'after' : 'before'), beforeMs: times[0]!, afterMs: times[1]!,
				hostBefore, hostAfter: hostSnapshot(),
			});
		}
		results.push({ ...workload, paritySha256, rawAlternatingPairs,
			beforeMedianMs: median(rawAlternatingPairs.map(pair => pair.beforeMs)),
			afterMedianMs: median(rawAlternatingPairs.map(pair => pair.afterMs)),
		});
		process.stdout.write(`${workload.name}: ${String(results.at(-1)!.beforeMedianMs)} → ${String(results.at(-1)!.afterMedianMs)} ms median\n`);
	}
	const report = {
		schemaVersion: 1, title: 'Round4 warmed parallel compilation and message scheduling kernels', startedAt, completedAt: new Date().toISOString(),
		checkouts: checkouts.map((checkout, index) => ({ ...checkout, bundledCodeSha256: bundles[index]!.sha256 })), host,
		method: {
			warmupsPerRevision: warmups, measuredPairs: trials, order: 'Alternating before/after per warmup and trial',
			fixtures: 'Each tree independently bundles its own factories, normalizers, runtime brands and actual production handlers. Base fixture construction, registry registration and fresh draft cloning occur outside each timed run.',
			timed: 'Only the actual kernel or command handler and its required normalization/publication. No input fixture setup or parity serialization is timed.',
			parity: 'Deep strict equality of complete output snapshots before timing and after every paired warmup/trial, outside timers. Capture preserves the complete compiled worker-plane plan or complete immutable parameter packet.',
		},
		limitations: 'Warmed synchronous Node kernels on a shared host, with uncontrolled JIT, GC, CPU frequency and concurrent processes. These pairs do not measure Electron click-to-result latency, worker/I/O cost, audio render duration, timeline FPS or load time, and do not attribute causal time savings to individual ledger entries. Bundled snapshots record the source revision and any tracked source changes; temporary bundle directories are deleted.',
		results, priorRuns: [] as unknown[],
	};
	try {
		const previous = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;
		const prior = Array.isArray(previous.priorRuns) ? previous.priorRuns as unknown[] : [];
		const { priorRuns: _priorRuns, ...snapshot } = previous;
		report.priorRuns = [...prior, snapshot];
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
	}
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, '\t')}\n`);
	process.stdout.write(`Saved ${String(results.length)} exact-parity kernel pairs to ${output}\n`);
} finally { await rm(temporary, { recursive: true, force: true }); }
