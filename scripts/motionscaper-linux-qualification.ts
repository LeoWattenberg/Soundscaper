#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { verifyMotionReferenceArtifact } from './lib/motionscaper-reference-artifact.ts';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';

export const MOTION_LINUX_QUALIFICATIONS = [
	{ id: 'launch', script: 'motionscaper-launch-native-smoke.mjs', markers: ['MOTIONSCAPER_NATIVE_LAUNCH_QUALIFIED'] },
	{ id: 'scene', script: 'motionscaper-scene-native-smoke.mjs', markers: ['MOTIONSCAPER_NATIVE_SCENE_QUALIFIED'] },
	{ id: 'successor', script: 'motionscaper-successor-native-smoke.mjs', markers: ['FRAMESCAPER_SUCCESSOR_NATIVE_DELIVERY_QUALIFIED', 'FRAMESCAPER_SUCCESSOR_NATIVE_LINK_QUALIFIED'] },
] as const;

export function motionQualificationReceipts(output: string, markers: readonly string[], revision: string): readonly Readonly<Record<string, unknown>>[] {
	return markers.map(marker => {
		const lines = output.split('\n').filter(line => line.startsWith(`${marker} `));
		if (lines.length !== 1) throw new Error(`Expected exactly one ${marker} receipt.`);
		const value: unknown = JSON.parse(lines[0]!.slice(marker.length + 1));
		if (!value || typeof value !== 'object' || Array.isArray(value) || !('sourceRevision' in value) || value.sourceRevision !== revision) throw new Error('Qualification receipt source revision differs.');
		return { marker, ...value };
	});
}

export async function main(args = process.argv.slice(2)): Promise<void> {
	const names = ['target', 'native-result', 'decoder-artifact', 'motion-stage', 'motion-package', 'successor-stage', 'successor-package', 'output'] as const;
	const { values } = parseArgs({ args, options: Object.fromEntries(names.map(name => [name, { type: 'string' as const }])) });
	for (const name of names) if (typeof values[name] !== 'string' || !values[name]) throw new Error(`Qualification requires --${name}.`);
	const string = (key: typeof names[number]): string => { const value = values[key]; if (typeof value !== 'string') throw new TypeError('Expected qualification argument.'); return value; };
	const target = MOTION_NATIVE_TARGETS.find(value => value === string('target'));
	if (process.platform !== 'linux' || target !== `linux-${process.arch}` || !process.env.DISPLAY) throw new Error('Qualification requires its native Linux target and X11.');
	const root = resolve(import.meta.dirname, '..'), nativeResult = resolve(string('native-result')), artifact = resolve(string('decoder-artifact')), output = resolve(string('output'));
	const execute = promisify(execFile);
	const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 10000 })).stdout.trim();
	if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error('Qualification source revision is invalid.');
	await verifyMotionReferenceArtifact({ repositoryRoot: root, nativeResult, artifact, target });
	await mkdir(output, { recursive: false });
	const env = { ...process.env, MOTIONSCAPER_REFERENCE_ARTIFACT: artifact, MOTIONSCAPER_REFERENCE_NATIVE_RESULT: nativeResult,
		MOTIONSCAPER_QUALIFICATION_STAGE: resolve(string('motion-stage')), MOTIONSCAPER_QUALIFICATION_PACKAGE: resolve(string('motion-package')),
		FRAMESCAPER_SUCCESSOR_QUALIFICATION_STAGE: resolve(string('successor-stage')), FRAMESCAPER_SUCCESSOR_QUALIFICATION_PACKAGE: resolve(string('successor-package')) };
	const receipts: Readonly<Record<string, unknown>>[] = [], logs = [];
	for (const phase of MOTION_LINUX_QUALIFICATIONS) {
		let stdout: string, stderr: string;
		try { ({ stdout, stderr } = await execute(process.execPath, [join(root, 'scripts', phase.script)], { cwd: root, env, timeout: 360000, maxBuffer: 2 * 1024 * 1024 })); }
		catch (error) {
			const diagnostics = [String(error), ...['stdout', 'stderr'].map(key => error && typeof error === 'object' && typeof Reflect.get(error, key) === 'string' ? String(Reflect.get(error, key)) : '')].join('\n').slice(0, 4 * 1024 * 1024);
			await writeFile(join(output, `${phase.id}-failed.txt`), diagnostics, { flag: 'wx' }); throw error;
		}
		const log = `${stdout}\n${stderr}`; await writeFile(join(output, `${phase.id}.txt`), log, { flag: 'wx' });
		receipts.push(...motionQualificationReceipts(stdout, phase.markers, revision)); logs.push({ path: `${phase.id}.txt`, sha256: sha(log) });
		process.stdout.write(stdout);
	}
	const pins = [];
	for (const [id, path] of [['motion-stage', join(env.MOTIONSCAPER_QUALIFICATION_STAGE, 'stage-manifest.json')], ['successor-stage', join(env.FRAMESCAPER_SUCCESSOR_QUALIFICATION_STAGE, 'stage-manifest.json')],
		['native-result', join(nativeResult, 'build-result.json')], ['reference-decoder', join(artifact, 'reference-receipt.json')]] as const) {
		const bytes = await readFile(path); await writeFile(join(output, `${id}.json`), bytes, { flag: 'wx' }); pins.push({ path: `${id}.json`, sha256: sha(bytes) });
	}
	await writeFile(join(output, 'qualification.json'), `${JSON.stringify({ schemaVersion: 1, productId: 'motionscaper', target, sourceRevision: revision, receipts, logs, pins }, null, '\t')}\n`, { flag: 'wx' });
}
function sha(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
