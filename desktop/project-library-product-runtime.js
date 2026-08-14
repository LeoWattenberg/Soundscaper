/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';

const START_FIELDS = Object.freeze([
	'productId', 'appDataPath', 'processId', 'instanceId', 'v9HostOptions', 'onLeaseLost',
]);
const BRIDGE_FIELDS = Object.freeze([
	'desktopRoot', 'handle', 'ownerFor', 'removeHandler', 'session',
]);
const V10_PRELOAD_BY_PRODUCT = Object.freeze({
	framescaper: 'project-library-v10-sandbox-preload.cjs',
	soundscaper: 'soundscaper-project-library-v10-sandbox-preload.cjs',
});

/** Selects exactly one main-owned library generation from the packaged product profile. */
export async function startDesktopProjectLibraryProductRuntime(value) {
	const options = closedRecord(value, START_FIELDS, 'desktop project-library product runtime');
	const productId = product(options.productId);
	const appDataPath = absolutePath(options.appDataPath, 'appData');
	const owner = Object.freeze({
		product: productId,
		processId: positiveSafeInteger(options.processId, 'process id'),
		instanceId: opaqueId(options.instanceId, 'instance id'),
	});
	if (!options.v9HostOptions || typeof options.v9HostOptions !== 'object'
		|| Array.isArray(options.v9HostOptions) || typeof options.onLeaseLost !== 'function') {
		throw new TypeError('Desktop project-library startup seams are invalid');
	}
	if (productId === 'framescaper') {
		const [{ createFramescaperDesktopProjectLibraryV10Handshake },
			{ FramescaperDesktopProjectLibraryV10Main },
			{ registerFramescaperDesktopProjectLibraryV10MainIpc }] = await Promise.all([
			import('./project-library-runtime/desktop/project-library-v10-contract.js'),
			import('./project-library-runtime/desktop/project-library-v10-main.js'),
			import('./project-library-runtime/desktop/project-library-v10-main-ipc.js'),
		]);
		const host = await FramescaperDesktopProjectLibraryV10Main.start({
			appDataPath,
			owner,
			handshake: createFramescaperDesktopProjectLibraryV10Handshake(),
		});
		return new DesktopProjectLibraryProductRuntime({
			productId,
			host,
			register: (bridge) => registerFramescaperDesktopProjectLibraryV10MainIpc({
				handle: bridge.handle,
				removeHandler: bridge.removeHandler,
				ownerFor: bridge.ownerFor,
				main: host,
			}),
			smokeEvidence: (projectId) => createV10SmokeEvidence(host, projectId, 'Framescaper'),
		});
	}
	if (productId === 'soundscaper') {
		const [{ createSoundscaperDesktopProjectLibraryV10Handshake },
			{ SoundscaperDesktopProjectLibraryV10Main },
			{ registerSoundscaperDesktopProjectLibraryV10MainIpc }] = await Promise.all([
			import('./project-library-runtime/desktop/soundscaper-project-library-v10-contract.js'),
			import('./project-library-runtime/desktop/soundscaper-project-library-v10-main.js'),
			import('./project-library-runtime/desktop/soundscaper-project-library-v10-main-ipc.js'),
		]);
		const host = await SoundscaperDesktopProjectLibraryV10Main.start({
			appDataPath,
			owner,
			handshake: createSoundscaperDesktopProjectLibraryV10Handshake(),
		});
		return new DesktopProjectLibraryProductRuntime({
			productId,
			host,
			register: (bridge) => registerSoundscaperDesktopProjectLibraryV10MainIpc({
				handle: bridge.handle,
				removeHandler: bridge.removeHandler,
				ownerFor: bridge.ownerFor,
				main: host,
			}),
			smokeEvidence: (projectId) => createV10SmokeEvidence(host, projectId, 'Soundscaper'),
		});
	}
	const [{ registerDesktopProjectLibraryIpc }, { createDesktopProjectLibrarySmokeEvidence },
		{ DesktopSharedProjectLibraryService }, { desktopSharedManagedSourceBindingKey },
		{ DesktopProjectLibraryHost }, { createDesktopLibraryMediaBinding }] = await Promise.all([
		import('./project-library-ipc.js'),
		import('./project-library-smoke-evidence.js'),
		import('./project-library-runtime/desktop/project-library-editor-service.js'),
		import('./project-library-runtime/desktop/project-library-editor-media-service.js'),
		import('./project-library-runtime/desktop/project-library-host.js'),
		import('./project-library-runtime/desktop/project-library-media-binding.js'),
	]);
	const host = await DesktopProjectLibraryHost.start({
		...options.v9HostOptions,
		appDataPath,
		owner,
		onLeaseLost: options.onLeaseLost,
	});
	const service = new DesktopSharedProjectLibraryService(host);
	return new DesktopProjectLibraryProductRuntime({
		productId,
		host,
		register: (bridge) => registerDesktopProjectLibraryIpc({
			handle: bridge.handle,
			ownerFor: bridge.ownerFor,
			service,
		}),
		smokeEvidence: (projectId) => createDesktopProjectLibrarySmokeEvidence(host, projectId, {
			createMediaBinding: createDesktopLibraryMediaBinding,
			sourceBindingKey: desktopSharedManagedSourceBindingKey,
		}),
	});
}

