/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Preserve the completion helper's upstream and statically linked runtime notices. */
export async function desktopLlamaCppNotices({ sourceRoot, platform, compiler, read = readFile }) {
	const sources = ['LICENSE', 'licenses/LICENSE-jsonhpp', 'vendor/cpp-httplib/LICENSE'];
	const texts = await Promise.all(sources.map((path) => read(join(sourceRoot, path), 'utf8')));
	if (texts.some((text) => !text.includes('Permission is hereby granted'))) throw new Error('A llama.cpp dependency license is incomplete.');
	const opsPath = 'ggml/src/ggml-cpu/ops.cpp';
	const ops = await read(join(sourceRoot, opsPath), 'utf8');
	const yarn = ops.match(/\/\/ YaRN algorithm based on[^\n]+\n\/\/ MIT licensed\. Copyright[^\n]+/u)?.[0];
	if (!yarn) throw new Error('The llama.cpp YaRN notice is missing.');
	const body = texts.map((text, index) => `${sources[index]}\n\n${text}`).join('\n\n');
	const notices = [{ path: 'THIRD_PARTY_NOTICES.txt', sources: [...sources, opsPath],
		bytes: Buffer.from(`llama.cpp completion helper third-party notices\n\n${body}\n\n${yarn}\n`) }];
	if (platform === 'linux') {
		if (compiler.id !== 'GNU' || !/^\d+\.\d+/u.test(compiler.version)) throw new Error('Linux llama.cpp runtime notices require its recorded GNU compiler.');
		const copyrightPath = `/usr/share/doc/gcc-${compiler.version.split('.')[0]}-base/copyright`;
		const copyright = await read(copyrightPath, 'utf8');
		const gplPath = '/usr/share/common-licenses/GPL-3', gpl = await read(gplPath, 'utf8');
		if (!copyright.includes('GCC Runtime Library Exception') || !copyright.includes('libstdc++') || !gpl.includes('GNU GENERAL PUBLIC LICENSE')) {
			throw new Error('The llama.cpp GNU runtime notices are incomplete.');
		}
		notices.push({ path: 'GCC-COPYRIGHT.txt', sources: [copyrightPath], bytes: Buffer.from(copyright) },
			{ path: 'GCC-GPL-3.txt', sources: [gplPath], bytes: Buffer.from(gpl) });
	}
	return notices;
}
