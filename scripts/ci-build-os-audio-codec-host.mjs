#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** GitHub-hosted target-native codec addon acquisition/build entry point. */

import { resolve } from 'node:path';

import { runOsAudioCodecHostCi } from './lib/os-audio-codec-host-ci.mjs';

const allowed = new Set(['desktop-platform', 'desktop-arch', 'runner-os', 'runner-arch']);
const argumentsByName = parseArguments(process.argv.slice(2));
for (const required of allowed) {
	if (argumentsByName[required] === undefined) throw new TypeError(`--${required}=... is required.`);
}
const result = await runOsAudioCodecHostCi({
	repositoryRoot: resolve(process.cwd()),
	runnerTemp: process.env.RUNNER_TEMP,
	githubEnvironmentPath: process.env.GITHUB_ENV,
	desktopPlatform: argumentsByName['desktop-platform'],
	desktopArch: argumentsByName['desktop-arch'],
	runnerOs: argumentsByName['runner-os'],
	runnerArch: argumentsByName['runner-arch'],
});
process.stdout.write(`Built and verified ${result.target} OS audio codec host in RUNNER_TEMP.\n`);

function parseArguments(values) {
	const result = {};
	for (const value of values) {
		const separator = value.indexOf('=');
		const name = value.slice(2, separator);
		const argument = value.slice(separator + 1);
		if (!value.startsWith('--') || separator < 3 || !allowed.has(name)
			|| argument.length === 0 || result[name] !== undefined) {
			throw new TypeError(`Unsupported or duplicate CI argument ${value}.`);
		}
		result[name] = argument;
	}
	return result;
}
