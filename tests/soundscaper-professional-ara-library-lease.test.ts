/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const SOURCE_ROOT = resolve(import.meta.dirname, '../native/soundscaper-professional-host/src');

test('the Windows ARA factory lease keeps code loaded through document teardown', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ara-library-lease-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await Promise.all([
		writeFile(join(root, 'fixture.cpp'), 'extern "C" int render() { return 42; }\n'),
		writeFile(join(root, 'windows.h'), `#pragma once
using HMODULE = void*;
using LPCWSTR = const wchar_t*;
constexpr unsigned long GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS = 4;
int GetModuleHandleExW(unsigned long, LPCWSTR, HMODULE*);
int FreeLibrary(HMODULE);
`),
		writeFile(join(root, 'probe.cpp'), `#include "ara_factory_library_lease.h"
#include "windows.h"
#include <cassert>
#include <dlfcn.h>
static bool refuse = false;
static int acquisitions = 0, releases = 0;
int GetModuleHandleExW(unsigned long flags, LPCWSTR address, HMODULE* result)
{
 assert(flags == GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS);
 if (refuse) return 0;
 Dl_info info{};
 if (!dladdr(address, &info)) return 0;
 *result = dlopen(info.dli_fname, RTLD_NOW | RTLD_NOLOAD);
 if (*result) ++acquisitions;
 return *result != nullptr;
}
int FreeLibrary(HMODULE module) { ++releases; return dlclose(module) == 0; }
int main(int argc, char** argv)
{
 assert(argc == 2);
 void* original = dlopen(argv[1], RTLD_NOW);
 assert(original);
 auto render = reinterpret_cast<int (*)()>(dlsym(original, "render"));
 assert(render);
 {
  soundscaper::AraFactoryLibraryLease lease;
  assert(!lease.retain(nullptr));
  assert(lease.retain(reinterpret_cast<const void*>(render)));
  assert(lease.retain(reinterpret_cast<const void*>(render)));
  assert(acquisitions == 2 && releases == 1);
  refuse = true;
  assert(!lease.retain(reinterpret_cast<const void*>(render)));
  assert(acquisitions == 2 && releases == 1);
  assert(dlclose(original) == 0);
  // Simulate the host closing its plug-in before the ARA document and factory.
  void* stillLoaded = dlopen(argv[1], RTLD_NOW | RTLD_NOLOAD);
  assert(stillLoaded);
  assert(render() == 42);
  assert(dlclose(stillLoaded) == 0);
 }
 assert(acquisitions == releases);
 assert(!dlopen(argv[1], RTLD_NOW | RTLD_NOLOAD));
}
`),
	]);
	const library = join(root, 'fixture.so');
	const executable = join(root, 'probe');
	await execute('c++', ['-shared', '-fPIC', join(root, 'fixture.cpp'), '-o', library]);
	await execute('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Werror', '-D_WIN32', '-I', root, '-I', SOURCE_ROOT,
		join(root, 'probe.cpp'), join(SOURCE_ROOT, 'ara_factory_library_lease.cpp'), '-ldl', '-o', executable,
	]);
	await execute(executable, [library]);
});
