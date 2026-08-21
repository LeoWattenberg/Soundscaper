/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeWebVcrNormalizedCrop, type WebVcrNormalizedCrop } from '../web-vcr-domain.ts';
import type { CaptureSourcePortV1 } from '../platform/capture-source-port.ts';
import type {
	BrowserCaptureStream,
	BrowserCaptureTrack,
} from './framescaper-browser-capture-source.ts';
import type {
	FramescaperCaptureDisplaySelectionPort,
	FramescaperCaptureRecorderRequest,
} from './framescaper-capture-session-types.ts';
import type { FramescaperCaptureSourceAdapter } from './framescaper-capture-source-adapter-router.ts';
import type { FramescaperWebVcrCaptureAuthority } from './framescaper-web-vcr-controller.ts';
import { createWebVcrAudioMonitor, type WebVcrAudioMonitor } from './web-vcr-audio-monitor.ts';
import {
	createWebVcrRecorderFactory,
	type WebVcrRecorderFactoryOptions,
} from './web-vcr-recorder-factory.ts';

interface CloneableAudioTrack extends BrowserCaptureTrack {
	clone(): CloneableAudioTrack;
}

export interface FramescaperWebVcrCaptureAdapterOptions {
	readonly sourcePort: CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack>;
	readonly baseRecorder: WebVcrRecorderFactoryOptions['base'];
	readonly createStream: WebVcrRecorderFactoryOptions['createStream'];
	readonly getAudioContext: () => PromiseLike<Parameters<typeof createWebVcrAudioMonitor>[0]['context']>
		| Parameters<typeof createWebVcrAudioMonitor>[0]['context'];
	readonly openCrop: WebVcrRecorderFactoryOptions['openCrop'];
	readonly authority: Readonly<FramescaperWebVcrCaptureAuthority>;
}

export interface FramescaperWebVcrCaptureAdapterBinding {
	readonly adapter: Readonly<FramescaperCaptureSourceAdapter<BrowserCaptureStream, BrowserCaptureTrack>>;
	freezeCrop(value: Readonly<WebVcrNormalizedCrop>): void;
	setMonitorMuted(value: boolean): void;
}

/** Owns the guest preview grant, cloned monitor, and pre-encoder crop adapter. */
export function createFramescaperWebVcrCaptureAdapter(
	options: FramescaperWebVcrCaptureAdapterOptions,
): Readonly<FramescaperWebVcrCaptureAdapterBinding> {
	let frozenCrop: Readonly<WebVcrNormalizedCrop> = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
	let muted = false;
	let monitor: Readonly<WebVcrAudioMonitor> | null = null;
	const recorder = createWebVcrRecorderFactory({
		base: options.baseRecorder,
		frozenCrop: () => frozenCrop,
		openCrop: options.openCrop,
		createStream: options.createStream,
		onDimensions: options.authority.reportDimensions,
	});
	const sourcePort: CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack> = Object.freeze({
		probe: (request: Parameters<CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack>['probe']>[0]) => options.sourcePort.probe(request),
		async enumerate() { return Object.freeze({ devices: Object.freeze([]) }); },
		async openPreview(request: Parameters<CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack>['openPreview']>[0]) {
			const surface = options.authority.captureSurface();
			const lease = await options.sourcePort.openPreview({
				...request,
				displayVideoConstraints: Object.freeze({
					width: Object.freeze({ ideal: surface.width, max: surface.width }),
					height: Object.freeze({ ideal: surface.height, max: surface.height }),
				}),
			});
			const display = lease.sources.find(({ role }) => role === 'display');
			const pageAudio = lease.sources.find(({ role }) => role === 'system-audio');
			if (!display || !pageAudio || typeof (pageAudio.track as Partial<CloneableAudioTrack>).clone !== 'function') {
				await settlePreviewFailure(() => lease.dispose());
				throw new Error('Web VCR preview did not return its owned display and cloneable page-audio tracks.');
			}
			let ownedMonitor: Readonly<WebVcrAudioMonitor> | null = null;
			let detach: (() => void) | null = null;
			try {
				const context = await options.getAudioContext();
				if (typeof context.resume === 'function') await context.resume();
				if (context.state === 'suspended') {
					throw new Error('Web VCR page-audio monitoring context did not resume.');
				}
				ownedMonitor = createWebVcrAudioMonitor({
					track: pageAudio.track as CloneableAudioTrack,
					context,
					createStream: options.createStream,
					muted,
				});
				const attached = options.authority.attachMonitor(ownedMonitor);
				if (typeof attached !== 'function') {
					throw new TypeError('Web VCR monitor authority did not return a detach operation.');
				}
				detach = attached;
				monitor = ownedMonitor;
			} catch (error) {
				if (monitor === ownedMonitor) monitor = null;
				await settlePreviewFailure(
					() => detach?.(),
					() => ownedMonitor?.dispose(),
					() => lease.dispose(),
				);
				throw error;
			}
			const previewMonitor = ownedMonitor;
			const detachMonitor = detach;
			let disposePromise: Promise<void> | null = null;
			return Object.freeze({
				sources: lease.sources,
				dispose() {
					disposePromise ??= disposePreview();
					return disposePromise;
				},
			});

			async function disposePreview(): Promise<void> {
				if (monitor === previewMonitor) monitor = null;
				const failures = await settlePreviewCleanup([
					() => detachMonitor(),
					() => previewMonitor.dispose(),
					() => lease.dispose(),
				]);
				if (failures.length) throw new AggregateError(failures, 'Web VCR preview did not dispose cleanly.');
			}
		},
	});
	const adapter: FramescaperCaptureSourceAdapter<BrowserCaptureStream, BrowserCaptureTrack> = Object.freeze({
		id: 'web-vcr',
		sourcePort,
		displaySelection: Object.freeze({
			mode: 'owned-source' as const,
			async authorize(request: Parameters<FramescaperCaptureDisplaySelectionPort['authorize']>[0]) {
				const roles = new Set(request.roles);
				if (request.sourceToken !== null || roles.size !== 2
					|| !roles.has('display') || !roles.has('system-audio')) {
					throw new Error('Web VCR authorization requires exactly its owned display and page audio.');
				}
				await options.authority.prepareCapture();
			},
		}),
		createRecorder(request: FramescaperCaptureRecorderRequest<BrowserCaptureStream, BrowserCaptureTrack>) {
			return recorder(request);
		},
	});
	return Object.freeze({
		adapter,
		freezeCrop(value: Readonly<WebVcrNormalizedCrop>) { frozenCrop = normalizeWebVcrNormalizedCrop(value); },
		setMonitorMuted(value: boolean) {
			muted = value === true;
			monitor?.setMuted(muted);
		},
	});
}

type PreviewCleanup = () => PromiseLike<unknown> | unknown;

async function settlePreviewCleanup(operations: readonly PreviewCleanup[]): Promise<unknown[]> {
	const results = await Promise.allSettled(operations.map((operation) => Promise.resolve().then(operation)));
	return results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
}

async function settlePreviewFailure(...operations: readonly PreviewCleanup[]): Promise<void> {
	await settlePreviewCleanup(operations);
}
