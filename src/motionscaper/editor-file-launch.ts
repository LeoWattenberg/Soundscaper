/* SPDX-License-Identifier: AGPL-3.0-only */
import { isProjectFileName } from '../common/project-file-extensions.ts';
import { installFileHandlerLaunchConsumer, type FileHandlerLaunchConsumerInstallation, type FileHandlerLaunchQueue } from '../common/offline/file-handler-launch.ts';

const MAXIMUM_WAITING_LAUNCHES = 8;
export interface MotionFileLaunchOptions {
	readonly desktop: boolean;
	readonly launchQueue?: FileHandlerLaunchQueue | null;
	readonly onOpen: (file: File) => void | Promise<void>;
	readonly onError: (error: unknown) => void;
}

/** Motion routes OS-selected projects through File Open and awaits each complete admission. */
export function installMotionscaperFileLaunch(options: MotionFileLaunchOptions): Readonly<FileHandlerLaunchConsumerInstallation> {
	const queue = options.launchQueue ?? (globalThis as { launchQueue?: FileHandlerLaunchQueue }).launchQueue;
	let pending = 0; let released = false;
	const boundedQueue: FileHandlerLaunchQueue | null = queue ? { setConsumer(consumer) {
		queue.setConsumer(params => {
			if (released) return;
			if (!Array.isArray(params.files) || params.files.length !== 1) {
				options.onError(new RangeError('Choose one Scape project for each Motionscaper file launch.')); return;
			}
			if (pending >= MAXIMUM_WAITING_LAUNCHES) { options.onError(new RangeError('Too many pending Motionscaper file launches.')); return; }
			pending++; consumer(params);
			void Promise.resolve().then(async () => { await installation.settled(); pending--; }).catch(options.onError);
		});
	} } : null;
	const installation = installFileHandlerLaunchConsumer({ desktop: options.desktop, launchQueue: boundedQueue, onError: options.onError,
		deliver: async launch => {
			if (released) return;
			const file = launch.files[0];
			if (!(file instanceof File) || !isProjectFileName(file.name)) throw new TypeError('Motionscaper file launches require a Scape project archive.');
			await options.onOpen(file);
		},
	});
	return Object.freeze({ status: installation.status, settled: () => installation.settled(),
		release() { if (!released) { released = true; installation.release(); } },
	});
}

/** Only named shortcuts consume the query; locale, other fields and the fragment remain. */
export function takeMotionscaperShortcut(url: URL): 'new' | 'open' | null {
	const launch = url.searchParams.get('launch');
	if (launch !== 'new-project' && launch !== 'open-project') return null;
	url.searchParams.delete('launch'); return launch === 'new-project' ? 'new' : 'open';
}
