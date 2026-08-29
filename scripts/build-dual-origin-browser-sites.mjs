#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const outputRoot = resolve(repositoryRoot, '.wrangler/dual-origin-browser');
const vite = resolve(repositoryRoot, 'node_modules/vite/bin/vite.js');
const routeGenerator = resolve(repositoryRoot, 'scripts/generate-static-routes.mjs');

const sites = Object.freeze([
	Object.freeze({
		productId: 'soundscaper',
		outputDirectory: resolve(outputRoot, 'soundscaper'),
		environment: Object.freeze({
			SCAPE_PRODUCT: 'soundscaper',
			SOUNDSCAPER_SITE: 'http://127.0.0.1:4332',
			PUBLIC_TRANSFER_PEER_ORIGIN: 'http://127.0.0.1:4333',
		}),
	}),
	Object.freeze({
		productId: 'framescaper',
		outputDirectory: resolve(outputRoot, 'framescaper'),
		environment: Object.freeze({
			SCAPE_PRODUCT: 'framescaper',
			FRAMESCAPER_SITE: 'http://127.0.0.1:4333',
			PUBLIC_TRANSFER_PEER_ORIGIN: 'http://127.0.0.1:4332',
		}),
	}),
]);

for (const site of sites) {
	const environment = cleanBuildEnvironment(site.environment);
	await run(process.execPath, [
		vite,
		'build',
		'--outDir', site.outputDirectory,
		'--emptyOutDir',
	], environment, `build the ${site.productId} dual-origin site`);
	await run(process.execPath, [
		routeGenerator,
		site.outputDirectory,
	], environment, `generate the ${site.productId} Pages routes`);
}

/**
 * A developer shell may carry production-preview inputs. Clear every routing
 * input first so the two fixtures are determined only by the table above.
 *
 * @param {Readonly<Record<string, string>>} siteEnvironment
 * @returns {NodeJS.ProcessEnv}
 */
function cleanBuildEnvironment(siteEnvironment) {
	const environment = { ...process.env };
	for (const key of [
		'SCAPE_PRODUCT',
		'SOUNDSCAPER_SITE',
		'FRAMESCAPER_SITE',
		'PUBLIC_TRANSFER_PEER_ORIGIN',
	]) delete environment[key];
	return { ...environment, ...siteEnvironment };
}

/**
 * @param {string} command
 * @param {readonly string[]} arguments_
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} description
 * @returns {Promise<void>}
 */
function run(command, arguments_, environment, description) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, arguments_, {
			cwd: repositoryRoot,
			env: environment,
			stdio: 'inherit',
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolveRun();
				return;
			}
			rejectRun(new Error(
				`Could not ${description}: ${signal ? `terminated by ${signal}` : `exit ${String(code)}`}.`,
			));
		});
	});
}
