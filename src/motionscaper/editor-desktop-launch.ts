/* SPDX-License-Identifier: AGPL-3.0-only */
import { takeMotionscaperDesktopLaunch } from './desktop-launch-adapter.ts';
import type { MotionDesktopArchiveInput } from './desktop-file-adapter.ts';
import type { MotionDesktopFiles } from './desktop-file-contract.ts';
import type { MotionDesktopLaunch } from './desktop-launch-contract.ts';

/** Subscribe before the initial drain. A dialog retains its selection until review or custody closes. */
export function installMotionscaperDesktopLaunch(options: Readonly<{
	files: MotionDesktopFiles; launch: MotionDesktopLaunch; canOpen: () => boolean;
	onOpen: (selection: MotionDesktopArchiveInput) => Promise<void>; onError: (error: unknown) => void;
}>): Readonly<{ wake(): void; dispose(): void }> {
	let disposed = false, pending = true, active = false, generation = 0;
	const drain = async () => {
		try {
			while (!disposed && pending && options.canOpen()) {
				const observed = generation;
				const selection = await takeMotionscaperDesktopLaunch(options.files, options.launch);
				if (!selection) { pending = observed !== generation; if (pending) continue; break; }
				if (disposed) { await selection.release(); break; }
				// The receiver now owns release/ACK, including retry after partial cleanup.
				await options.onOpen(selection);
			}
		} catch (error) { pending = false; options.onError(error); }
		finally { active = false; }
	};
	const wake = () => { if (disposed || active || !pending || !options.canOpen()) return; active = true; void drain(); };
	const unsubscribe = options.launch.onPending(() => { generation++; pending = true; wake(); });
	wake();
	return Object.freeze({ wake, dispose() { disposed = true; unsubscribe(); } });
}
