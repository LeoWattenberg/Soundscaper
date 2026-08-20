/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_CAPTURE_DESKTOP_SOURCE_LIMIT = 64;
export const FRAMESCAPER_CAPTURE_DESKTOP_SOURCE_LIST_TTL_MS = 300_000;
export const FRAMESCAPER_CAPTURE_DESKTOP_GRANT_TTL_MS = 15_000;

const CAPTURE_ROLES = ['camera', 'microphone', 'display', 'system-audio'] as const;
const DESKTOP_PLATFORMS = ['darwin', 'linux', 'win32'] as const;
const OPAQUE_ID = /^[a-f0-9]{32}$/u;

export type FramescaperCaptureDesktopRole = typeof CAPTURE_ROLES[number];
export type FramescaperCaptureDesktopSelectionMode = 'source-list' | 'system-picker' | 'unavailable';
export type FramescaperCaptureDesktopSystemAudio = 'windows-loopback' | 'unavailable';
export type FramescaperCaptureDesktopUnavailableReason =
	| 'unsupported-platform'
	| 'unsupported-product';

export interface FramescaperCaptureDesktopStatusV1 {
	readonly version: 1;
	readonly available: boolean;
	readonly unavailableReason: FramescaperCaptureDesktopUnavailableReason | null;
	readonly selectionMode: FramescaperCaptureDesktopSelectionMode;
	readonly systemAudio: FramescaperCaptureDesktopSystemAudio;
	readonly sourceLimit: number;
	readonly sourceListTtlMs: number;
	readonly grantTtlMs: number;
}

export interface FramescaperCaptureDesktopSourceV1 {
	readonly token: string;
	readonly name: string;
	readonly kind: 'screen' | 'window';
}

export interface FramescaperCaptureDesktopSourceListV1 {
	readonly generation: number;
	readonly selectionMode: 'source-list';
	readonly expiresAtMs: number;
	readonly sources: readonly Readonly<FramescaperCaptureDesktopSourceV1>[];
}

export interface FramescaperCaptureDesktopGrantRequestV1 {
	readonly generation: number;
	readonly roles: readonly FramescaperCaptureDesktopRole[];
	readonly sourceToken: string | null;
}

export interface FramescaperCaptureDesktopGrantV1 {
	readonly grantId: string;
	readonly generation: number;
	readonly expiresAtMs: number;
	readonly roles: readonly FramescaperCaptureDesktopRole[];
}

export interface FramescaperCaptureDesktopDisplayRequest {
	readonly userGesture: boolean;
	readonly videoRequested: boolean;
	readonly audioRequested: boolean;
}

export interface FramescaperCaptureDesktopGrantedStreams {
	readonly video: Readonly<{ readonly id: string; readonly name: string }>;
	readonly audio?: 'loopback';
}

export interface FramescaperCaptureDesktopPortDependencies {
	readonly productId: string;
	readonly platform: string;
	readonly systemVersion: string;
	readonly now: () => number;
	readonly createOpaqueId: () => string;
	readonly listDesktopSources: () => Promise<readonly unknown[]>;
}

export interface FramescaperCaptureDesktopPortV1 {
	status(): Readonly<FramescaperCaptureDesktopStatusV1>;
	listSources(owner: object, generation: number): Promise<Readonly<FramescaperCaptureDesktopSourceListV1>>;
	grant(owner: object, request: unknown): Readonly<FramescaperCaptureDesktopGrantV1>;
	allowsMedia(owner: object, mediaTypes: readonly string[]): boolean;
	allowsDisplayPermission(owner: object): boolean;
	consumeSystemPickerGrant(owner: object): boolean;
	consumeDisplayGrant(
		owner: object,
		request: Readonly<FramescaperCaptureDesktopDisplayRequest>,
	): Readonly<FramescaperCaptureDesktopGrantedStreams> | null;
	teardown(owner: object, generation: number): boolean;
	revokeOwner(owner: object): boolean;
	dispose(): void;
}

interface SourceAuthority {
	readonly token: string;
	readonly publicSource: Readonly<FramescaperCaptureDesktopSourceV1>;
	readonly nativeSource: Readonly<{ readonly id: string; readonly name: string }>;
}

interface SourceInventory {
	readonly generation: number;
	readonly expiresAtMs: number;
	readonly sources: ReadonlyMap<string, Readonly<SourceAuthority>>;
}

interface CaptureGrant {
	readonly grantId: string;
	readonly generation: number;
	readonly expiresAtMs: number;
	readonly roles: readonly FramescaperCaptureDesktopRole[];
	readonly nativeSource: Readonly<{ readonly id: string; readonly name: string }> | null;
	displayConsumed: boolean;
}

interface OwnerState {
	generation: number;
	inventory: Readonly<SourceInventory> | null;
	grant: CaptureGrant | null;
}

