/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function runFramescaperMediaHostRecipeCli(options) {
	if (!process.argv[1] || options.moduleUrl !== pathToFileURL(resolve(process.argv[1])).href) return;
	try {
		const cli = parseCli(process.argv.slice(2), options.optionFields);
		const recipe = options.createRecipe(cli.values);
		if (cli.mode === 'run') options.executeRecipe(recipe);
		else process.stdout.write(`${JSON.stringify(recipe, null, '\t')}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

function parseCli(argv, optionFields) {
	const values = {};
	let mode = null;
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		if (key === '--print' || key === '--run') {
			if (mode !== null) throw new TypeError('Choose exactly one recipe mode.');
			mode = key.slice(2);
			continue;
		}
		if (!key?.startsWith('--') || index + 1 >= argv.length) {
			throw new TypeError('The media-host recipe arguments are invalid.');
		}
		const field = key.slice(2).replaceAll(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
		if (!optionFields.includes(field) || Object.hasOwn(values, field)) {
			throw new TypeError(`Unsupported recipe option ${key}.`);
		}
		values[field] = argv[index += 1];
	}
	if (mode === null) throw new TypeError('Choose --print or --run.');
	return { values, mode };
}
