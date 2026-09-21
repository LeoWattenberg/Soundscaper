/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const HOST = join(ROOT, 'native/soundscaper-professional-host');

test('the authenticated professional peer has a closed M5A1 Vamp analyzer mode', async () => {
	const [main, peer, header] = await Promise.all([
		readFile(join(HOST, 'src/professional_host_peer.cpp'), 'utf8'),
		readFile(join(HOST, 'src/vamp_analyzer_peer.cpp'), 'utf8'),
		readFile(join(HOST, 'src/vamp_analyzer_peer.h'), 'utf8'),
	]);
	assert.match(main, /--vamp-analyzer/u);
	assert.match(main, /runVampAnalyzerPeer/u);
	assert.match(header, /int runVampAnalyzerPeer\(\)/u);
	assert.match(peer, /'M', '5', 'A', '1'/u);
	for (const operation of ['scan', 'open', 'configure', 'process', 'finish', 'cancel', 'close']) {
		assert.match(peer, new RegExp(`${operation}\\s*=`, 'u'));
	}
	assert.match(peer, /ExactVampAnalyzer::scanExactLibrary/u);
	assert.match(peer, /ExactVampAnalyzer::openExactLibrary/u);
	assert.doesNotMatch(peer, /PluginLoader|listPlugins|VAMP_PATH/u);
});

test('CMake builds and links the exact Vamp HostExt closure into the existing peer artifact', async () => {
	const cmake = await readFile(join(HOST, 'CMakeLists.txt'), 'utf8');
	assert.match(cmake, /SOUNDSCAPER_VAMP_ROOT/u);
	assert.match(cmake, /add_library\(soundscaper_professional_vamp STATIC/u);
	for (const source of [
		'PluginHostAdapter.cpp', 'PluginInputDomainAdapter.cpp', 'PluginWrapper.cpp', 'RealTime.cpp',
		'vamp_exact_library.cpp', 'vamp_analyzer_adapter.cpp', 'vamp_analyzer_peer.cpp',
	]) assert.match(cmake, new RegExp(source.replace('.', '\\.'), 'u'));
	assert.match(cmake,
		/target_link_libraries\(soundscaper_professional_peer PRIVATE[\s\S]*soundscaper_professional_vamp/u);
	assert.match(cmake, /add_executable\(soundscaper_vamp_analyzer_self_test/u);
	assert.match(cmake, /add_test\(NAME soundscaper_vamp_analyzer_self_test/u);
	assert.doesNotMatch(cmake, /PluginLoader\.cpp|Files\.cpp|PluginChannelAdapter\.cpp/u);
});
