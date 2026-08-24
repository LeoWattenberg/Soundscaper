/* SPDX-License-Identifier: AGPL-3.0-only */

/** Best-effort whole-tree termination for shell-free package-manager and codec children. */

import { spawn as nodeSpawn } from 'node:child_process';
import { win32 } from 'node:path';
import { kill as nodeKill } from 'node:process';

export interface ProcessTreeChild {
	readonly pid?: number;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ProcessTreeKillerChild {
	once(event: 'error', listener: (error: Error) => void): unknown;
	once(event: 'close', listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ProcessTreeKillerLaunchOptions {
	readonly env: Readonly<Record<string, string>>;
	readonly shell: false;
	readonly stdio: 'ignore';
	readonly windowsHide: true;
}

export type ProcessTreeKillerSpawn = (
	executable: string,
	argv: readonly string[],
	options: ProcessTreeKillerLaunchOptions,
) => ProcessTreeKillerChild;

export interface ProcessTreeTerminationOptions {
	readonly platform?: NodeJS.Platform;
	readonly environment?: Readonly<Record<string, string>>;
	readonly timeoutMs?: number;
	readonly killGroup?: (pid: number, signal: NodeJS.Signals) => void;
	readonly spawnTreeKiller?: ProcessTreeKillerSpawn;
}

const SIGNALS = new Set<NodeJS.Signals>(['SIGTERM', 'SIGKILL']);

export function shouldDetachProcessTree(platform: NodeJS.Platform = process.platform): boolean {
	return platform !== 'win32';
}

/** Returns false when only the immediate child could be signalled. */
export async function terminateProcessTree(
	child: ProcessTreeChild,
	signal: NodeJS.Signals,
	options: ProcessTreeTerminationOptions = {},
): Promise<boolean> {
	if (!child || typeof child.kill !== 'function' || !SIGNALS.has(signal)) {
		throw new TypeError('The process-tree termination request is invalid.');
	}
	const platform = options.platform ?? process.platform;
	if (platform !== 'win32') {
		if (Number.isSafeInteger(child.pid) && Number(child.pid) > 0) {
			try {
				(options.killGroup ?? nodeKill)(-Number(child.pid), signal);
				return true;
			} catch { return directKill(child, signal, false); }
		}
		return directKill(child, signal, false);
	}
	const root = windowsRoot(options.environment ?? process.env);
	if (root === null || !Number.isSafeInteger(child.pid) || Number(child.pid) < 1) {
		return directKill(child, signal, false);
	}
	const timeoutMs = boundedTimeout(options.timeoutMs ?? 1_000);
	const executable = win32.join(root, 'System32', 'taskkill.exe');
	const environment = Object.freeze(Object.fromEntries(
		['SystemRoot', 'WINDIR'].flatMap((key) => {
			const value = options.environment?.[key];
			return typeof value === 'string' ? [[key, value] as const] : [];
		}),
	));
	let killer: ProcessTreeKillerChild;
	try {
		killer = (options.spawnTreeKiller ?? defaultSpawnTreeKiller)(
			executable, ['/PID', String(child.pid), '/T', '/F'],
			Object.freeze({ env: environment, shell: false, stdio: 'ignore', windowsHide: true }),
		);
	} catch { return directKill(child, signal, false); }
	return await new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (contained: boolean): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (!contained) directKill(child, signal, false);
			resolve(contained);
		};
		const timer = setTimeout(() => {
			try { killer.kill('SIGKILL'); } catch { /* The direct fallback below still runs. */ }
			finish(false);
		}, timeoutMs);
		timer.unref?.();
		killer.once('error', () => { finish(false); });
		killer.once('close', (exitCode, processSignal) => {
			finish(exitCode === 0 && processSignal === null);
		});
	});
}

function defaultSpawnTreeKiller(
	executable: string,
	argv: readonly string[],
	options: ProcessTreeKillerLaunchOptions,
): ProcessTreeKillerChild {
	return nodeSpawn(executable, [...argv], {
		env: { ...options.env }, shell: false, stdio: 'ignore', windowsHide: true,
	}) as unknown as ProcessTreeKillerChild;
}

function windowsRoot(environment: Readonly<Record<string, string | undefined>>): string | null {
	for (const key of ['SystemRoot', 'WINDIR']) {
		const value = environment[key];
		if (typeof value === 'string' && value.length > 0 && value.length <= 4_096
			&& !value.includes('\0') && win32.isAbsolute(value)) return value;
	}
	return null;
}

function directKill(child: ProcessTreeChild, signal: NodeJS.Signals, result: boolean): boolean {
	try { child.kill(signal); } catch { /* The caller's bounded close wait still settles. */ }
	return result;
}

function boundedTimeout(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 5_000) {
		throw new RangeError('The process-tree termination timeout is invalid.');
	}
	return value;
}
