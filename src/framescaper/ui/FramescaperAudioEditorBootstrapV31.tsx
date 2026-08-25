/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useEffect, useMemo, useState } from 'react';

import { createAudioEditorFileService } from '../../common/editor/file-service.js';
import { BoundAudioEditorApp } from '../../common/editor/ui/AudioEditorApp.jsx';
import { resolveCatalog } from '../../common/i18n/runtime.js';
import { createFramescaperAudioEditorControllerV31 } from '../editor-controller-v31.ts';
import {
	createFramescaperEditorProjectEnvironmentV31,
	type FramescaperEditorProjectEnvironmentV31,
} from '../editor-project-environment-v31.ts';

type WebController = ReturnType<typeof createFramescaperAudioEditorControllerV31>;
type WebFileService = ReturnType<typeof createAudioEditorFileService>;
type RuntimeProjection = FramescaperEditorProjectEnvironmentV31['runtime']['projectForRuntimeConsumers'];
const PROJECTORS = new WeakMap<object, RuntimeProjection>();
const PRESENTATION_FIELDS = ['locale', 'copy'] as const;

export interface FramescaperWebEditorRuntimePresentationV31 {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
}

export interface FramescaperWebEditorRuntimeV31 {
	readonly controller: WebController;
	readonly fileService: WebFileService;
	readonly dispose: () => Promise<void>;
}

export interface FramescaperAudioEditorBootstrapV31Props {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
}

