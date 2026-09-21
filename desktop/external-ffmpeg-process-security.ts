/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared shell-free launch and regular-file identity mechanics for external FFmpeg. */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';

export interface ExternalFfmpegProcessSecurityLaunchOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly stdio: readonly string[];
	readonly detached: boolean;
}

export interface ExternalFfmpegRegularFileDigestOptions {
	readonly notRegularFile: () => Error;
}

/** Launch one reviewed executable without a shell or inherited stdio policy. */
export function spawnExternalFfmpegProcess(
	executablePath: string,
	arguments_: readonly string[],
	options: ExternalFfmpegProcessSecurityLaunchOptions,
): ChildProcess {
	return nodeSpawn(executablePath, [...arguments_], {
		cwd: options.cwd,
		env: { ...options.env },
		shell: false,
		stdio: [...options.stdio] as never,
		windowsHide: true,
		detached: options.detached,
	});
}

/** Hash only a file descriptor whose opened target is a regular file. */
export async function sha256ExternalFfmpegRegularFile(
	path: string,
	options: ExternalFfmpegRegularFileDigestOptions,
): Promise<string> {
	const handle = await open(path, fsConstants.O_RDONLY);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw options.notRegularFile();
		const hash = createHash('sha256');
		const buffer = Buffer.alloc(64 * 1_024);
		let position = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		return hash.digest('hex');
	} finally {
		await handle.close();
	}
}
