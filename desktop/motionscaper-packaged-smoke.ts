/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_PRORES_DELIVERY_PROFILE } from '../src/motionscaper/desktop-delivery-contract.ts';
import { spawn } from 'node:child_process';

interface SmokeIdentity { readonly platform: string; readonly arch: string; readonly version: string; readonly nativeProres?: boolean }
interface SmokeProcess {
	readonly command: string; readonly args: readonly string[]; readonly cwd: string;
	readonly environment?: NodeJS.ProcessEnv; readonly timeoutMs?: number;
}

export function assertMotionscaperPackagedSmoke(output: string, expected: SmokeIdentity): unknown {
	const marker = 'MOTIONSCAPER_SHELL_SMOKE ';
	const lines = output.split(/\r?\n/u).filter((line) => line.startsWith(marker));
	if (lines.length !== 1) throw new Error('Motionscaper smoke must emit exactly one result.');
	const value: unknown = JSON.parse(lines[0]!.slice(marker.length));
	const evidence = record(value);
	const environment = record(evidence.environment);
	const capabilities = ['project-files-v1', ...(expected.nativeProres ? ['prores-4444-v1'] : [])];
	const nativeProfile = expected.nativeProres ? MOTION_PRORES_DELIVERY_PROFILE : null;
	if (expected.nativeProres) {
		const native = record(evidence.nativeSmoke);
		if (native.status !== 'passed' || native.frameCount !== 2 || typeof native.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(native.sha256)
			|| JSON.stringify(native.audio) !== JSON.stringify({ sampleRate: 48000, channels: 2, sampleCount: 3204 })
			|| JSON.stringify(native.profile) !== JSON.stringify(nativeProfile)) throw new Error('Motionscaper native smoke evidence is invalid.');
	} else if (evidence.nativeSmoke !== null) throw new Error('Motionscaper native smoke evidence exceeded its admitted capability.');
	if (evidence.arch !== expected.arch || evidence.origin !== 'motionscaper-app://bundle'
		|| evidence.foreignBridge !== false || evidence.fileBridge !== true
		|| JSON.stringify(evidence.deliveryProfile) !== JSON.stringify(nativeProfile)
		|| typeof evidence.deliveryRejection !== 'string' || !evidence.deliveryRejection.includes('Unknown Motionscaper delivery capability.')
		|| typeof evidence.fileRejection !== 'string' || !evidence.fileRejection.includes('Unknown Motionscaper read capability.')
		|| environment.productId !== 'motionscaper' || environment.appName !== 'Motionscaper'
		|| environment.version !== expected.version || environment.platform !== expected.platform
		|| JSON.stringify(environment.nativeCapabilities) !== JSON.stringify(capabilities)) {
		throw new Error('Motionscaper packaged smoke evidence does not match the declared product authority.');
	}
	return value;
}

export async function runMotionscaperSmokeProcess(options: SmokeProcess): Promise<string> {
	const environment: NodeJS.ProcessEnv = { ...options.environment, SCAPE_PRODUCT: 'motionscaper' };
	delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS;
	return new Promise((resolve, reject) => {
		const child = spawn(options.command, options.args, { cwd: options.cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = ''; let bytes = 0; let failure: Error | null = null;
		const stop = (error: Error) => { failure ??= error; child.kill('SIGKILL'); };
		const timeout = setTimeout(() => { stop(new Error(`Motionscaper smoke timed out.\n${output}`)); }, options.timeoutMs ?? 120_000);
		const append = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 1024 * 1024) stop(new Error('Motionscaper smoke exceeded its output bound.'));
			else output += chunk.toString('utf8');
		};
		child.stdout.on('data', append); child.stderr.on('data', append);
		child.once('error', (error) => { failure ??= error; });
		child.once('close', (code) => {
			clearTimeout(timeout);
			if (failure) reject(failure);
			else if (code !== 0) reject(new Error(`Motionscaper smoke exited with code ${String(code)}.\n${output}`));
			else resolve(output);
		});
	});
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Motionscaper smoke evidence.');
	return value as Record<string, unknown>;
}
