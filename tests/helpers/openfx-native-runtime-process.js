/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

export function nativeExecutable(path) {
	const bytes = readFileSync(path);
	const identity = statSync(path);
	return { path, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: { dev: identity.dev, ino: identity.ino } };
}

export function nativeExecutableGrant(role, path) {
	const value = nativeExecutable(path);
	return { role, path, bytes: value.byteLength, sha256: value.sha256, identity: value.identity };
}

export function runNativeExecutable(executable, args) {
	return spawnSync(executable, args, { encoding: 'utf8' });
}

export function runNativeExecutableAsync(executable, args) {
	const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
	const completion = new Promise((resolveRun, rejectRun) => {
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => resolveRun({ status: code, signal, stdout, stderr }));
	});
	return { completion, stdin: child.stdin };
}
