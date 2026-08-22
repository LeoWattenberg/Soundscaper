/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runs the pinned host attestation inside the isolated media utility process. */

import { spawn } from 'node:child_process';

import type { FramescaperMediaHostDescriptor } from './framescaper-media-host-payload.ts';
import { authenticateNativeMediaFile } from './native-media-file-auth.ts';

export interface FramescaperMediaHostSelfTestResult {
	readonly contractVersion: 1;
	readonly ffmpeg: '9.0.1';
	readonly networkInitialized: false;
	readonly versionsMatch: true;
	readonly exactRetimeMatches: true;
	readonly proresProxyEncoderPresent: true;
	readonly professionalCharacteristicsMatches: true;
}

export function assertFramescaperMediaHostSelfTest(
	value: unknown,
): asserts value is FramescaperMediaHostSelfTestResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('The Framescaper media-host self-test must return one plain record.');
	}
	const record = value as Record<string, unknown>;
	const expected = [
		'contractVersion', 'ffmpeg', 'networkInitialized', 'versionsMatch', 'exactRetimeMatches',
		'proresProxyEncoderPresent', 'professionalCharacteristicsMatches',
	].sort();
	const actual = Object.keys(record).sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
		|| record.contractVersion !== 1 || record.ffmpeg !== '9.0.1'
		|| record.networkInitialized !== false || record.versionsMatch !== true
		|| record.exactRetimeMatches !== true || record.proresProxyEncoderPresent !== true
		|| record.professionalCharacteristicsMatches !== true) {
		throw new TypeError(
			'The Framescaper media-host FFmpeg, retime, proxy, and professional-probe self-test did not pass.',
		);
	}
}

export function runFramescaperMediaHostSelfTest(
	descriptor: FramescaperMediaHostDescriptor,
): Promise<FramescaperMediaHostSelfTestResult> {
	return verifyDescriptor(descriptor).then(() => runSelfTestProcess(descriptor));
}

function runSelfTestProcess(
	descriptor: FramescaperMediaHostDescriptor,
): Promise<FramescaperMediaHostSelfTestResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(descriptor.path, ['--self-test'], {
			stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true,
		});
		let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let oversized = false;
		const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer): Buffer<ArrayBufferLike> => {
			const result = Buffer.concat([current, chunk]);
			if (result.byteLength > 64 * 1024) { oversized = true; child.kill(); }
			return result;
		};
		child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
		child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (oversized) return reject(new Error('The media-host self-test exceeded 64 KiB.'));
			if (signal !== null || code !== 0) {
				return reject(new Error(
					`The media-host self-test failed (${signal ?? String(code)}): ${String(stderr)}`,
				));
			}
			let result: unknown;
			try { result = JSON.parse(String(stdout)) as unknown; }
			catch { return reject(new Error('The media-host self-test returned malformed JSON.')); }
			try { assertFramescaperMediaHostSelfTest(result); }
			catch (error) { return reject(error); }
			resolvePromise(result);
		});
	});
}

async function verifyDescriptor(descriptor: FramescaperMediaHostDescriptor): Promise<void> {
	await authenticateNativeMediaFile({
		path: descriptor.path, byteLength: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	});
}
