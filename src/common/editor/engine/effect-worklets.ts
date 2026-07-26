/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAudacityLiveEffect } from '../audacity-effects/live.js';
import { loadParametricEqWasmModule } from '../parametric-eq/wasm-loader.js';
import { isParametricEqType, projectEffectRacks } from './project-effects.ts';
import type { EngineProject } from './types.ts';

const dynamicsWorkletContexts = new WeakSet<BaseAudioContext>();
const delayWorkletContexts = new WeakSet<BaseAudioContext>();
const audacityWorkletContexts = new WeakSet<BaseAudioContext>();
const parametricEqWorkletContexts = new WeakSet<BaseAudioContext>();
const parametricEqWasmModules = new WeakMap<BaseAudioContext, WebAssembly.Module>();
const dynamicsWorkletLoads = new WeakMap<BaseAudioContext, Promise<void>>();
const delayWorkletLoads = new WeakMap<BaseAudioContext, Promise<void>>();
const audacityWorkletLoads = new WeakMap<BaseAudioContext, Promise<void>>();
const parametricEqWorkletLoads = new WeakMap<BaseAudioContext, Promise<void>>();

export function isDynamicsWorkletLoaded(context: BaseAudioContext): boolean {
	return dynamicsWorkletContexts.has(context);
}

export function isDelayWorkletLoaded(context: BaseAudioContext): boolean {
	return delayWorkletContexts.has(context);
}

export function isAudacityWorkletLoaded(context: BaseAudioContext): boolean {
	return audacityWorkletContexts.has(context);
}

export function isParametricEqWorkletLoaded(context: BaseAudioContext): boolean {
	return parametricEqWorkletContexts.has(context);
}

export function getParametricEqWasmModule(context: BaseAudioContext): WebAssembly.Module | undefined {
	return parametricEqWasmModules.get(context);
}

export async function ensureProjectWorklets(
	context: BaseAudioContext,
	project: EngineProject,
): Promise<void> {
	const needsDynamics = projectUsesDynamicsWorklet(project) && !dynamicsWorkletContexts.has(context);
	const needsDelay = projectUsesDelayWorklet(project) && !delayWorkletContexts.has(context);
	const needsAudacity = projectUsesAudacityWorklet(project) && !audacityWorkletContexts.has(context);
	const usesParametricEq = projectUsesParametricEqWorklet(project);
	const needsParametricEq = usesParametricEq && !parametricEqWorkletContexts.has(context);
	const needsParametricEqWasm = usesParametricEq && !parametricEqWasmModules.has(context);
	if (!needsDynamics && !needsDelay && !needsAudacity && !needsParametricEq && !needsParametricEqWasm) return;
	if (!context.audioWorklet?.addModule || typeof globalThis.AudioWorkletNode !== 'function') {
		if (needsAudacity) throw new Error('This browser cannot run Audacity real-time effects without bypassing them.');
		if (needsParametricEq || needsParametricEqWasm) throw new Error('This browser cannot run the parametric EQ without bypassing it.');
		if (needsDynamics) throw new Error('This browser cannot run the limiter or gate without bypassing it.');
		return;
	}
	const loads: Promise<unknown>[] = [];
	if (usesParametricEq) loads.push(ensureParametricEqWorklet(context));
	if (needsDynamics) {
		loads.push(addWorkletModuleOnce(
			context,
			dynamicsWorkletContexts,
			dynamicsWorkletLoads,
			() => new URL('../dynamics-worklet.js', import.meta.url),
		));
	}
	if (needsDelay) {
		// Delay has a native Web Audio fallback, so its optional load remains soft.
		loads.push(addWorkletModuleOnce(
			context,
			delayWorkletContexts,
			delayWorkletLoads,
			() => new URL('../delay-worklet.js', import.meta.url),
		).catch(() => undefined));
	}
	if (needsAudacity) {
		loads.push(addWorkletModuleOnce(
			context,
			audacityWorkletContexts,
			audacityWorkletLoads,
			audacityWorkletModuleUrl,
		));
	}
	await Promise.all(loads);
}

export async function ensureParametricEqWorklet(context: BaseAudioContext): Promise<WebAssembly.Module> {
	if (!context.audioWorklet?.addModule || typeof globalThis.AudioWorkletNode !== 'function') {
		throw new Error('This browser cannot run the parametric EQ without bypassing it.');
	}
	let module = parametricEqWasmModules.get(context);
	if (!(module instanceof WebAssembly.Module)) {
		module = await loadParametricEqWasmModule();
		if (!(module instanceof WebAssembly.Module)) {
			throw new Error('The parametric EQ WASM module could not be compiled.');
		}
		parametricEqWasmModules.set(context, module);
	}
	await addWorkletModuleOnce(
		context,
		parametricEqWorkletContexts,
		parametricEqWorkletLoads,
		parametricEqWorkletModuleUrl,
	);
	return module;
}

async function addWorkletModuleOnce(
	context: BaseAudioContext,
	loadedContexts: WeakSet<BaseAudioContext>,
	pendingLoads: WeakMap<BaseAudioContext, Promise<void>>,
	moduleUrl: () => URL | string | Promise<URL | string>,
): Promise<void> {
	if (loadedContexts.has(context)) return;
	let pending = pendingLoads.get(context);
	if (!pending) {
		pending = Promise.resolve()
			.then(moduleUrl)
			.then((url) => context.audioWorklet.addModule(String(url)))
			.then(() => { loadedContexts.add(context); });
		pendingLoads.set(context, pending);
	}
	try {
		await pending;
	} finally {
		if (pendingLoads.get(context) === pending) pendingLoads.delete(context);
	}
}

async function audacityWorkletModuleUrl(): Promise<URL | string> {
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		const module = await import('../audacity-effects/live-worklet.js?worker&url');
		return module.default;
	}
	return new URL('../audacity-effects/live-worklet.js', import.meta.url);
}

async function parametricEqWorkletModuleUrl(): Promise<URL | string> {
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		const module = await import('../parametric-eq/worklet.js?worker&url');
		return module.default;
	}
	return new URL('../parametric-eq/worklet.js', import.meta.url);
}

function projectUsesDynamicsWorklet(project: EngineProject): boolean {
	return projectUsesEffect(project, (type) => type === 'limiter' || type === 'gate');
}

function projectUsesDelayWorklet(project: EngineProject): boolean {
	return projectUsesEffect(project, (type) => type === 'delay');
}

function projectUsesAudacityWorklet(project: EngineProject): boolean {
	return projectUsesEffect(project, (type) => isAudacityLiveEffect(type));
}

function projectUsesParametricEqWorklet(project: EngineProject): boolean {
	return projectUsesEffect(project, isParametricEqType);
}

function projectUsesEffect(project: EngineProject, predicate: (type: string) => boolean): boolean {
	for (const rack of projectEffectRacks(project)) {
		if (rack.effects.some((effect) => (
			effect?.enabled !== false
			&& effect?.bypassed !== true
			&& predicate(String(effect?.type || '').toLowerCase())
		))) return true;
	}
	return false;
}
