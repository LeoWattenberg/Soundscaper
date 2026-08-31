/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';

export function nativeProcessInvoker({ executablePath, arguments: args }) {
	const child = spawn(executablePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
	const completion = new Promise((resolve, reject) => {
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.once('error', reject);
		child.once('exit', (code) => resolve({
			exitCode: code ?? 1, stdout, stderr, isolationChecksPassed: false,
		}));
	});
	return { completion, cancel: async () => { child.kill('SIGKILL'); } };
}
