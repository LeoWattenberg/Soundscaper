/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check

import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { productStandInAliasesFor } from './lib/product-aliases.mjs';
import { createProductCompilerHost } from './lib/product-compiler-host.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const compositions = ['soundscaper-browser', 'soundscaper-desktop', 'framescaper-browser', 'framescaper-desktop'];
const selected = process.argv[2];

if (selected === undefined) {
	// A fresh process for each graph bounds compiler memory on four-core CI.
	for (const composition of compositions) {
		const result = spawnSync(process.execPath, [import.meta.filename, composition], { stdio: 'inherit' });
		if (result.error) throw result.error;
		if (result.status !== 0) process.exit(result.status ?? 1);
	}
} else {
	if (!compositions.includes(selected)) throw new Error(`Unknown product composition: ${selected}`);
	const [productId, platform] = selected.split('-');
	const configPath = resolve(repositoryRoot, 'tsconfig.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repositoryRoot);
	const options = { ...parsed.options, incremental: false, tsBuildInfoFile: undefined };
	const host = createProductCompilerHost(options, {
		repositoryRoot,
		aliases: productStandInAliasesFor({ productId, desktopCodecComposition: platform === 'desktop' }),
	});
	const program = ts.createProgram(parsed.fileNames, options, host);
	const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
	if (diagnostics.length) {
		console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCanonicalFileName: (file) => file,
			getCurrentDirectory: () => repositoryRoot,
			getNewLine: () => '\n',
		}));
		process.exitCode = 1;
	} else {
		console.log(`Typechecked ${selected} with production module substitutions.`);
	}
}
