// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */
// node scripts/performance/measure-responsiveness-round3.ts <baseline-root> <current-root> <output.json>
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
import {createAudioClip,createAudioSource,createAudioTrack} from './src/common/editor/project-media-factory.ts';
import {createCurrentAudioEditorProject} from './src/common/editor/project-current.ts';
import {projectForCommandConsumers} from './src/common/editor/project-current-runtime.ts';
import {brandRuntimeProjectProjection} from './src/common/editor/runtime-clip-projection.ts';
import {deleteRange,prepareRangeDeleteCommand} from './src/common/editor/commands/range-runtime.js';
import {createClipboardDescriptor,pasteClipboard,preparePasteCommand} from './src/common/editor/commands/clipboard-runtime.js';
import {joinClips} from './src/common/editor/commands/clip-link-runtime.js';
import {compileProjectPathPdcPlanV21} from './src/common/editor/engine/project-path-pdc-plan-v21.ts';
function fixture(count,trackCount=1,adjacent=false) {
 const clips=Array.from({length:count},(_,index)=>createAudioClip({id:'clip-'+index,sourceId:'source',
  timelineStartFrame:index*(adjacent?20:100),sourceStartFrame:index*20,sourceDurationFrames:20,durationFrames:20}));
 const tracks=Array.from({length:trackCount},(_,index)=>createAudioTrack({id:'track-'+index,
  clipIds:clips.filter((_,ordinal)=>ordinal%trackCount===index).map(clip=>clip.id)}));
 const document=createCurrentAudioEditorProject({id:'round3-kernel',now:'2026-10-07T00:00:00.000Z',
  sources:[createAudioSource({id:'source',storageKey:'source',frameCount:count*100+1000,channelCount:1,sampleRate:48000})],clips,tracks});
 return brandRuntimeProjectProjection(structuredClone(projectForCommandConsumers(document)));
}
function commandKernel(template,run) {
 return {prepare(){const draft=brandRuntimeProjectProjection(structuredClone(template));
  return {run(){run(draft);return draft;},capture(result){return result;}};}};
}
function pdcFixture() {
 const tracks=Array.from({length:300},(_,index)=>({id:'track-'+index,type:'audio',effectsActive:true,
  effects:[{id:'track-fx-'+index,type:'limiter',enabled:true,params:{lookahead:(index%5+1)/1000}}]}));
 const groups=tracks.map(track=>({id:'group-'+track.id,name:track.id,color:'',gain:1,pan:0,mute:false,solo:false,
  collapsed:false,effectsActive:false,effects:[],channelCount:2}));
 const edges=tracks.flatMap(track=>[
  {id:track.id+'-group',kind:'assignment',source:{kind:'track',id:track.id},destination:{kind:'mixer-node',id:'group-'+track.id},position:'post-fader',level:1,enabled:true,channelMap:[]},
  {id:track.id+'-master',kind:'assignment',source:{kind:'mixer-node',id:'group-'+track.id},destination:{kind:'master'},position:'post-fader',level:1,enabled:true,channelMap:[]}]);
 edges.push({id:'master-main',kind:'assignment',source:{kind:'master'},destination:{kind:'output',id:'main'},position:'post-fader',level:1,enabled:true,channelMap:[]});
 return {sampleRate:48000,masterChannels:2,tracks,mixer:{schemaVersion:1,groups,sends:[],cues:[],vcas:[],outputs:[{id:'main',name:'Main',role:'main',channelCount:2}],edges}};
}
function capturePdc(plan) {
 const values=Object.fromEntries(Object.entries(plan).filter(([,value])=>typeof value!=='function')
  .map(([key,value])=>[key,value instanceof Map?[...value]:value]));
 values.automationOffsets=Array.from({length:300},(_,index)=>plan.automationLatencyFrames({kind:'strip',strip:{kind:'track',id:'track-'+index},parameterId:'gain'}));
 return values;
}
export function createKernel(name) {
 if(name==='v21-pdc-wide'){const template=pdcFixture();return {prepare(){const draft=structuredClone(template);
  return {run:()=>compileProjectPathPdcPlanV21(draft,{sampleRate:48000}),capture:capturePdc};}};}
 if(name==='range-ripple-dense'){const template=fixture(1500);let id=0;
  const command=prepareRangeDeleteCommand(template,{startFrame:15005,endFrame:90010,rippleMode:'track'},()=> 'split-'+id++);
  return commandKernel(template,draft=>deleteRange(draft,command,'track'));}
 if(name==='clipboard-descriptor-many-tracks'){const template=fixture(600,600);
  return {prepare(){const draft=brandRuntimeProjectProjection(structuredClone(template));
   return {run:()=>createClipboardDescriptor(draft,{startFrame:0,endFrame:60000}),capture:result=>result};}};}
 if(name==='clipboard-reject-dense'){const template=fixture(1000);
  const clipboard=createClipboardDescriptor(template,{startFrame:0,endFrame:10000});let id=0;
  const command=preparePasteCommand(clipboard,{atFrame:100000,project:template},()=> 'paste-'+id++);
  return commandKernel(template,draft=>pasteClipboard(draft,command));}
 if(name==='join-dense'){const template=fixture(1200,1,true);const ids=template.clips.map(clip=>clip.id).reverse();
  return commandKernel(template,draft=>joinClips(draft,ids));}
 throw new Error('Unknown benchmark kernel: '+name);
}
`;

const workloads: readonly { name: string; dimensions: Record<string, number | string> }[] = [
	{ name: 'v21-pdc-wide', dimensions: { tracks: 300, groups: 300, vertices: 601, edges: 601, outputs: 1, sampleRate: 48_000, effect: 'limiter with 1–5 ms lookahead' } },
	{ name: 'range-ripple-dense', dimensions: { clips: 1500, tracks: 1, startFrame: 15_005, endFrame: 90_010, splitBoundaries: 2 } },
	{ name: 'clipboard-descriptor-many-tracks', dimensions: { clips: 600, tracks: 600, sourceRate: 48_000, startFrame: 0, endFrame: 60_000 } },
	{ name: 'clipboard-reject-dense', dimensions: { existingClips: 1000, additions: 100, tracks: 1, atFrame: 100_000, sourceRate: 48_000 } },
	{ name: 'join-dense', dimensions: { clips: 1200, tracks: 1, clipFrames: 20, joinedFrames: 24_000, selectedOrder: 'reverse timeline order' } },
];
const [beforeArgument, afterArgument, outputArgument] = process.argv.slice(2);
if (!beforeArgument || !afterArgument || !outputArgument) throw new Error('Supply baseline checkout, current checkout and output JSON path.');
const roots = [resolve(beforeArgument), resolve(afterArgument)];
const output = resolve(outputArgument);
const warmups = 32;
const trials = 9;
const startedAt = new Date().toISOString();
const temporary = await mkdtemp(resolve(tmpdir(), 'soundscaper-round3-kernels-'));
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
	const bundled = await build({ stdin: { contents: ENTRY, resolveDir: root, sourcefile: 'round3-kernel-entry.js', loader: 'js' },
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
		schemaVersion: 1, title: 'Round3 warmed V21 routing and editing command kernels', startedAt, completedAt: new Date().toISOString(),
		checkouts: checkouts.map((checkout, index) => ({ ...checkout, bundledCodeSha256: bundles[index]!.sha256 })), host,
		method: {
			warmupsPerRevision: warmups, measuredPairs: trials, order: 'Alternating before/after per warmup and trial',
			fixtures: 'Each tree independently bundles its own factories, normalizers, runtime brands and actual production handlers. Base fixture construction, command preparation and fresh draft cloning/branding occur outside each timed run.',
			timed: 'Only the actual kernel or command handler and its required normalization/publication. No input fixture setup or parity serialization is timed.',
			parity: 'Deep strict equality of complete output snapshots before timing and after every paired warmup/trial, outside timers. PDC capture preserves every data field/map plus 300 automation offset queries; function identities are excluded.',
		},
		independentPdcReview: {
			baselineRevision: '1e1aa842ee685ba03d536adec146139e85fe2ed5', comparisons: 432, successfulPlans: 390, exactRefusals: 42,
			method: 'Read-only independently imported frozen/current V21 compilers, each receiving a structured clone of 144 deterministic nested/group graph variants at 44100/48000/96000 Hz. Variants include limiter enable/bypass/rack combinations, parallel routes, sidechains, and disabled/enabled cycles. Compared every non-function plan field and map or exact error name/message.',
			limits: 'Separate review receipt, not timed by this script. Its temporary harness is not a permanent reproducibility dependency; committed independent PDC oracle and round3 index tests remain repeatable checks.',
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
