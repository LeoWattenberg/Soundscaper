/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CapturePreviewLease, CapturePreviewSource } from '../platform/capture-source-port.ts';
import type {
	FramescaperCaptureLevelMonitor,
	FramescaperCaptureDisplaySource,
	FramescaperCapturePreviewSurface,
	FramescaperCaptureSourceSettings,
} from './framescaper-capture-session-types.ts';

export interface FramescaperCapturePreviewResources {
	readonly surfaces: ReadonlyMap<string, FramescaperCapturePreviewSurface>;
	readonly levelMonitors: ReadonlyMap<string, FramescaperCaptureLevelMonitor>;
	dispose(): Promise<void>;
}

export async function createFramescaperCapturePreviewResources<Stream, Track>(
	sources: readonly Readonly<CapturePreviewSource<Stream, Track>>[],
	options: Readonly<{
		createPreviewSurface?: (
			source: Readonly<CapturePreviewSource<Stream, Track>>,
		) => PromiseLike<FramescaperCapturePreviewSurface> | FramescaperCapturePreviewSurface;
		createLevelMonitor?: (
			source: Readonly<CapturePreviewSource<Stream, Track>>,
			onLevel: () => void,
		) => PromiseLike<FramescaperCaptureLevelMonitor> | FramescaperCaptureLevelMonitor;
		onLevel(): void;
	}>,
): Promise<FramescaperCapturePreviewResources> {
	const surfaces = new Map<string, FramescaperCapturePreviewSurface>();
	const levelMonitors = new Map<string, FramescaperCaptureLevelMonitor>();
	let disposed = false;
	const dispose = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		const results = await Promise.allSettled([
			...surfaces.values(), ...levelMonitors.values(),
		].map((resource) => Promise.resolve(resource.dispose())));
		const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
		if (failures.length) throw new AggregateError(failures, 'Capture preview resources did not release cleanly.');
	};
	try {
		for (const source of sources) {
			if (['camera', 'display'].includes(source.role) && options.createPreviewSurface) {
				surfaces.set(source.sourceId, await options.createPreviewSurface(source));
			}
			if (['microphone', 'system-audio'].includes(source.role) && options.createLevelMonitor) {
				levelMonitors.set(source.sourceId, await options.createLevelMonitor(source, options.onLevel));
			}
		}
	} catch (error) {
		try { await dispose(); } catch { /* Preserve the resource-construction failure. */ }
		throw error;
	}
	return Object.freeze({ surfaces, levelMonitors, dispose });
}

export function currentCaptureTrackRecord(
	track: unknown,
	method: 'getSettings' | 'getCapabilities',
	fallback: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	if (!track || typeof track !== 'object') return fallback;
	const operation = (track as Record<string, unknown>)[method];
	if (typeof operation !== 'function') return fallback;
	try {
		const value = operation.call(track);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
		return Object.freeze({ ...(value as Record<string, unknown>) });
	} catch {
		return fallback;
	}
}

export function captureTrackLabel(track: unknown): string {
	if (!track || typeof track !== 'object') return '';
	const label = (track as { readonly label?: unknown }).label;
	return typeof label === 'string' ? label : '';
}

export function captureLevel(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.max(0, Math.min(1, value))
		: null;
}

export function capturePreviewSourceSnapshots<Stream, Track>(
	sources: readonly Readonly<CapturePreviewSource<Stream, Track>>[],
	resources: FramescaperCapturePreviewResources | null,
) {
	return Object.freeze(sources.map((source) => {
		const surface = resources?.surfaces.get(source.sourceId);
		const monitor = resources?.levelMonitors.get(source.sourceId);
		return Object.freeze({
			sourceId: source.sourceId, role: source.role, label: captureTrackLabel(source.track),
			settings: currentCaptureTrackRecord(source.track, 'getSettings', source.settings),
			capabilities: currentCaptureTrackRecord(source.track, 'getCapabilities', source.capabilities),
			previewUrl: surface?.url ?? null, previewStream: surface?.stream,
			level: captureLevel(monitor?.level),
		});
	}));
}

export async function applyCaptureSourceSettings(
	track: unknown,
	value: Readonly<FramescaperCaptureSourceSettings>,
): Promise<void> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Capture source settings must be a closed data record.');
	}
	const allowed = new Set(['width', 'height', 'frameRate', 'sampleRate', 'channelCount']);
	const entries = Object.entries(value);
	if (!entries.length || entries.some(([key]) => !allowed.has(key))) {
		throw new TypeError('Capture source settings have an invalid closed shape.');
	}
	const constraints = Object.fromEntries(entries.map(([key, setting]) => {
		if (typeof setting !== 'number' || !Number.isFinite(setting) || setting <= 0
			|| (key !== 'frameRate' && !Number.isSafeInteger(setting))) {
			throw new RangeError(`Capture source ${key} must be a positive finite setting.`);
		}
		return [key, Object.freeze({ exact: setting })];
	}));
	if (!track || typeof track !== 'object'
		|| typeof (track as { readonly applyConstraints?: unknown }).applyConstraints !== 'function') {
		throw new Error('This capture source does not expose configurable settings.');
	}
	await (track as { applyConstraints(value: Readonly<Record<string, unknown>>): PromiseLike<void> | void })
		.applyConstraints(Object.freeze(constraints));
}

export function selectedCaptureDevices<Stream, Track>(
	sources: readonly Readonly<CapturePreviewSource<Stream, Track>>[],
	current: Readonly<Partial<Record<'camera' | 'microphone', string>>>,
): Readonly<Partial<Record<'camera' | 'microphone', string>>> {
	const selected: Partial<Record<'camera' | 'microphone', string>> = {};
	for (const source of sources) {
		if (source.role !== 'camera' && source.role !== 'microphone') continue;
		const settings = currentCaptureTrackRecord(source.track, 'getSettings', source.settings);
		const id = typeof settings.deviceId === 'string' && settings.deviceId
			? settings.deviceId
			: current[source.role];
		if (id) selected[source.role] = id;
	}
	return Object.freeze(selected);
}

export async function disposeCapturePreviewOwnership<Stream, Track>(
	lease: CapturePreviewLease<Stream, Track> | null,
	resources: FramescaperCapturePreviewResources | null,
): Promise<void> {
	const operations: Promise<void>[] = [];
	if (resources) operations.push(Promise.resolve(resources.dispose()));
	if (lease) operations.push(Promise.resolve(lease.dispose()));
	const results = await Promise.allSettled(operations);
	const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (failures.length) throw new AggregateError(failures, 'Capture preview ownership did not release cleanly.');
}

export function normalizeCaptureDisplaySources(
	values: readonly Readonly<FramescaperCaptureDisplaySource>[],
): readonly Readonly<FramescaperCaptureDisplaySource>[] {
	if (!Array.isArray(values) || values.length > 64) {
		throw new RangeError('Capture display source inventory exceeds its bound.');
	}
	const tokens = new Set<string>();
	return Object.freeze(values.map((value) => {
		if (!value || typeof value.token !== 'string' || !value.token
			|| typeof value.name !== 'string' || !value.name
			|| (value.kind !== 'screen' && value.kind !== 'window')
			|| tokens.has(value.token)) {
			throw new TypeError('Capture display source inventory is invalid.');
		}
		tokens.add(value.token);
		return Object.freeze({ token: value.token, name: value.name, kind: value.kind });
	}));
}