/**
 * Main-owned control plane for capture consent. No method accepts or returns
 * media bytes, native source IDs, filesystem paths, or Electron objects.
 */
export function createFramescaperCaptureDesktopPortV1(
	value: FramescaperCaptureDesktopPortDependencies,
): FramescaperCaptureDesktopPortV1 {
	const dependencies = validateDependencies(value);
	const platformStatus = createStatus(dependencies);
	const owners = new Map<object, OwnerState>();
	let disposed = false;

	function status(): Readonly<FramescaperCaptureDesktopStatusV1> {
		return platformStatus;
	}

	async function listSources(
		ownerValue: object,
		generationValue: number,
	): Promise<Readonly<FramescaperCaptureDesktopSourceListV1>> {
		assertOperational();
		assertAvailable();
		if (platformStatus.selectionMode !== 'source-list') {
			throw new Error('Framescaper desktop source listing is unavailable with the system picker.');
		}
		const owner = reference(ownerValue, 'capture owner');
		const generation = positiveGeneration(generationValue);
		const state = ownerState(owner);
		if (generation <= state.generation) {
			throw new Error('Capture source listing requires a newer generation.');
		}
		state.generation = generation;
		state.inventory = null;
		state.grant = null;
		const nativeSources = await dependencies.listDesktopSources();
		assertOperational();
		if (owners.get(owner) !== state || state.generation !== generation) {
			throw new Error('Capture source listing completed for a stale generation.');
		}
		const expiresAtMs = expiry(dependencies.now(), FRAMESCAPER_CAPTURE_DESKTOP_SOURCE_LIST_TTL_MS);
		const sources = createSourceAuthorities(nativeSources, dependencies.createOpaqueId);
		state.inventory = Object.freeze({ generation, expiresAtMs, sources });
		return Object.freeze({
			generation,
			selectionMode: 'source-list',
			expiresAtMs,
			sources: Object.freeze([...sources.values()].map(({ publicSource }) => publicSource)),
		});
	}

	function grant(
		ownerValue: object,
		requestValue: unknown,
	): Readonly<FramescaperCaptureDesktopGrantV1> {
		assertOperational();
		assertAvailable();
		const owner = reference(ownerValue, 'capture owner');
		const request = validateGrantRequest(requestValue);
		const state = ownerState(owner);
		const needsDisplay = request.roles.includes('display');
		if (request.roles.includes('system-audio') && platformStatus.systemAudio !== 'windows-loopback') {
			throw new Error('Framescaper desktop system audio is unavailable on this platform.');
		}
		let nativeSource: Readonly<{ readonly id: string; readonly name: string }> | null = null;
		if (needsDisplay && platformStatus.selectionMode === 'source-list') {
			const inventory = currentInventory(state, dependencies.now());
			if (!inventory || inventory.generation !== request.generation) {
				throw new Error('Capture display grant source inventory generation is stale or consumed.');
			}
			if (request.sourceToken === null) throw new TypeError('Capture display grant requires a source token.');
			const authority = inventory.sources.get(request.sourceToken);
			if (!authority) throw new Error('Capture display source token is stale or consumed.');
			nativeSource = authority.nativeSource;
		} else {
			if (request.sourceToken !== null) {
				throw new TypeError('Capture grant does not accept a source token for this selection mode.');
			}
			if (request.generation <= state.generation) {
				throw new Error('Capture grant requires a newer generation.');
			}
			state.generation = request.generation;
		}
		state.inventory = null;
		const expiresAtMs = expiry(dependencies.now(), FRAMESCAPER_CAPTURE_DESKTOP_GRANT_TTL_MS);
		const captureGrant: CaptureGrant = {
			grantId: opaqueId(dependencies.createOpaqueId()),
			generation: request.generation,
			expiresAtMs,
			roles: request.roles,
			nativeSource,
			displayConsumed: false,
		};
		state.generation = request.generation;
		state.grant = captureGrant;
		return Object.freeze({
			grantId: captureGrant.grantId,
			generation: captureGrant.generation,
			expiresAtMs,
			roles: captureGrant.roles,
		});
	}

	function allowsMedia(ownerValue: object, mediaTypesValue: readonly string[]): boolean {
		if (disposed || !platformStatus.available) return false;
		const owner = optionalReference(ownerValue);
		if (!owner || !Array.isArray(mediaTypesValue) || mediaTypesValue.length === 0) return false;
		const mediaTypes = new Set(mediaTypesValue);
		if (mediaTypes.size !== mediaTypesValue.length
			|| [...mediaTypes].some((type) => type !== 'audio' && type !== 'video')) return false;
		const captureGrant = currentGrant(owner, dependencies.now());
		if (!captureGrant) return false;
		return (!mediaTypes.has('video') || captureGrant.roles.includes('camera'))
			&& (!mediaTypes.has('audio') || captureGrant.roles.includes('microphone'));
	}

	function allowsDisplayPermission(ownerValue: object): boolean {
		if (disposed || !platformStatus.available) return false;
		const owner = optionalReference(ownerValue);
		if (!owner) return false;
		const captureGrant = currentGrant(owner, dependencies.now());
		return Boolean(captureGrant?.roles.includes('display') && !captureGrant.displayConsumed);
	}

	function consumeSystemPickerGrant(ownerValue: object): boolean {
		if (disposed || platformStatus.selectionMode !== 'system-picker') return false;
		const owner = optionalReference(ownerValue);
		if (!owner) return false;
		const captureGrant = currentGrant(owner, dependencies.now());
		if (!captureGrant || captureGrant.displayConsumed || !captureGrant.roles.includes('display')) return false;
		captureGrant.displayConsumed = true;
		return true;
	}

	function consumeDisplayGrant(
		ownerValue: object,
		request: Readonly<FramescaperCaptureDesktopDisplayRequest>,
	): Readonly<FramescaperCaptureDesktopGrantedStreams> | null {
		if (!request || request.userGesture !== true || request.videoRequested !== true) return null;
		const owner = optionalReference(ownerValue);
		if (!owner) return null;
		const captureGrant = currentGrant(owner, dependencies.now());
		if (!captureGrant || captureGrant.displayConsumed || !captureGrant.roles.includes('display')) return null;
		if (platformStatus.selectionMode !== 'source-list' || !captureGrant.nativeSource) return null;
		captureGrant.displayConsumed = true;
		const video = captureGrant.nativeSource;
		return Object.freeze({
			video,
			...(request.audioRequested && captureGrant.roles.includes('system-audio')
				&& platformStatus.systemAudio === 'windows-loopback' ? { audio: 'loopback' as const } : {}),
		});
	}

	function teardown(ownerValue: object, generationValue: number): boolean {
		const owner = reference(ownerValue, 'capture owner');
		const generation = positiveGeneration(generationValue);
		const state = owners.get(owner);
		if (!state) return false;
		retireExpired(owner, state, dependencies.now());
		const current = owners.get(owner);
		if (!current || current.generation !== generation) return false;
		owners.delete(owner);
		return true;
	}

	function revokeOwner(ownerValue: object): boolean {
		return owners.delete(reference(ownerValue, 'capture owner'));
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		owners.clear();
	}

	function ownerState(owner: object): OwnerState {
		const current = owners.get(owner);
		if (current) {
			retireExpired(owner, current, dependencies.now());
			const retained = owners.get(owner);
			if (retained) return retained;
		}
		const created: OwnerState = { generation: 0, inventory: null, grant: null };
		owners.set(owner, created);
		return created;
	}

	function assertOperational(): void {
		if (disposed) throw new Error('Framescaper desktop capture port is disposed.');
	}

	function assertAvailable(): void {
		if (!platformStatus.available) throw new Error('Framescaper desktop capture is unavailable.');
	}

	return Object.freeze({
		status,
		listSources,
		grant,
		allowsMedia,
		allowsDisplayPermission,
		consumeSystemPickerGrant,
		consumeDisplayGrant,
		teardown,
		revokeOwner,
		dispose,
	});

	function currentInventory(state: OwnerState, nowMs: number): Readonly<SourceInventory> | null {
		if (state.inventory && nowMs <= state.inventory.expiresAtMs) return state.inventory;
		state.inventory = null;
		return null;
	}

	function currentGrant(owner: object, nowMs: number): CaptureGrant | null {
		const state = owners.get(owner);
		if (!state) return null;
		retireExpired(owner, state, nowMs);
		return owners.get(owner)?.grant ?? null;
	}

	function retireExpired(owner: object, state: OwnerState, nowMs: number): void {
		if (state.inventory && nowMs > state.inventory.expiresAtMs) state.inventory = null;
		if (state.grant && nowMs > state.grant.expiresAtMs) state.grant = null;
		if (!state.inventory && !state.grant && state.generation > 0) owners.delete(owner);
	}
}

