/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CapturePreviewSource,
	CaptureSourcePortV1,
} from '../platform/capture-source-port.ts';
import type {
	FramescaperCaptureDisplaySelectionPort,
	FramescaperCaptureRecorder,
	FramescaperCaptureRecorderRequest,
} from './framescaper-capture-session-types.ts';

export type FramescaperCaptureSourceAdapterId = 'devices' | 'web-vcr';

export interface FramescaperCaptureSourceAdapter<Stream = unknown, Track = unknown> {
	readonly id: FramescaperCaptureSourceAdapterId;
	readonly sourcePort: CaptureSourcePortV1<Stream, Track>;
	readonly displaySelection?: FramescaperCaptureDisplaySelectionPort;
	createRecorder(
		request: FramescaperCaptureRecorderRequest<Stream, Track>,
	): PromiseLike<FramescaperCaptureRecorder> | FramescaperCaptureRecorder;
}

export interface FramescaperCaptureSourceAdapterRouter<Stream = unknown, Track = unknown> {
	readonly activeId: FramescaperCaptureSourceAdapterId;
	readonly sourcePort: CaptureSourcePortV1<Stream, Track>;
	readonly displaySelection: FramescaperCaptureDisplaySelectionPort;
	select(id: FramescaperCaptureSourceAdapterId): void;
	createRecorder(
		request: FramescaperCaptureRecorderRequest<Stream, Track>,
	): PromiseLike<FramescaperCaptureRecorder> | FramescaperCaptureRecorder;
	sourceIdentity(
		source: Readonly<CapturePreviewSource<Stream, Track>>,
		createId: (prefix: string) => string,
	): string;
}

/** Selects one source authority while retaining one 8A session/recovery owner. */
export function createFramescaperCaptureSourceAdapterRouter<Stream = unknown, Track = unknown>(
	adaptersValue: readonly FramescaperCaptureSourceAdapter<Stream, Track>[],
): Readonly<FramescaperCaptureSourceAdapterRouter<Stream, Track>> {
	const adapters = normalizeAdapters(adaptersValue);
	const deviceAdapter = adapters.get('devices');
	if (!deviceAdapter) throw new Error('Capture source adapters require the devices adapter.');
	let active = deviceAdapter;
	const sourceOwners = new WeakMap<object, FramescaperCaptureSourceAdapter<Stream, Track>>();

	const sourcePort: CaptureSourcePortV1<Stream, Track> = Object.freeze({
		probe: (request: Parameters<CaptureSourcePortV1<Stream, Track>['probe']>[0]) => active.sourcePort.probe(request),
		enumerate: (request: Parameters<CaptureSourcePortV1<Stream, Track>['enumerate']>[0]) => active.sourcePort.enumerate(request),
		async openPreview(request: Parameters<CaptureSourcePortV1<Stream, Track>['openPreview']>[0]) {
			const owner = active;
			const lease = await owner.sourcePort.openPreview(request);
			for (const source of lease.sources) sourceOwners.set(source as object, owner);
			return Object.freeze({
				sources: lease.sources,
				dispose: () => lease.dispose(),
			});
		},
	});
	const displaySelection: FramescaperCaptureDisplaySelectionPort = Object.freeze({
		get mode() { return active.displaySelection?.mode ?? 'source-list'; },
		listSources() {
			const operation = active.displaySelection?.listSources;
			if (!operation) throw new Error('Capture source listing is unavailable for the active adapter.');
			return operation.call(active.displaySelection);
		},
		authorize(request: Parameters<FramescaperCaptureDisplaySelectionPort['authorize']>[0]) {
			const operation = active.displaySelection?.authorize;
			if (!operation) throw new Error('Display authorization is unavailable for the active adapter.');
			return operation.call(active.displaySelection, request);
		},
	});

	return Object.freeze({
		get activeId() { return active.id; },
		sourcePort,
		displaySelection,
		select(id: FramescaperCaptureSourceAdapterId) {
			const selected = adapters.get(id);
			if (!selected) throw new Error(`Capture source adapter ${id} is unavailable.`);
			active = selected;
		},
		createRecorder(request: FramescaperCaptureRecorderRequest<Stream, Track>) {
			const owner = sourceOwners.get(request.source as object);
			if (!owner) throw new Error('Capture recorder source has no adapter owner.');
			return owner.createRecorder(request);
		},
		sourceIdentity(source: Readonly<CapturePreviewSource<Stream, Track>>, createId: (prefix: string) => string) {
			const owner = sourceOwners.get(source as object);
			if (!owner) throw new Error('Capture source identity has no adapter owner.');
			const generated = createId(`${source.role}-capture-source`);
			return owner.id === 'web-vcr' ? webVcrRecoveryOwnerId(generated) : generated;
		},
	});
}

export function webVcrRecoveryOwnerId(value: string): string {
	if (typeof value !== 'string' || !value || value.length > 240
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError('Web VCR recovery owner identity is invalid.');
	}
	return `web-vcr:${value}`;
}

export function isWebVcrRecoveryOwner(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('web-vcr:')
		&& value.length > 'web-vcr:'.length && value.length <= 256
		&& !/[\u0000-\u001f\u007f]/u.test(value);
}

function normalizeAdapters<Stream, Track>(
	value: readonly FramescaperCaptureSourceAdapter<Stream, Track>[],
): ReadonlyMap<FramescaperCaptureSourceAdapterId, FramescaperCaptureSourceAdapter<Stream, Track>> {
	if (!Array.isArray(value) || !value.length) throw new TypeError('Capture source adapters are required.');
	const adapters = new Map<FramescaperCaptureSourceAdapterId, FramescaperCaptureSourceAdapter<Stream, Track>>();
	for (const adapter of value) {
		if (!adapter || (adapter.id !== 'devices' && adapter.id !== 'web-vcr')
			|| !adapter.sourcePort || typeof adapter.createRecorder !== 'function') {
			throw new TypeError('Capture source adapter is invalid.');
		}
		if (adapters.has(adapter.id)) throw new Error(`Duplicate capture source adapter ${adapter.id}.`);
		adapters.set(adapter.id, adapter);
	}
	return adapters;
}
