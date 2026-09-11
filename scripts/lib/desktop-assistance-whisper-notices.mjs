/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Preserve notices from the authenticated source and the compiler used to link it. */
export async function desktopWhisperCppNotices({ sourceRoot, platform, compiler,
	read = readFile }) {
	const [license, miniaudio, vorbis, cpu] = await Promise.all([
		'LICENSE', 'examples/miniaudio.h', 'examples/stb_vorbis.c', 'ggml/src/ggml-cpu/ops.cpp',
	].map((path) => read(join(sourceRoot, path), 'utf8')));
	const yarn = cpu.match(/\/\/ YaRN algorithm based on[^\n]+\n\/\/ MIT licensed\. Copyright[^\n]+/u)?.[0];
	if (!yarn) throw new Error('Whisper YaRN copyright notice was not found in its pinned source.');
	const text = ['Whisper CLI compiled third-party notices',
		'Whisper and ggml: see the adjacent LICENSE file.',
		'Compiled audio reader: miniaudio, including its embedded dr_wav, dr_flac and dr_mp3 implementations.',
		'Upstream source: examples/miniaudio.h',
		trailingLicense(miniaudio, 'This software is available as a choice of the following licenses.'),
		'Compiled Vorbis decoder: stb_vorbis', 'Upstream source: examples/stb_vorbis.c',
		trailingLicense(vorbis, 'This software is available under 2 licenses -- choose whichever you prefer.'),
		'ggml CPU YaRN implementation', 'Upstream source: ggml/src/ggml-cpu/ops.cpp',
		yarn, license,
	].join('\n\n');
	const files = [{ path: 'THIRD_PARTY_NOTICES.txt', bytes: Buffer.from(`${text}\n`),
		sources: ['examples/miniaudio.h', 'examples/stb_vorbis.c', 'ggml/src/ggml-cpu/ops.cpp', 'LICENSE'] }];
	if (platform === 'linux') {
		// The native Linux recipe statically links GCC's runtime libraries. Ubuntu's
		// compiler package supplies their complete copyright and exception notices.
		if (compiler.id !== 'GNU' || !/^\d+\.\d+/u.test(compiler.version)) {
			throw new Error('Whisper Linux runtime notices require the recorded GNU compiler.');
		}
		const source = `/usr/share/doc/gcc-${compiler.version.split('.')[0]}-base/copyright`;
		const copyright = await read(source, 'utf8');
		const gplSource = '/usr/share/common-licenses/GPL-3';
		const gpl = await read(gplSource, 'utf8');
		if (!copyright.includes('GCC Runtime Library Exception') || !copyright.includes('libstdc++')
			|| !gpl.includes('GNU GENERAL PUBLIC LICENSE')) {
			throw new Error('Whisper GNU runtime copyright or license notice is incomplete.');
		}
		files.push({ path: 'GCC-COPYRIGHT.txt', bytes: Buffer.from(copyright), sources: [source] },
			{ path: 'GCC-GPL-3.txt', bytes: Buffer.from(gpl), sources: [gplSource] });
	}
	return files;
}

function trailingLicense(source, marker) {
	const begin = source.lastIndexOf('/*', source.indexOf(marker));
	const end = source.indexOf('*/', begin);
	if (begin < 0 || end < 0 || !source.slice(begin, end).includes(marker)) {
		throw new Error('Whisper dependency license was not found in its pinned source.');
	}
	return source.slice(begin, end + 2);
}
