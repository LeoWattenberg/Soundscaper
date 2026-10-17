/* SPDX-License-Identifier: AGPL-3.0-only */
import { createScapeArchiveByteSource } from '../common/editor/scape-archive-byte-source.ts';
import type { MotionDesktopArchiveInput } from './desktop-file-adapter.ts';
import { MOTIONSCAPER_FILE_CHUNK_BYTES, type MotionDesktopFiles } from './desktop-file-contract.ts';
import type { MotionDesktopLaunch } from './desktop-launch-contract.ts';

export function motionscaperDesktopLaunch(value: unknown = globalThis): MotionDesktopLaunch | null {
	const global = value as { scapeDesktop?: { v1?: { motionLaunch?: unknown } } } | null;
	const launch = global?.scapeDesktop?.v1?.motionLaunch;
	if (!launch || typeof launch !== 'object') return null;
	if (!['take', 'acknowledge', 'onPending'].every(key => typeof (launch as Record<string, unknown>)[key] === 'function')) throw new TypeError('Motionscaper launch bridge is incomplete.');
	return launch as MotionDesktopLaunch;
}

/** Release is retryable across both native boundaries, including an opaque view. */
export async function takeMotionscaperDesktopLaunch(files: MotionDesktopFiles, launch: MotionDesktopLaunch): Promise<MotionDesktopArchiveInput | null> {
	const selected = await launch.take(); if (!selected) return null;
	let closed = false, acknowledged = false; let releasing: Promise<void> | null = null;
	const release = async () => {
		if (acknowledged) return;
		releasing ??= (async () => {
			if (!closed) { await files.release({ token: selected.token }); closed = true; }
			await launch.acknowledge({ token: selected.token }); acknowledged = true;
		})();
		try { await releasing; } finally { releasing = null; }
	};
	const readable = () => { if (closed || releasing) throw new Error('Motionscaper launch archive was released.'); };
	return Object.freeze({ name: selected.name, release,
		input: createScapeArchiveByteSource({ size: selected.byteLength, maximumReadBytes: MOTIONSCAPER_FILE_CHUNK_BYTES,
			read: async ({ offset, length, signal }) => {
				readable(); signal?.throwIfAborted(); const bytes = await files.read({ token: selected.token, offset, length }); signal?.throwIfAborted(); return bytes;
			},
		}),
		bind: async (projectId: string) => { readable(); await files.bindOpened({ token: selected.token, projectId }); },
	});
}