function validateDependencies(
	value: FramescaperCaptureDesktopPortDependencies,
): FramescaperCaptureDesktopPortDependencies {
	if (!value || typeof value !== 'object' || typeof value.productId !== 'string'
		|| typeof value.platform !== 'string' || typeof value.systemVersion !== 'string'
		|| typeof value.now !== 'function' || typeof value.createOpaqueId !== 'function'
		|| typeof value.listDesktopSources !== 'function') {
		throw new TypeError('Framescaper desktop capture port dependencies are invalid.');
	}
	return value;
}

function createStatus(
	dependencies: FramescaperCaptureDesktopPortDependencies,
): Readonly<FramescaperCaptureDesktopStatusV1> {
	const unavailableReason = dependencies.productId !== 'framescaper'
		? 'unsupported-product' as const
		: !DESKTOP_PLATFORMS.includes(dependencies.platform as typeof DESKTOP_PLATFORMS[number])
			? 'unsupported-platform' as const
			: null;
	const available = unavailableReason === null;
	const systemPicker = available && dependencies.platform === 'darwin'
		&& systemVersionMajor(dependencies.systemVersion) >= 15;
	return Object.freeze({
		version: 1,
		available,
		unavailableReason,
		selectionMode: !available ? 'unavailable' : systemPicker ? 'system-picker' : 'source-list',
		systemAudio: available && dependencies.platform === 'win32'
			? 'windows-loopback'
			: 'unavailable',
		sourceLimit: FRAMESCAPER_CAPTURE_DESKTOP_SOURCE_LIMIT,
		sourceListTtlMs: FRAMESCAPER_CAPTURE_DESKTOP_SOURCE_LIST_TTL_MS,
		grantTtlMs: FRAMESCAPER_CAPTURE_DESKTOP_GRANT_TTL_MS,
	});
}