async function createV10SmokeEvidence(host, projectId, productName) {
	const session = host.openSession(host.localHandshake);
	let bundle = null;
	let readFailure = null;
	try { bundle = await session.readProjectBundle(projectId); }
	catch (error) { readFailure = error; }
	try { await session.close(); }
	catch (error) {
		if (readFailure) {
			throw new AggregateError(
				[readFailure, error],
				`${productName} V10 smoke readback cleanup failed`,
				{ cause: error },
			);
		}
		throw error;
	}
	if (readFailure) throw readFailure;
	if (!bundle) throw new Error(`${productName} V10 smoke project was not persisted by main`);
	const snapshot = host.snapshot();
	return Object.freeze({
		host: Object.freeze({
			product: snapshot.owner.product,
			closed: snapshot.closed,
			fenced: snapshot.fenced,
			activePublication: snapshot.activePublication,
		}),
		project: Object.freeze({
			projectId: bundle.project.projectId,
			title: bundle.project.name,
			projectSchemaVersion: bundle.project.projectSchemaVersion,
			projectRevision: bundle.project.projectRevision,
			metadataRevision: bundle.metadataRevision,
			byteLength: bundle.project.byteLength,
			sha256: bundle.project.sha256,
			bodyCount: bundle.bodies.length,
		}),
	});
}

class DesktopProjectLibraryProductRuntime {
	#bridge = null;
	#closePromise = null;
	#closed = false;
	#host;
	#productId;
	#register;
	#smokeEvidence;

	constructor({ productId, host, register, smokeEvidence }) {
		this.#productId = productId;
		this.#host = host;
		this.#register = register;
		this.#smokeEvidence = smokeEvidence;
	}

	snapshot() {
		return this.#host.snapshot();
	}

	smokeEvidence(projectId) {
		return this.#smokeEvidence(projectId);
	}

	registerRendererBridge(value) {
		if (this.#closed) throw new Error('Desktop project-library product runtime is closed');
		if (this.#bridge) throw new Error('Desktop project-library renderer bridge is already registered');
		const options = closedRecord(value, BRIDGE_FIELDS, 'desktop project-library renderer bridge');
		if (typeof options.handle !== 'function' || typeof options.ownerFor !== 'function'
			|| typeof options.removeHandler !== 'function') {
			throw new TypeError('Desktop project-library renderer bridge seams are invalid');
		}
		let preloadId = null;
		const preloadFile = V10_PRELOAD_BY_PRODUCT[this.#productId];
		if (preloadFile) {
			if (!options.session || typeof options.session.registerPreloadScript !== 'function'
				|| typeof options.session.unregisterPreloadScript !== 'function') {
				throw new TypeError(`${this.#productId} V10 requires an exact session preload owner`);
			}
			preloadId = options.session.registerPreloadScript({
				type: 'frame',
				filePath: resolve(absolutePath(options.desktopRoot, 'desktop root'), preloadFile),
			});
		}
		let registration;
		try {
			registration = this.#register(options);
		} catch (error) {
			if (preloadId !== null) options.session.unregisterPreloadScript(preloadId);
			throw error;
		}
		const bridge = new DesktopProjectLibraryRendererBridge(
			registration,
			preloadId === null ? null : { id: preloadId, session: options.session },
		);
		this.#bridge = bridge;
		return bridge;
	}

	close() {
		this.#closePromise ??= this.#close();
		return this.#closePromise;
	}

	async #close() {
		this.#closed = true;
		const failures = [];
		const bridge = this.#bridge;
		if (bridge) {
			try { await bridge.dispose(); } catch (error) { failures.push(error); }
		}
		try { await this.#host.close(); } catch (error) { failures.push(error); }
		throwFailures(failures, 'Desktop project-library product runtime shutdown failed');
	}
}

class DesktopProjectLibraryRendererBridge {
	#disposePromise = null;
	#preload;
	#registration;

	constructor(registration, preload) {
		this.#registration = registration;
		this.#preload = preload;
	}

	dispose() {
		this.#disposePromise ??= this.#dispose();
		return this.#disposePromise;
	}

	revokeOwner(owner) {
		return this.#registration.revokeOwner(owner);
	}

	async #dispose() {
		const failures = [];
		if (this.#preload) {
			try { this.#preload.session.unregisterPreloadScript(this.#preload.id); }
			catch (error) { failures.push(error); }
		}
		try { await this.#registration.dispose(); } catch (error) { failures.push(error); }
		throwFailures(failures, 'Desktop project-library renderer bridge cleanup failed');
	}
}

function throwFailures(failures, message) {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	throw new AggregateError(failures, message);
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields`);
	}
	const result = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function product(value) {
	if (value !== 'soundscaper' && value !== 'framescaper') {
		throw new TypeError('Desktop project-library product is unsupported');
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`Desktop project-library ${label} must be an absolute path`);
	}
	return resolve(value);
}

function positiveSafeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`Desktop project-library ${label} must be a positive safe integer`);
	}
	return value;
}

function opaqueId(value, label) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
		throw new TypeError(`Desktop project-library ${label} is invalid`);
	}
	return value;
}
