/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import { createAudioEditorFileService } from '../../common/editor/file-service.js';
import { resolveCatalog } from '../../common/i18n/runtime.js';
import { createFramescaperAudioEditorControllerV19 } from '../editor-controller-v19.ts';
import {
	createFramescaperEditorProjectEnvironmentV19,
	type FramescaperEditorProjectEnvironmentV19,
} from '../editor-project-environment-v19.ts';

const BoundAudioEditorApp = lazy(async () => {
	const module = await import('../../common/editor/ui/AudioEditorApp.jsx');
	return { default: module.BoundAudioEditorApp };
});

type FramescaperWebControllerV19 = ReturnType<typeof createFramescaperAudioEditorControllerV19>;
type FramescaperWebFileServiceV19 = ReturnType<typeof createAudioEditorFileService>;
type FramescaperProjectRuntimeProjectionV19 =
	FramescaperEditorProjectEnvironmentV19['runtime']['projectForRuntimeConsumers'];

const RUNTIME_PROJECTORS = new WeakMap<object, FramescaperProjectRuntimeProjectionV19>();

export interface FramescaperWebEditorRuntimePresentationV19 {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
}

export interface FramescaperWebEditorRuntimeV19 {
	readonly controller: FramescaperWebControllerV19;
	readonly fileService: FramescaperWebFileServiceV19;
	readonly dispose: () => Promise<void>;
}

export interface FramescaperAudioEditorBootstrapV19Props {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
}

const PRESENTATION_FIELDS = ['locale', 'copy'] as const;

/**
 * The reachable V19 browser selector. Callers provide presentation only; this
 * product owner constructs the isolated project, storage, and controller
 * authority behind the route.
 */
export async function createFramescaperWebEditorRuntimeV19(
	presentationValue: FramescaperWebEditorRuntimePresentationV19 | unknown,
): Promise<Readonly<FramescaperWebEditorRuntimeV19>> {
	const presentation = snapshotPresentation(presentationValue);
	const environment = await createFramescaperEditorProjectEnvironmentV19();
	try {
		const fileService = createAudioEditorFileService();
		const controller = createFramescaperAudioEditorControllerV19(environment, {
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
		RUNTIME_PROJECTORS.set(runtime, environment.runtime.projectForRuntimeConsumers);
		return runtime;
	} catch (error) {
		try {
			await environment.close();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Framescaper V19 web runtime construction and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

/** Product route adapter; it adds no product control or default-visible UI. */
export default function FramescaperAudioEditorBootstrapV19({
	locale,
	fallbackCopy: fallbackCopyValue,
}: FramescaperAudioEditorBootstrapV19Props) {
	const fallbackCopy = useMemo(() => framescaperCopy(snapshotCopy(
		fallbackCopyValue,
		'Framescaper fallback copy',
	)), [fallbackCopyValue]);
	const [copy, setCopy] = useState<Readonly<Record<string, unknown>> | null>(
		() => locale === 'en' ? fallbackCopy : null,
	);
	const [runtime, setRuntime] = useState<Readonly<FramescaperWebEditorRuntimeV19> | null>(null);
	const [failure, setFailure] = useState<unknown>(null);

	useEffect(() => {
		if (copy) return undefined;
		const controller = new AbortController();
		void Promise.resolve(resolveCatalog(locale, { signal: controller.signal }))
			.then((resolvedCopy: unknown) => {
				if (!controller.signal.aborted) {
					setCopy(framescaperCopy(snapshotCopy(resolvedCopy, 'Framescaper localized copy')));
				}
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) setFailure(error);
			});
		return () => { controller.abort(); };
	}, [copy, locale]);

	useEffect(() => {
		if (!copy) return undefined;
		let active = true;
		let ownedRuntime: Readonly<FramescaperWebEditorRuntimeV19> | null = null;
		setFailure(null);
		void createFramescaperWebEditorRuntimeV19({ locale, copy }).then(
			(candidate) => {
				if (!active) {
					void candidate.dispose();
					return;
				}
				ownedRuntime = candidate;
				setRuntime(candidate);
			},
			(error: unknown) => { if (active) setFailure(error); },
		);
		return () => {
			active = false;
			if (ownedRuntime) void ownedRuntime.dispose();
		};
	}, [copy, locale]);

	if (failure) {
		const message = failure instanceof Error ? failure.message : String(failure);
		return <div role="alert">{copyText(fallbackCopy, 'genericError', 'Framescaper failed: {message}')
			.replace('{message}', message)}</div>;
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
			crossProductHandoffAvailable={false}
		/>
	</Suspense>;
}

function runtimeProjector(
	runtime: Readonly<FramescaperWebEditorRuntimeV19>,
): FramescaperProjectRuntimeProjectionV19 {
	const projector = RUNTIME_PROJECTORS.get(runtime);
	if (!projector) throw new TypeError('An exact Framescaper V19 web runtime is required.');
	return projector;
}

async function disposeRuntime(
	controller: FramescaperWebControllerV19,
	environment: Readonly<FramescaperEditorProjectEnvironmentV19>,
): Promise<void> {
	let failure: unknown;
	try {
		await controller.dispose();
	} catch (error) {
		failure = error;
	}
	try {
		await environment.close();
	} catch (error) {
		if (failure) {
			throw new AggregateError(
				[failure, error],
				'Framescaper V19 controller and environment disposal both failed.',
				{ cause: failure },
			);
		}
		throw error;
	}
	if (failure) throw failure;
}

function snapshotPresentation(value: unknown): FramescaperWebEditorRuntimePresentationV19 {
	const record = closedRecord(value, PRESENTATION_FIELDS, 'Framescaper V19 web presentation');
	const locale = record.locale;
	if (typeof locale !== 'string' || !locale.trim() || locale.length > 128) {
		throw new TypeError('The Framescaper V19 web locale must be a bounded string.');
	}
	return Object.freeze({
		locale,
		copy: snapshotCopy(record.copy, 'Framescaper V19 web copy'),
	});
}

function framescaperCopy(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...value,
		title: copyText(value, 'framescaperTitle', copyText(value, 'title', 'Framescaper')),
		eyebrow: copyText(value, 'framescaperEyebrow', copyText(value, 'eyebrow', 'Framescaper')),
		intro: copyText(value, 'framescaperIntro', copyText(value, 'intro', '')),
		metaDescription: copyText(
			value,
			'framescaperMetaDescription',
			copyText(value, 'metaDescription', ''),
		),
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
			throw new TypeError(`${label}.${key} must be an own enumerable data property.`);
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
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(record, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property.`);
		}
	}
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
