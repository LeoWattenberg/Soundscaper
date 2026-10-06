/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const authorityPath = 'src/soundscaper/editor-project-command-foundation.ts';
const baselineRevision = process.argv[2] ?? '25d7cbdb4';
const baselineSource = execFileSync('git', ['show', `${baselineRevision}:${authorityPath}`], { cwd: root, encoding: 'utf8' });
const temporary = await mkdtemp(resolve(tmpdir(), 'soundscaper-command-drafts-'));
try {
	const versions = [];
	for (const name of ['baseline', 'candidate']) {
		const output = resolve(temporary, `${name}.mjs`);
		await build({ stdin: { contents: `export { createSoundscaperProject } from './src/soundscaper/editor-project.ts';
export { createAudioClip, createAudioSource, createAudioTrack } from './src/common/editor/project-media-factory.ts';
export { applySoundscaperProjectFoundationCommand } from './${authorityPath}';`, resolveDir: root },
			bundle: true, platform: 'node', format: 'esm', outfile: output,
			plugins: [{ name: 'original-command-authority', setup(builder) {
				// esbuild's Go regexp parser does not accept the JavaScript Unicode flag.
				builder.onLoad({ filter: /editor-project-command-foundation\.ts$/ }, async args => ({
					contents: name === 'baseline' ? baselineSource : await readFile(args.path, 'utf8'), loader: 'ts',
				}));
			} }],
		});
		versions.push({ name, runtime: await import(pathToFileURL(output).href) });
	}
	const observations = [];
	for (const clipCount of [1_000, 2_000]) {
		const { createAudioSource, createAudioTrack, createAudioClip, createSoundscaperProject } = versions[1].runtime;
		const project = createSoundscaperProject({ sampleRate: 48_000,
			sources: [createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 2, frameCount: clipCount * 100 })],
			tracks: [createAudioTrack({ id: 'track', clipIds: Array.from({ length: clipCount }, (_, index) => `clip-${index}`) }, 48_000)],
			clips: Array.from({ length: clipCount }, (_, index) => createAudioClip({ id: `clip-${index}`, sourceId: 'source',
				timelineStartFrame: index * 100, sourceStartFrame: index * 100, durationFrames: 100 })),
		});
		const command = { type: 'selection/set', startFrame: 0, endFrame: 10, trackIds: ['track'] };
		const options = { now: '2026-10-06T00:00:00Z' };
		const expected = versions[0].runtime.applySoundscaperProjectFoundationCommand(project, command, options);
		assert.deepEqual(versions[1].runtime.applySoundscaperProjectFoundationCommand(project, command, options), expected);
		for (let warmup = 0; warmup < 3; warmup++) {
			for (const { runtime } of versions) runtime.applySoundscaperProjectFoundationCommand(project, command, options);
		}
		const trials = new Map(versions.map(({ name }) => [name, []]));
		for (let repeat = 0; repeat < 8; repeat++) {
			for (const { name, runtime } of repeat % 2 === 0 ? versions : versions.toReversed()) {
				const started = performance.now();
				runtime.applySoundscaperProjectFoundationCommand(project, command, options);
				trials.get(name).push(performance.now() - started);
			}
		}
		for (const [name, milliseconds] of trials) {
			const sorted = milliseconds.toSorted((a, b) => a - b);
			observations.push({ name, clipCount, milliseconds, medianMilliseconds: (sorted[3] + sorted[4]) / 2 });
		}
	}
	const report = { node: process.version, baselineRevision, date: new Date().toISOString(),
		semanticParity: 'deepEqual including metadata, mixer, automation, revision and timestamps',
		method: 'three warmups per version, eight trials each in alternating order on the same project', observations };
	if (process.argv[3]) await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, '\t')}\n`);
	process.stdout.write(`${JSON.stringify(report, null, '\t')}\n`);
} finally { await rm(temporary, { recursive: true, force: true }); }
