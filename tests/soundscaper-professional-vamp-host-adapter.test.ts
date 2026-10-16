/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MODULE = resolve(import.meta.dirname,
	'../native/soundscaper-professional-host/cmake/exact-vamp-host-adapter.cmake');
const SOURCE = `/* Upstream notice must survive the build-copy transformation. */
#include <string>
#include <vector>
#include "Files.h"
class PluginHostAdapter {
public:
 static std::vector<std::string> getPluginPath();
 bool initialise(unsigned long, unsigned long, unsigned long);
};

std::vector<std::string>
PluginHostAdapter::getPluginPath()
{
 std::string path;
 Files::getEnvUtf8("VAMP_PATH", path);
 return {path};
}

bool
PluginHostAdapter::initialise(unsigned long channels, unsigned long, unsigned long)
{
 return channels == 2;
}
int main() { return PluginHostAdapter().initialise(2, 256, 256) ? 0 : 1; }
`;

test('the exact Vamp build copy links the adapter without ambient-search dependencies', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-exact-vamp-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'upstream.cpp');
	const output = join(root, 'exact.cpp');
	const script = join(root, 'prepare.cmake');
	await Promise.all([
		writeFile(input, SOURCE),
		writeFile(script, `include("${MODULE}")\n`
			+ `soundscaper_write_exact_vamp_host_adapter("${input}" "${output}")\n`),
	]);
	await execute('cmake', ['-P', script]);
	assert.equal(await readFile(input, 'utf8'), SOURCE);
	const generated = await readFile(output, 'utf8');
	assert.ok(generated.startsWith('/* Upstream notice must survive'));
	assert.ok(generated.endsWith(SOURCE.slice(SOURCE.indexOf('\nbool\n'))));
	assert.doesNotMatch(generated, /Files::|#include "Files.h"|VAMP_PATH/u);
	const executable = join(root, 'probe');
	// Resolve every external before dead stripping, as the Windows linker does.
	await execute('c++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', output, '-o', executable]);
	await execute(executable, []);
});

test('the Vamp build-copy transformation rejects an unexpected SDK method boundary', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-exact-vamp-boundary-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'upstream.cpp');
	const output = join(root, 'exact.cpp');
	const script = join(root, 'prepare.cmake');
	await writeFile(script, `include("${MODULE}")\n`
		+ `soundscaper_write_exact_vamp_host_adapter("${input}" "${output}")\n`);
	for (const unexpected of [
		SOURCE.replace('PluginHostAdapter::getPluginPath()', 'PluginHostAdapter::differentMethod()'),
		SOURCE.replace('PluginHostAdapter::initialise(', 'PluginHostAdapter::differentMethod('),
		SOURCE + '\nvoid unexpected() { Files::getEnvUtf8("VAMP_PATH", value); }\n',
	]) {
		await writeFile(input, unexpected);
		await assert.rejects(execute('cmake', ['-P', script]), /unexpected Vamp SDK/u);
		await assert.rejects(readFile(output), { code: 'ENOENT' });
	}
});
