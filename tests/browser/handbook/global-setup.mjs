import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

const HANDBOOK_ROOT = fileURLToPath(new URL('../../../handbook/', import.meta.url));
const READY_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 250;

const astro = (args) => spawnSync('npx', ['astro', ...args], {
	cwd: HANDBOOK_ROOT,
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'pipe'],
});

export function stopHandbookPreview() {
	astro(['preview', 'stop']);
}

async function waitForServer(baseURL) {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(baseURL, { redirect: 'manual' });
			if (response.ok) return;
		} catch {
			// The daemon is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
	throw new Error(`Handbook preview did not answer at ${baseURL} within ${READY_TIMEOUT_MS} ms.`);
}

export default async function globalSetup(config) {
	const { baseURL } = config.projects[0].use;
	const port = new URL(baseURL).port;
	stopHandbookPreview();
	const started = astro(['preview', '--background', '--host', '127.0.0.1', '--port', port]);
	if (started.status !== 0) {
		throw new Error(`Could not start the handbook preview: ${started.stderr || started.stdout}`);
	}
	// Readiness is checked at the base path the deployment serves, not at the
	// origin root: a preview built for the wrong base answers the root with the
	// same 404 it answers everything else with, and every test would then fail
	// on a missing heading instead of on the one thing that is actually wrong.
	await waitForServer(new URL(handbookPlan('soundscaper').scope, baseURL).href);
}
