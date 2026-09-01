/* SPDX-License-Identifier: AGPL-3.0-only */

import { once } from 'node:events';

export async function terminatePackagedRuntime(child, graceMs = 5_000) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill();
	let timer;
	const graceful = await Promise.race([
		exited.then(() => true),
		new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), graceMs); }),
	]);
	clearTimeout(timer);
	if (graceful || child.exitCode !== null || child.signalCode !== null) return;
	child.kill('SIGKILL');
	await exited;
}
