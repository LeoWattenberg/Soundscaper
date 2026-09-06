/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * An operating-system launch, claimed and drained.
 *
 * `launchQueue` is a queue: it holds the launch until a consumer takes it, so
 * claiming it here rather than from the document entry loses nothing and keeps
 * `file-handler-launch.ts` out of the entry's module graph. A module the entry
 * and the shell both import statically is owned by the entry chunk, and the
 * shell then imports the entry that imported the shell — which is a cycle the
 * startup-graph budget refuses outright.
 *
 * The batch is handed on whole, in the flat list the launch resolved, to the
 * same entry point a dropped batch takes. Re-deriving the projects/media split
 * here would fork the routing: a launched `.aup3`, `.dawproject` or label file
 * would take a different path from the identical dropped file, and only one of
 * the two paths would keep working as that routing changes.
 */

import { useEffect, useRef } from 'react';

import {
	installFileHandlerLaunchConsumer,
	subscribeLaunchedFiles,
	type LaunchedFiles,
} from '../../../offline/file-handler-launch.ts';

export interface LaunchedFileImportsInput {
	/** Waited on before the files are routed, because a launch beats the controller to readiness. */
	readonly controller: { readonly ready?: PromiseLike<unknown> | null } | null;
	/** The workspace's own routed import, which a dropped batch also goes through. */
	readonly importFiles: (files: readonly File[]) => unknown;
	readonly onError: (error: unknown) => void;
	/** The desktop build has its own file handling and claims no launch queue. */
	readonly desktop?: boolean;
	/** Injectable for tests; the shared launch buffer otherwise. */
	readonly subscribe?: (handler: (launch: LaunchedFiles) => unknown) => () => void;
	/** Injectable for tests; claims the browser launch queue otherwise. */
	readonly claim?: (options: Readonly<{ desktop: boolean }>) => unknown;
}

export function useLaunchedFileImports({
	controller,
	importFiles,
	onError,
	desktop = false,
	subscribe = subscribeLaunchedFiles,
	claim = installFileHandlerLaunchConsumer,
}: LaunchedFileImportsInput): void {
	// The routed import is rebuilt whenever the open project or the project bin
	// changes; the subscription is not, so a launch in flight is never handed to
	// a closure that has just been replaced.
	const importRef = useRef(importFiles);
	useEffect(() => { importRef.current = importFiles; }, [importFiles]);
	useEffect(() => {
		// Claiming is idempotent, so a remount re-subscribes without disturbing the
		// consumer the first mount installed.
		claim({ desktop });
		const unsubscribe = subscribe(async (launch: LaunchedFiles) => {
			const files = [...(launch?.files ?? [])];
			if (files.length === 0) return;
			try {
				// The launch is delivered while the editor is still booting, so the
				// files wait for the controller rather than being routed at an
				// engine that cannot open them yet.
				await controller?.ready;
				await importRef.current(files);
			} catch (error) {
				onError(error);
			}
		});
		// A launch that arrives while nothing is subscribed goes back to the
		// buffer, so tearing this down between renders costs nothing but delay.
		return unsubscribe;
	}, [claim, controller, desktop, onError, subscribe]);
}
