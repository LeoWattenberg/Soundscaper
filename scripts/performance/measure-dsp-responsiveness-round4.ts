/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { FrequencyWaveformAnalysis, FrequencyWaveformCrossovers } from '../../src/common/editor/frequency-waveform-contract.ts';
import type { AudioEditorSignalRenderer } from '../../src/common/editor/signal-generator-renderer.ts';

type Channels = readonly Float32Array[];
interface Meter {
	push(channels: Channels): void;
	snapshot(): unknown;
}
interface Analyzer { push(channels: Channels): void; finish(): FrequencyWaveformAnalysis }
interface Kernels {
	initializePffft(): Promise<unknown>;
	preparePffftSpectrogram(size: number): Promise<unknown>;
	fft(real: Float32Array, imaginary: Float32Array): void;
	createEbuR128Meter(options: { sampleRate: number; channelCount: number; running: boolean }): Meter;
	FrequencyWaveformAnalyzer: new (options: { sampleRate: number; channelCount: number; frameCount: number; crossovers?: FrequencyWaveformCrossovers }, transform: Kernels['fft']) => Analyzer;
	pffftSpectrogramBandEnergies(channels: Float32Array, width: number, options: Readonly<Record<string, unknown>>): unknown;
	paintSpectrogram(context: { fillStyle: string; fillRect(): void }, columns: readonly (readonly number[])[], x: number, y: number, width: number, height: number, options: Readonly<Record<string, unknown>>): void;
	calculateAudioSpectrum(channels: Channels, rate: number, options: Readonly<Record<string, unknown>>): unknown;
	applyMultibandCompressor(channels: Channels, rate: number): Float32Array[];
	applyStandardEffect(type: 'lowpass-filter', channels: Channels, rate: number, params: Readonly<Record<string, unknown>>): Float32Array[];
	createAudioEditorSignalRenderer(type: string, options: Readonly<Record<string, unknown>>): AudioEditorSignalRenderer;
}

const EXPORTS = {
	'ebu-r128.js': ['createEbuR128Meter'],
	'frequency-waveform-analysis.ts': ['FrequencyWaveformAnalyzer'],
	'pffft.js': ['initializePffft', 'fft'],
	'pffft-spectrogram.js': ['preparePffftSpectrogram', 'pffftSpectrogramBandEnergies', 'paintSpectrogram'],
	'audio-spectrum.ts': ['calculateAudioSpectrum'],
	'first-party-effects/multiband-compressor/dsp.ts': ['applyMultibandCompressor'],
	'first-party-effects/standard/dsp.ts': ['applyStandardEffect'],
	'signal-generator-renderer.ts': ['createAudioEditorSignalRenderer'],
};

function sha256(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function digest(value: unknown): string {
	const hash = createHash('sha256');
	function visit(item: unknown): void {
		if (ArrayBuffer.isView(item)) {
			hash.update(item.constructor.name); hash.update(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
		} else if (Array.isArray(item)) {
			hash.update('['); for (const child of item) visit(child); hash.update(']');
		} else if (item !== null && typeof item === 'object') {
			for (const [key, child] of Object.entries(item)) { hash.update(key); visit(child); }
		} else hash.update(typeof item === 'number' && Object.is(item, -0) ? '-0' : String(item));
	}
	visit(value); return hash.digest('hex');
}

async function bundle(root: string, directory: string, label: string) {
	const contents = Object.entries(EXPORTS).map(([path, names]) =>
		`export { ${names.join(', ')} } from ${JSON.stringify(resolve(root, 'src/common/editor', path))};`).join('\n');
	const output = join(directory, `${label}.mjs`);
	const result = await build({ stdin: { contents, resolveDir: root, sourcefile: 'round4-dsp-kernels.ts', loader: 'ts' },
		absWorkingDir: root, outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', metafile: true });
	const sources = await Promise.all(Object.keys(result.metafile.inputs).filter(path => path !== 'round4-dsp-kernels.ts').map(async path => {
		const absolute = resolve(root, path);
		return { path: relative(root, absolute), sha256: sha256(await readFile(absolute)) };
	}));
	let revision: string | null = null;
	try { revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Exported source roots may have no Git metadata. */ }
	const kernels = await import(pathToFileURL(output).href) as Kernels;
	await kernels.initializePffft(); await kernels.preparePffftSpectrogram(256);
	return { kernels, evidence: { root, revision, bundleSha256: sha256(await readFile(output)), sources } };
}

interface Job { readonly name: string; readonly run: (kernels: Kernels, collect: boolean) => unknown }

function jobs(): readonly Job[] {
	const rate = 48_000; const frames = 240_000;
	const input = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) =>
		.7 * Math.sin(frame * .071 + channel) + .013 * Math.cos(frame * .17)));
	const silence = input.map(channel => new Float32Array(channel.length));
	const short = input.map(channel => channel.subarray(0, 211));
	function meter(kernels: Kernels, channels: Channels): unknown {
		const owner = kernels.createEbuR128Meter({ sampleRate: rate, channelCount: 2, running: true });
		for (let start = 0; start < frames; start += 4096) { owner.push(channels.map(channel => channel.subarray(start, start + 4096))); owner.snapshot(); }
		return owner.snapshot();
	}
	function generator(kernels: Kernels, type: string, options: Readonly<Record<string, unknown>>, block: number, collect: boolean): unknown {
		const owner = kernels.createAudioEditorSignalRenderer(type, { sampleRate: rate, ...options });
		const chunks: Channels[] = [];
		let next: Channels | null;
		while ((next = owner.next(block))) if (collect) chunks.push(next);
		return collect ? chunks : owner.frameCount;
	}
	let rowRevision = 0;
	return [
		{ name: 'ebu-active', run: kernels => meter(kernels, input) },
		{ name: 'ebu-quiet', run: kernels => meter(kernels, silence) },
		{ name: 'waveform', run(kernels) {
			const owner = new kernels.FrequencyWaveformAnalyzer({ sampleRate: rate, channelCount: 2, frameCount: frames }, kernels.fft);
			for (let start = 0; start < frames; start += 4096) owner.push(input.map(channel => channel.subarray(start, start + 4096)));
			return owner.finish();
		} },
		{ name: 'spectrogram-columns', run: kernels => kernels.pffftSpectrogramBandEnergies(input[0]!, 512, { fftWindowSize: 256, frequencyBands: 31, pixelSkip: 1 }) },
		{ name: 'spectrogram-rows', run(kernels, collect) {
			const rectangles: unknown[] = [];
			const context = { fillStyle: '', fillRect(...geometry: number[]) { if (collect) rectangles.push([geometry, this.fillStyle]); } };
			for (let plan = 0; plan < 10; plan++) kernels.paintSpectrogram(context, [[.1, .2, .7, .01]], 0, 0, 1, 181,
				{ scale: 'mel', sampleRate: rate, minFreq: collect ? 11.7 : 11.7 + rowRevision++ / 1000, maxFreq: 23_000 });
			return rectangles;
		} },
		{ name: 'spectrum-padding', run: kernels => kernels.calculateAudioSpectrum(short, rate, { size: 8192, average: false }) },
		{ name: 'spectrum-average', run: kernels => kernels.calculateAudioSpectrum(input, rate, { size: 2048, average: true }) },
		{ name: 'multiband-offline', run: kernels => kernels.applyMultibandCompressor(input, rate) },
		{ name: 'standard-filter', run: kernels => kernels.applyStandardEffect('lowpass-filter', input, rate, { rolloff: 48 }) },
		{ name: 'chirp-constant', run: (kernels, collect) => generator(kernels, 'chirp', { durationSeconds: 5, startFrequency: 211, endFrequency: 211, startAmplitude: .7, endAmplitude: .7 }, 4096, collect) },
		{ name: 'chirp-variable', run: (kernels, collect) => generator(kernels, 'chirp', { durationSeconds: 5 }, 4096, collect) },
		{ name: 'dtmf-uncached', run: (kernels, collect) => generator(kernels, 'dtmf', { sequence: '1A23', toneSeconds: 2.11 }, 127, collect) },
		{ name: 'morse', run: (kernels, collect) => generator(kernels, 'morse', { text: 'SOUND TEST SOS SOS SOS', wordsPerMinute: 30 }, 127, collect) },
	];
}

function median(values: readonly number[]): number { return [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)]!; }

