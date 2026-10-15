/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { audiocityValidationPort } from './lib/audiocity-validation-config.mjs';

const root = resolve(import.meta.dirname, '..');
const checkout = resolve(process.env.SCAPE_AUDIOCITY_CHECKOUT ?? resolve(root, '../audiocity'));
const editorPort = audiocityValidationPort(process.env.PLAYWRIGHT_PORT, 4325);
const providerPort = audiocityValidationPort(process.env.SCAPE_AUDIOCITY_PORT, 8091);
if (editorPort === providerPort) throw new Error('The editor and Audiocity need separate ports.');
const editorOrigin = `http://127.0.0.1:${editorPort}`;
const providerOrigin = `http://127.0.0.1:${providerPort}`;
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
await mkdir(resolve(root, '.wrangler'), { recursive: true });
const temporary = await mkdtemp(resolve(root, '.wrangler/audiocity-browser-'));
let provider;
let worker;
let closing = false;
let cleanup;
const children = new Set();
const stoppingChildren = new WeakMap();
const startupAbort = new AbortController();
let finishStartup;
const startupFinished = new Promise(done => { finishStartup = done; });

function close() {
	if (cleanup) return cleanup;
	closing = true;
	startupAbort.abort();
	cleanup = (async () => {
		const stopped = await Promise.allSettled([...children].map(stopChild));
		// A signal can arrive while createApp/listen is still initializing.
		await startupFinished;
		stopped.push(...await Promise.allSettled([...children].map(stopChild)));
		try { await provider?.app.close(); }
		finally { await rm(temporary, { recursive: true, force: true }); }
		const failures = stopped.filter(result => result.status === 'rejected');
		if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Validation child cleanup failed.');
	})();
	return cleanup;
}

function finish(code) {
	void close().then(() => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => finish(0));

let startupError;
try {
	const { createApp } = await import(pathToFileURL(resolve(checkout, 'src/app.ts')).href);
	startupAbort.signal.throwIfAborted();
	provider = await createApp({
		dataDir: resolve(temporary, 'provider-data'), publicUrl: providerOrigin,
		host: '127.0.0.1', port: providerPort, logger: false, registration: false,
		corsOrigins: [providerOrigin, editorOrigin],
		adminEmail: 'soundscaper-validation@example.test', adminPassword: 'soundscaper-audiocity-test-only-password',
	});
	startupAbort.signal.throwIfAborted();
	await provider.app.listen({ host: '127.0.0.1', port: providerPort });
	startupAbort.signal.throwIfAborted();
	const config = {
		name: 'soundscaper-audiocity-validation', pages_build_output_dir: resolve(root, 'dist'), compatibility_date: '2026-07-14',
		d1_databases: [{ binding: 'FREESOUND_OAUTH_DB', database_name: 'audiocity-validation', database_id: 'FREESOUND_OAUTH_DB',
			migrations_dir: resolve(root, 'migrations/freesound-oauth') }],
	};
	// Anchor Wrangler's package-root search so a checkout .dev.vars cannot override this disposable setup.
	await writeFile(resolve(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
	await writeFile(resolve(temporary, 'wrangler.json'), JSON.stringify(config));
	await symlink(resolve(root, 'functions'), resolve(temporary, 'functions'), 'dir');
	const vars = {
		AUDIOCOM_OAUTH_MASTER_KEY: `v1:${randomBytes(32).toString('base64url')}`,
		AUDIOCOM_LOCAL_DEVELOPMENT: '1', AUDIOCOM_OAUTH_REDIRECT_URI: `${editorOrigin}/api/audiocom/oauth/callback`,
	};
	await writeFile(resolve(temporary, '.dev.vars'), Object.entries(vars).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
	startupAbort.signal.throwIfAborted();
	await run(['d1', 'migrations', 'apply', 'FREESOUND_OAUTH_DB', '--local', '--persist-to', resolve(temporary, 'state')]);
	startupAbort.signal.throwIfAborted();
	worker = spawnChild([wrangler, '--cwd', temporary, 'pages', 'dev', '--ip', '127.0.0.1', '--port', String(editorPort),
		'--inspector-port', '0', '--persist-to', resolve(temporary, 'state'), '--log-level', 'warn'], {
		cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
	});
	worker.once('error', error => { console.error(error); finish(1); });
	worker.once('exit', code => {
		if (!closing) finish(code || 1);
	});
	console.log(`Disposable Audiocity: ${providerOrigin}; Soundscaper: ${editorOrigin}`);
} catch (error) {
	startupError = error;
} finally {
	finishStartup();
}
if (startupError) {
	const wasClosing = closing;
	await close();
	if (!wasClosing) throw startupError;
}

function run(args) {
	return new Promise((done, reject) => {
		startupAbort.signal.throwIfAborted();
		const child = spawnChild([wrangler, '--cwd', temporary, ...args], {
			cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
		});
		let output = '';
		child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-65536); });
		child.stderr.on('data', bytes => { output = (output + bytes.toString()).slice(-65536); });
		const aborted = () => { reject(startupAbort.signal.reason); };
		startupAbort.signal.addEventListener('abort', aborted, { once: true });
		child.once('error', reject);
		child.once('close', code => {
			startupAbort.signal.removeEventListener('abort', aborted);
			if (code === 0) done(); else reject(new Error(`Local D1 migrations failed:\n${output}`));
		});
	});
}

function spawnChild(args, options) {
	startupAbort.signal.throwIfAborted();
	const child = spawn(process.execPath, args, { ...options, detached: process.platform !== 'win32' });
	children.add(child);
	child.once('close', () => { children.delete(child); });
	return child;
}

function stopChild(child) {
	const existing = stoppingChildren.get(child);
	if (existing) return existing;
	const stopping = (async () => {
		if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
		const signal = value => {
			try {
				if (process.platform !== 'win32') process.kill(-child.pid, value);
				else child.kill(value);
			} catch (error) { if (error.code !== 'ESRCH') throw error; }
		};
		signal('SIGTERM');
		if (!await exitedWithin(child, 2000)) {
			signal('SIGKILL');
			if (!await exitedWithin(child, 2000)) throw new Error('A validation child process did not stop.');
		}
	})();
	stoppingChildren.set(child, stopping);
	return stopping;
}

function exitedWithin(child, milliseconds) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
	return new Promise(done => {
		const finish = exited => { clearTimeout(timer); child.removeListener('close', closed); done(exited); };
		const closed = () => finish(true);
		const timer = setTimeout(() => finish(false), milliseconds);
		child.once('close', closed);
	});
}
