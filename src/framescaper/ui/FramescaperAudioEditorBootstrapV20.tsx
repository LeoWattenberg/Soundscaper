/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useEffect, useMemo, useState } from 'react';

import { createAudioEditorFileService } from '../../common/editor/file-service.js';
import { resolveCatalog } from '../../common/i18n/runtime.js';
import { BoundAudioEditorApp } from '../../common/editor/ui/AudioEditorApp.jsx';
import { resolveFramescaperNativeServicesBridge } from '../../common/editor/ui/framescaper-native-services-bridge.ts';
import { createFramescaperAudioEditorControllerV20 } from '../editor-controller-v20.ts';
import {
	createFramescaperNativeWatchImportClientV20,
	type FramescaperNativeWatchImportClientV20,
} from '../editor-native-watch-import-client-v20.ts';
import {
	createFramescaperEditorProjectEnvironmentV20,
	type FramescaperEditorProjectEnvironmentV20,
} from '../editor-project-environment-v20.ts';

type FramescaperWebControllerV20 = ReturnType<typeof createFramescaperAudioEditorControllerV20>;
type FramescaperWebFileServiceV20 = ReturnType<typeof createAudioEditorFileService>;
type FramescaperProjectRuntimeProjectionV20 =
	FramescaperEditorProjectEnvironmentV20['runtime']['projectForRuntimeConsumers'];

const RUNTIME_PROJECTORS = new WeakMap<object, FramescaperProjectRuntimeProjectionV20>();
const PRESENTATION_FIELDS = ['locale', 'copy'] as const;

export interface FramescaperWebEditorRuntimePresentationV20 {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
}

export interface FramescaperWebEditorRuntimeV20 {
	readonly controller: FramescaperWebControllerV20;
	readonly fileService: FramescaperWebFileServiceV20;
	readonly dispose: () => Promise<void>;
}

export interface FramescaperAudioEditorBootstrapV20Props {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, unknown>>;
}

/** Construct the selected exact-V20 web presentation. */
export async function createFramescaperWebEditorRuntimeV20(
	presentationValue: FramescaperWebEditorRuntimePresentationV20 | unknown,
): Promise<Readonly<FramescaperWebEditorRuntimeV20>> {
	const presentation = snapshotPresentation(presentationValue);
	const fileService = createAudioEditorFileService();
	const environment = await createFramescaperEditorProjectEnvironmentV20({
		storeOptions: {
			linkedOriginalPort: fileService.linkedOriginalPort,
			linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
		},
	});
	try {
		const controller = createFramescaperAudioEditorControllerV20(environment, {
			locale: presentation.locale,
			copy: presentation.copy,
			fileService,
		});
		const watchImports = createFramescaperNativeWatchImportClientV20({
			controller,
			linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
			bridge: resolveFramescaperNativeServicesBridge(),
		});
		let disposal: Promise<void> | null = null;
		const dispose = (): Promise<void> => {
			disposal ??= disposeRuntime(controller, environment, watchImports);
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
				'Framescaper V20 web runtime construction and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

/** Selected product route adapter; provisional qualification remains explicit in policy. */
export default function FramescaperAudioEditorBootstrapV20({
	locale,
	fallbackCopy: fallbackCopyValue,
}: FramescaperAudioEditorBootstrapV20Props) {
	const fallbackCopy = useMemo(() => framescaperCopy(snapshotCopy(
		fallbackCopyValue,
		'Framescaper fallback copy',
	)), [fallbackCopyValue]);
	const [copy, setCopy] = useState<Readonly<Record<string, unknown>> | null>(
		() => locale === 'en' ? fallbackCopy : null,
	);
	const [runtime, setRuntime] = useState<Readonly<FramescaperWebEditorRuntimeV20> | null>(null);
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
		let ownedRuntime: Readonly<FramescaperWebEditorRuntimeV20> | null = null;
		setFailure(null);
		void createFramescaperWebEditorRuntimeV20({ locale, copy }).then(
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
			crossProductHandoffAvailable={runtime.fileService.isDesktop}
		/>
	</Suspense>;
}

function runtimeProjector(
	runtime: Readonly<FramescaperWebEditorRuntimeV20>,
): FramescaperProjectRuntimeProjectionV20 {
	const projector = RUNTIME_PROJECTORS.get(runtime);
	if (!projector) throw new TypeError('An exact Framescaper V20 web runtime is required.');
	return projector;
}

async function disposeRuntime(
	controller: FramescaperWebControllerV20,
	environment: Readonly<FramescaperEditorProjectEnvironmentV20>,
	watchImports: Readonly<FramescaperNativeWatchImportClientV20>,
): Promise<void> {
	let failure: unknown;
	try {
		await watchImports.dispose();
	} catch (error) {
		failure = error;
	}
	try {
		await controller.dispose();
	} catch (error) {
		failure = failure ? new AggregateError([failure, error], 'Framescaper V20 watch and controller disposal failed.') : error;
	}
	try {
		await environment.close();
	} catch (error) {
		if (failure) {
			throw new AggregateError(
				[failure, error],
				'Framescaper V20 controller and environment disposal both failed.',
				{ cause: failure },
			);
		}
		throw error;
	}
	if (failure) throw failure;
}

function snapshotPresentation(value: unknown): FramescaperWebEditorRuntimePresentationV20 {
	const record = closedRecord(value, PRESENTATION_FIELDS, 'Framescaper V20 web presentation');
	const locale = record.locale;
	if (typeof locale !== 'string' || !locale.trim() || locale.length > 128) {
		throw new TypeError('The Framescaper V20 web locale must be a bounded string.');
	}
	return Object.freeze({
		locale,
		copy: snapshotCopy(record.copy, 'Framescaper V20 web copy'),
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