/** Construct the prepared exact-F31 web presentation without selecting it in App. */
export async function createFramescaperWebEditorRuntimeV31(
	presentationValue: FramescaperWebEditorRuntimePresentationV31 | unknown,
): Promise<Readonly<FramescaperWebEditorRuntimeV31>> {
	const presentation = snapshotPresentation(presentationValue);
	const fileService = createAudioEditorFileService();
	const environment = await createFramescaperEditorProjectEnvironmentV31({
		storeOptions: {
			linkedOriginalPort: fileService.linkedOriginalPort,
			linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
		},
	});
	try {
		const controller = createFramescaperAudioEditorControllerV31(environment, {
			locale: presentation.locale,
			copy: presentation.copy,
			fileService,
		});
		let disposal: Promise<void> | null = null;
		const dispose = (): Promise<void> => {
			disposal ??= disposeRuntime(controller, environment);
			return disposal;
		};
		const runtime = Object.freeze({ controller, fileService, dispose });
		PROJECTORS.set(runtime, environment.runtime.projectForRuntimeConsumers);
		return runtime;
	} catch (error) {
		try {
			await environment.close();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Framescaper F31 runtime construction and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export default function FramescaperAudioEditorBootstrapV31({
	locale,
	fallbackCopy: fallbackCopyValue,
}: FramescaperAudioEditorBootstrapV31Props) {
	const fallbackCopy = useMemo(() => framescaperCopy(snapshotCopy(
		fallbackCopyValue,
		'Framescaper fallback copy',
	)), [fallbackCopyValue]);
	const [copy, setCopy] = useState<Readonly<Record<string, unknown>> | null>(
		() => locale === 'en' ? fallbackCopy : null,
	);
	const [runtime, setRuntime] = useState<Readonly<FramescaperWebEditorRuntimeV31> | null>(null);
	const [failure, setFailure] = useState<unknown>(null);

	useEffect(() => {
		if (copy) return undefined;
		const controller = new AbortController();
		void Promise.resolve(resolveCatalog(locale, { signal: controller.signal })).then(
			(resolved: unknown) => {
				if (!controller.signal.aborted) {
					setCopy(framescaperCopy(snapshotCopy(resolved, 'Framescaper localized copy')));
				}
			},
			(error: unknown) => { if (!controller.signal.aborted) setFailure(error); },
		);
		return () => { controller.abort(); };
	}, [copy, locale]);

	useEffect(() => {
		if (!copy) return undefined;
		let active = true;
		let owned: Readonly<FramescaperWebEditorRuntimeV31> | null = null;
		setFailure(null);
		void createFramescaperWebEditorRuntimeV31({ locale, copy }).then(
			(candidate) => {
				if (!active) { void candidate.dispose(); return; }
				owned = candidate;
				setRuntime(candidate);
			},
			(error: unknown) => { if (active) setFailure(error); },
		);
		return () => {
			active = false;
			if (owned) void owned.dispose();
		};
	}, [copy, locale]);

	if (failure) {
		const message = failure instanceof Error ? failure.message : String(failure);
		return <div role="alert">{
			copyText(fallbackCopy, 'genericError', 'Framescaper failed: {message}')
				.replace('{message}', message)
		}</div>;
	}
	if (!copy || !runtime) {
		return <div role="status" aria-live="polite">{
			copyText(copy ?? fallbackCopy, 'loading', 'Loading project')
		}</div>;
	}
	return <Suspense fallback={<div role="status" aria-live="polite">{
		copyText(copy, 'loading', 'Loading project')
	}</div>}>
		<BoundAudioEditorApp
			locale={locale}
			copy={copy}
			productId="framescaper"
			controller={runtime.controller}
			fileService={runtime.fileService}
			projectForRuntimeConsumers={runtimeProjector(runtime)}
			crossProductHandoffAvailable={runtime.fileService.isDesktop}
		/>
	</Suspense>;
}

function runtimeProjector(runtime: Readonly<FramescaperWebEditorRuntimeV31>): RuntimeProjection {
	const projector = PROJECTORS.get(runtime);
	if (!projector) throw new TypeError('An exact Framescaper F31 web runtime is required.');
	return projector;
}

async function disposeRuntime(
	controller: WebController,
	environment: Readonly<FramescaperEditorProjectEnvironmentV31>,
): Promise<void> {
	let failure: unknown;
	try { await controller.dispose(); } catch (error) { failure = error; }
	try { await environment.close(); } catch (error) {
		if (failure) throw new AggregateError([failure, error], 'F31 controller and environment disposal failed.');
		throw error;
	}
	if (failure) throw failure;
}

function snapshotPresentation(value: unknown): FramescaperWebEditorRuntimePresentationV31 {
	const record = closedRecord(value, PRESENTATION_FIELDS, 'Framescaper F31 web presentation');
	if (typeof record.locale !== 'string' || !record.locale.trim() || record.locale.length > 128) {
		throw new TypeError('The Framescaper F31 locale must be a bounded string.');
	}
	return Object.freeze({
		locale: record.locale,
		copy: snapshotCopy(record.copy, 'Framescaper F31 web copy'),
	});
}

function framescaperCopy(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...value,
		title: copyText(value, 'framescaperTitle', copyText(value, 'title', 'Framescaper')),
		eyebrow: copyText(value, 'framescaperEyebrow', copyText(value, 'eyebrow', 'Framescaper')),
		intro: copyText(value, 'framescaperIntro', copyText(value, 'intro', '')),
		metaDescription: copyText(value, 'framescaperMetaDescription', copyText(value, 'metaDescription', '')),
	});
}

function snapshotCopy(value: unknown, label: string): Readonly<Record<string, unknown>> {
	const record = plainRecord(value, label);
	const keys = Reflect.ownKeys(record);
	if (keys.length > 4_096 || keys.some((key) => typeof key !== 'string')) {
		throw new RangeError(`${label} has an invalid field inventory.`);
	}
	const output: Record<string, unknown> = Object.create(null);
	for (const key of keys as string[]) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	return Object.freeze(output);
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	const record = plainRecord(value, label);
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} has unsupported fields.`);
	return record as Readonly<Record<Field, unknown>>;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function copyText(value: Readonly<Record<string, unknown>>, field: string, fallback: string): string {
	return typeof value[field] === 'string' ? value[field] : fallback;
}