async function main(): Promise<void> {
	const [baselineArgument, currentArgument, outputArgument, ...extra] = process.argv.slice(2);
	if (!baselineArgument || !currentArgument || !outputArgument || extra.length) throw new Error('Usage: node --import tsx scripts/performance/measure-dsp-responsiveness-round4.ts <baseline-root> <current-root> <output.json>');
	const baselineRoot = resolve(baselineArgument); const currentRoot = resolve(currentArgument); const output = resolve(outputArgument);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-round4-dsp-'));
	try {
		await symlink(join(currentRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
		const baseline = await bundle(baselineRoot, directory, 'baseline');
		const current = await bundle(currentRoot, directory, 'current');
		const results: unknown[] = [];
		for (const job of jobs()) {
			const expectedSha256 = digest(job.run(baseline.kernels, true));
			const actualSha256 = digest(job.run(current.kernels, true));
			assert.equal(actualSha256, expectedSha256, `${job.name} output parity failed before timing`);
			for (let warmup = 0; warmup < 8; warmup++) { job.run(baseline.kernels, false); job.run(current.kernels, false); }
			const baselineMs: number[] = []; const currentMs: number[] = []; const pairs: unknown[] = [];
			for (let pair = 0; pair < 12; pair++) {
				const order = pair % 2 ? ['current', 'baseline'] as const : ['baseline', 'current'] as const;
				const times: Record<string, number> = {};
				for (const label of order) {
					const start = performance.now(); job.run(label === 'baseline' ? baseline.kernels : current.kernels, false);
					times[label] = performance.now() - start;
					(label === 'baseline' ? baselineMs : currentMs).push(times[label]!);
				}
				pairs.push({ pair, order, ...times });
			}
			const result = { name: job.name, parity: { expectedSha256, actualSha256 }, baselineMedianMs: median(baselineMs), currentMedianMs: median(currentMs), pairs };
			results.push(result);
			console.log(JSON.stringify({ name: job.name, baselineMedianMs: result.baselineMedianMs, currentMedianMs: result.currentMedianMs }));
		}
		await mkdir(dirname(output), { recursive: true });
		await writeFile(output, `${JSON.stringify({ schemaVersion: 1, measuredAt: new Date().toISOString(),
			host: { node: process.version, platform: platform(), release: release(), cpus: cpus().map(cpu => cpu.model), totalMemoryBytes: totalmem(), loadAverageAtFinish: loadavg() },
			methodology: { frames: 240_000, sampleRate: 48_000, channels: 2, warmupsPerVersion: 8, alternatingPairs: 12,
				parityOutsideTimers: true, initializationOutsideTimers: true, generatorOutputRetentionOutsideTimers: true,
				limitations: 'Synchronous kernel measurements; not click-to-Apply, realtime deadlines, sustained FPS or startup. Pair order alternates AB/BA. Shared-host scheduling can affect short workloads. No per-item universal speedup follows from a grouped result.' },
			baseline: baseline.evidence, current: current.evidence, results }, null, 2)}\n`);
	} finally { await rm(directory, { recursive: true, force: true }); }
}

await main();