function createSourceAuthorities(
	value: readonly unknown[],
	createOpaqueId: () => string,
): ReadonlyMap<string, Readonly<SourceAuthority>> {
	if (!Array.isArray(value)) throw new TypeError('Desktop capture source inventory must be an array.');
	const sources = new Map<string, Readonly<SourceAuthority>>();
	const nativeIds = new Set<string>();
	for (const candidate of value.slice(0, FRAMESCAPER_CAPTURE_DESKTOP_SOURCE_LIMIT)) {
		if (!candidate || typeof candidate !== 'object') continue;
		const record = candidate as { readonly id?: unknown; readonly name?: unknown };
		if (typeof record.id !== 'string' || !record.id || record.id.length > 512
			|| typeof record.name !== 'string' || !record.name || record.name.length > 1_024
			|| nativeIds.has(record.id)) continue;
		const kind = record.id.startsWith('screen:') ? 'screen'
			: record.id.startsWith('window:') ? 'window' : null;
		if (!kind) continue;
		nativeIds.add(record.id);
		const token = opaqueId(createOpaqueId());
		const publicSource = Object.freeze({ token, name: sourceName(record.name, kind), kind });
		const nativeSource = Object.freeze({ id: record.id, name: record.name });
		sources.set(token, Object.freeze({ token, publicSource, nativeSource }));
	}
	return sources;
}

function validateGrantRequest(value: unknown): Readonly<FramescaperCaptureDesktopGrantRequestV1> {
	const record = closedRecord(value, ['generation', 'roles', 'sourceToken'], 'Capture desktop grant');
	const generation = positiveGeneration(record.generation);
	if (!Array.isArray(record.roles) || record.roles.length === 0
		|| record.roles.length > CAPTURE_ROLES.length) {
		throw new TypeError('Capture desktop grant roles are invalid.');
	}
	const roles = record.roles.map((role) => {
		if (!CAPTURE_ROLES.includes(role as FramescaperCaptureDesktopRole)) {
			throw new TypeError('Capture desktop grant role is invalid.');
		}
		return role as FramescaperCaptureDesktopRole;
	});
	if (new Set(roles).size !== roles.length) throw new TypeError('Capture desktop grant roles must be unique.');
	if (roles.includes('system-audio') && !roles.includes('display')) {
		throw new TypeError('Capture desktop system audio requires display.');
	}
	const sourceToken = record.sourceToken === null ? null : opaqueId(record.sourceToken);
	return Object.freeze({ generation, roles: Object.freeze(roles), sourceToken });
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function positiveGeneration(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError('Capture desktop generation must be a positive safe integer.');
	}
	return Number(value);
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError('Capture desktop opaque token is invalid.');
	}
	return value;
}

function reference(value: unknown, label: string): object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError(`Framescaper desktop ${label} must be an object reference.`);
	}
	return value as object;
}

function optionalReference(value: unknown): object | null {
	try { return reference(value, 'capture owner'); } catch { return null; }
}

function expiry(nowValue: number, durationMs: number): number {
	if (!Number.isSafeInteger(nowValue) || nowValue < 0 || nowValue > Number.MAX_SAFE_INTEGER - durationMs) {
		throw new RangeError('Framescaper desktop capture clock is invalid.');
	}
	return nowValue + durationMs;
}

function sourceName(value: string, kind: 'screen' | 'window'): string {
	const sanitized = value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 160);
	return sanitized || (kind === 'screen' ? 'Screen' : 'Window');
}

function systemVersionMajor(value: string): number {
	const match = /^(\d{1,3})(?:\.|$)/u.exec(value.trim());
	return match ? Number(match[1]) : 0;
}
