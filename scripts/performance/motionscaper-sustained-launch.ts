/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { MotionSustainedCdp } from './motionscaper-sustained-cdp.ts';
import { readMotionProcessIdentity, sampleMotionOwnedProcesses } from './motionscaper-sustained-observation.ts';
import type { MotionProcessIdentity } from './motionscaper-sustained-process.ts';

export async function motionSustainedIdentityAlive(identity: MotionProcessIdentity): Promise<boolean> {
	try { return (await readMotionProcessIdentity(identity.pid)).startTicks === identity.startTicks; }
	catch (error) { if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return false; throw error; }
}
export async function waitMotionSustainedGone(identities: readonly MotionProcessIdentity[]): Promise<void> {
	const deadline = performance.now() + 10000;
	for (;;) {
		const alive = (await Promise.all(identities.map(async value => await motionSustainedIdentityAlive(value) ? value : null))).filter(value => value !== null);
		if (!alive.length) return;
		if (performance.now() >= deadline) throw new Error(`Owned sustained processes survived cleanup: ${JSON.stringify(alive)}`);
		await delay(100);
	}
}
/** Only the child created here and its PID/start-tick descendants can be signalled. */
export async function launchMotionSustainedApplication(options: Readonly<{
	executable: string; cwd: string; directory: string; native: boolean;
}>) {
	const args = [options.native ? '--disable-gpu' : '--headless', ...(options.native ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run']),
		'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(options.directory, 'profile')}`,
		...(options.native ? [] : ['about:blank'])];
	const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SCAPE_PRODUCT: 'motionscaper' };
	delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_V8_COVERAGE; delete env.SCAPE_BROWSER_COVERAGE;
	const log = await open(join(options.directory, 'application.log'), 'wx', 0o600), startedAt = new Date().toISOString();
	const child = spawn(options.executable, args, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
	let total = 0, text = '', failure: unknown, endpointSettled = false, write = Promise.resolve();
	let resolveEndpoint!: (value: string) => void, rejectEndpoint!: (error: unknown) => void;
	const endpoint = new Promise<string>((resolve, reject) => { resolveEndpoint = resolve; rejectEndpoint = reject; });
	const collect = (bytes: Buffer) => {
		total += bytes.length;
		if (total > 1024 * 1024) { failure = new Error('Application log exceeds bounded admission.'); rejectEndpoint(failure); child.kill('SIGKILL'); return; }
		write = write.then(async () => { await log.write(bytes); }).catch(error => { failure = error; child.kill('SIGKILL'); });
		if (!endpointSettled) {
			text += bytes.toString('utf8'); const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9-]+)/u.exec(text);
			if (match) { endpointSettled = true; resolveEndpoint(match[1]!); text = ''; }
		}
	};
	child.stdout.on('data', collect); child.stderr.on('data', collect); child.on('error', error => { failure = error; rejectEndpoint(error); });
	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('close', (code, signal) => {
		if (!endpointSettled) rejectEndpoint(new Error(`Application closed before CDP: ${text}`)); resolve({ code, signal });
	}));
	const timer = setTimeout(() => { rejectEndpoint(new Error('Application startup deadline exceeded.')); child.kill('SIGKILL'); }, 30000);
	let cdp: MotionSustainedCdp | undefined, browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
	let owner: MotionProcessIdentity | undefined;
	let previous: readonly MotionProcessIdentity[] = [];
	const retainProcessIdentities = (values: readonly MotionProcessIdentity[]) => {
		const all = new Map([...previous, ...values].map(value => [`${value.pid}:${value.startTicks}`, value])); previous = [...all.values()];
	};
	const cleanup = async () => {
		const errors: unknown[] = [];
		if (owner && !await motionSustainedIdentityAlive(owner)) errors.push(new Error('Application owner disappeared before requested cleanup.'));
		const signalOwned = async (signal: NodeJS.Signals) => {
			for (const identity of [...previous, ...(owner ? [owner] : [])]) {
				try { if (await motionSustainedIdentityAlive(identity)) process.kill(identity.pid, signal); } catch (error) { errors.push(error); }
			}
			if (!owner) child.kill(signal); // The actual ChildProcess still owns startup before /proc admission.
		};
		const kill = setTimeout(() => { void signalOwned('SIGKILL'); }, 10000);
		try { if (owner) retainProcessIdentities((await sampleMotionOwnedProcesses(owner, previous)).processes.map(value => value.identity)); } catch (error) { errors.push(error); }
		try { await cdp?.close(); } catch (error) { errors.push(error); }
		try { await browser?.close(); } catch (error) { errors.push(error); }
		await signalOwned('SIGTERM');
		const close = await closed; clearTimeout(timer);
		if (!(close.code === 0 && close.signal === null) && !(close.code === null && close.signal === 'SIGTERM')) errors.push(new Error('Application closed with an unqualified exit code or signal.'));
		await write; await log.close();
		try { await waitMotionSustainedGone(previous); } catch { await signalOwned('SIGKILL'); try { await waitMotionSustainedGone(previous); } catch (error) { errors.push(error); } }
		clearTimeout(kill);
		const receipt = { executable: options.executable, args, cwd: options.cwd, owner, startedAt, closedAt: new Date().toISOString(),
			...close, descendants: previous, failure: failure ? String(failure) : null, cleanupErrors: errors.map(String) };
		await writeFile(join(options.directory, 'application-closure.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
		if (errors.length || failure) throw new AggregateError([...(failure ? [failure] : []), ...errors], 'Application cleanup/observation failed.');
		return receipt;
	};
	try {
		if (!child.pid) throw new Error('Missing owned application PID.'); owner = await readMotionProcessIdentity(child.pid);
		const url = await endpoint; clearTimeout(timer);
		cdp = await MotionSustainedCdp.connect(url); browser = await chromium.connectOverCDP(url);
		const context = browser.contexts()[0]; if (!context) throw new Error('Owned application context unavailable.');
		const page = context.pages()[0] ?? await context.waitForEvent('page');
		return { owner, browser, page, context, cdp, endpoint: url, cleanup,
			retainProcessIdentities,
			async nativeHelpers() {
				const memory = await sampleMotionOwnedProcesses(owner!, previous); retainProcessIdentities(memory.processes.map(value => value.identity));
				const result = [];
				for (const value of memory.processes) {
					try { const command = await readFile(`/proc/${value.identity.pid}/cmdline`, 'utf8');
						if (command.split('\0')[0]?.endsWith('/motionscaper-media-host') && command.includes('--encode-prores-4444')) result.push({ ...value, command });
					} catch (error) { if (await motionSustainedIdentityAlive(value.identity)) throw error; }
				}
				return result;
			},
		};
	} catch (error) { try { await cleanup(); } catch (closeError) { throw new AggregateError([error, closeError], 'Application startup and cleanup failed.', { cause: closeError }); } throw error; }
}
