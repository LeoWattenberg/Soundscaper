/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { PagesDeploymentCommand } from './pages-deployment-plan.ts';

/** npm run supplies npm_execpath; direct Node invocations use the installed Node prefix. */
async function npmEntry(environment: NodeJS.ProcessEnv): Promise<string> {
	const candidates = environment.npm_execpath ? [environment.npm_execpath] : [
		join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
		resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
	];
	for (const candidate of candidates) {
		try {
			const entry = await realpath(candidate); const root = resolve(dirname(entry), '..');
			if (entry !== join(root, 'bin/npm-cli.js') || !(await lstat(entry)).isFile()) continue;
			const metadata: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
			if (metadata && typeof metadata === 'object' && 'name' in metadata && metadata.name === 'npm'
				&& 'version' in metadata && metadata.version === '12.0.1') return entry;
		} catch { /* Try only the other known installed prefix; never PATH or a shell. */ }
	}
	throw new Error('Pages commands require the installed npm 12.0.1 JavaScript entry.');
}
export async function runPagesCommand({ root, environment, args }: PagesDeploymentCommand): Promise<void> {
	const entry = await npmEntry(environment);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, [entry, ...args], { cwd: root, env: environment, stdio: 'inherit', shell: false });
		child.once('error', reject);
		child.once('close', (code, signal) => {
			if (code === 0 && signal === null) resolve();
			else reject(new Error(`Pages command failed: ${signal ?? String(code)}.`));
		});
	});
}
