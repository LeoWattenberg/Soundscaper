/* SPDX-License-Identifier: AGPL-3.0-only */
import { extname, isAbsolute, normalize, resolve } from 'node:path';
import type { MotionDesktopLaunch } from '../src/motionscaper/desktop-launch-contract.ts';
import type { MotionOpenFileCapability } from '../src/motionscaper/desktop-file-contract.ts';

const MAXIMUM_PENDING = 16;
const EXTENSIONS = new Set(['.mscape', '.scape']);
interface Opening { readonly path: string; readonly generation: number; requeued: boolean }
export interface MotionLaunchAuthority extends Pick<MotionDesktopLaunch, 'take' | 'acknowledge'> {
	enqueue(paths: readonly string[]): void;
	reset(): Promise<void>;
	dispose(): Promise<void>;
}

/** Parse OS arguments only; switches and foreign extensions confer no authority. */
export function motionLaunchPaths(argv: readonly string[], workingDirectory: string): readonly string[] {
	if (argv.length > 512 || !isAbsolute(workingDirectory)) throw new RangeError('Invalid Motionscaper launch arguments.');
	return argv.filter(value => !value.startsWith('-') && EXTENSIONS.has(extname(value).toLowerCase()))
		.map(value => launchPath(resolve(workingDirectory, value)));
}

export function createMotionscaperLaunchAuthority(options: {
	open(path: string): Promise<MotionOpenFileCapability>; revoke(token: string): Promise<void>; notify(): void;
}): MotionLaunchAuthority {
	const pending: string[] = []; let generation = 0, disposed = false;
	let opening: Opening | null = null;
	let active: { readonly path: string; readonly capability: MotionOpenFileCapability } | null = null;
	let acknowledging = false;
	const available = () => { if (disposed) throw new Error('Motionscaper launch authority is closed.'); };
	const notify = () => { if (!disposed && pending.length && !active && !opening) options.notify(); };
	return Object.freeze<MotionLaunchAuthority>({
		enqueue(paths) {
			available(); if (paths.length > MAXIMUM_PENDING) throw new RangeError('Too many pending Motionscaper file launches.');
			const additions = [...new Set(paths.map(launchPath))].filter(path => !pending.includes(path) && path !== active?.path && path !== opening?.path);
			if (pending.length + additions.length + (active ? 1 : 0) + (opening && !opening.requeued ? 1 : 0) > MAXIMUM_PENDING) throw new RangeError('Too many pending Motionscaper file launches.');
			pending.push(...additions); notify();
		},
		async take() {
			available(); if (active || opening) return null;
			const path = pending.shift(); if (!path) return null;
			const claim = { path, generation, requeued: false }; opening = claim;
			try {
				const capability = await options.open(path);
				if (disposed || claim.generation !== generation) { await options.revoke(capability.token); return null; }
				active = { path, capability }; return capability;
			} finally { opening = null; notify(); }
		},
		async acknowledge({ token }) {
			available(); const current = active;
			if (!current || current.capability.token !== token || acknowledging) throw new Error('Unknown or busy Motionscaper active launch.');
			acknowledging = true;
			try { await options.revoke(token); if (active === current) active = null; }
			finally { acknowledging = false; notify(); }
		},
		async reset() {
			if (disposed) return; generation += 1;
			if (opening && !opening.requeued) { pending.unshift(opening.path); opening.requeued = true; }
			const current = active;
			if (current) { active = null; pending.unshift(current.path); await options.revoke(current.capability.token); }
			notify();
		},
		async dispose() {
			if (disposed) return; disposed = true; generation += 1; pending.length = 0;
			const current = active; active = null;
			if (current) await options.revoke(current.capability.token);
		},
	});
}
function launchPath(path: string): string {
	if (typeof path !== 'string' || path.length > 8192 || path.includes('\0') || !isAbsolute(path)) throw new TypeError('Motionscaper native launch requires a bounded absolute path.');
	if (!EXTENSIONS.has(extname(path).toLowerCase())) throw new TypeError('Motionscaper native launch requires an .mscape or .scape archive.');
	return normalize(path);
}
