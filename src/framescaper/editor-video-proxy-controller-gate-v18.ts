/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import {
	assertFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from './editor-project-environment-v18.ts';
import {
	cloneFramescaperProjectHistoryV18,
	type FramescaperProjectHistoryV18,
} from './editor-project-v18-history.ts';
import {
	cloneFramescaperProjectV18,
	loadFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

const CAPTURE_FIELDS = ['sourceId'] as const;
const CAPTURE_OPTIONAL_FIELDS = ['signal'] as const;
const GATES = new WeakSet<object>();
const TICKETS = new WeakMap<object, TicketState>();

type SessionControllerV18 = ReturnType<
	FramescaperEditorProjectEnvironmentV18['runtime']['createSessionController']
>;

interface ActivationReservation {
	readonly token: object;
	release(): boolean;
}

interface TicketState {
	readonly gate: FramescaperVideoProxyAttachmentControllerGateV18;
	readonly projectId: string;
	readonly sourceId: string;
	readonly historyToken: object;
	readonly reservation: ActivationReservation;
	readonly base: FramescaperProjectV18;
	readonly history: FramescaperProjectHistoryV18;
	readonly signal?: AbortSignal;
	status: 'captured' | 'committed' | 'released';
}

export interface FramescaperVideoProxyAttachmentGateCaptureV18 {
	readonly sourceId: string;
	readonly signal?: AbortSignal;
}

export interface FramescaperVideoProxyAttachmentGateTicketV18 {
	readonly kind: 'framescaper-video-proxy-controller-gate-ticket';
	readonly version: 1;
}

export interface FramescaperVideoProxyAttachmentGateSnapshotV18 {
	readonly projectId: string;
	readonly sourceId: string;
	readonly base: FramescaperProjectV18;
	readonly history: FramescaperProjectHistoryV18;
}

/**
 * Product-owned exclusive controller reservation. Its one atomic install is
 * the only route from a writable all-null tab to committed proxy history.
 */
export class FramescaperVideoProxyAttachmentControllerGateV18 {
	readonly #environment: Readonly<FramescaperEditorProjectEnvironmentV18>;
	readonly #session: SessionControllerV18;

	constructor(
		environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown,
		sessionValue: SessionControllerV18 | unknown,
	) {
		const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
		const session = assertSession(sessionValue);
		this.#environment = environment;
		this.#session = session;
		GATES.add(this);
	}

	assertComposition(environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown): void {
		const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
		if (environment !== this.#environment) {
			throw new TypeError('The attachment controller gate belongs to a different V18 environment.');
		}
	}

	async capture(
		requestValue: FramescaperVideoProxyAttachmentGateCaptureV18 | unknown,
	): Promise<FramescaperVideoProxyAttachmentGateTicketV18> {
		const request = allowedRecord(
			requestValue,
			CAPTURE_FIELDS,
			CAPTURE_OPTIONAL_FIELDS,
			'Framescaper V18 attachment gate capture',
		);
		const sourceId = identifier(request.sourceId, 'attachment source id');
		const signal = request.signal === undefined ? undefined : abortSignal(request.signal);
		throwIfAborted(signal);
		const snapshot = this.#session.getSnapshot();
		const projectId = identifier(snapshot.activeProjectId, 'active project id');
		const tab = snapshot.tabs.find((candidate: { readonly projectId: string }) => candidate.projectId === projectId);
		if (!tab || tab.readOnly) {
			throw new Error('Video proxy attachment requires the exact active writable V18 tab.');
		}
		const captured = this.#session.captureProjectHistory(projectId);
		const history = cloneFramescaperProjectHistoryV18(
			this.#environment.runtime.profile,
			captured.history,
		);
		const base = cloneFramescaperProjectV18(this.#environment.runtime.profile, history.present);
		assertAllNullTarget(base, sourceId);
		const reservation = this.#session.beginProjectActivation(projectId, {
			expectedHistoryToken: captured.token,
			exclusive: true,
		}) as ActivationReservation;
		const ticket = Object.freeze({
			kind: 'framescaper-video-proxy-controller-gate-ticket',
			version: 1,
		}) satisfies FramescaperVideoProxyAttachmentGateTicketV18;
		const state: TicketState = {
			gate: this,
			projectId,
			sourceId,
			historyToken: captured.token,
			reservation,
			base,
			history,
			...(signal ? { signal } : {}),
			status: 'captured',
		};
		TICKETS.set(ticket, state);
		try {
			this.assertCurrent(ticket);
			let durable = await this.#environment.store.loadProject(projectId, signal ? { signal } : {});
			if (!sameProject(durable, base)) {
				const ownedPredecessor = history.undoStack.some((entry) => sameProject(entry.project, durable));
				if (!ownedPredecessor) {
					throw new Error('The active V18 base does not own the durable predecessor it would flush.');
				}
				await this.#environment.store.saveProject(base);
				durable = await this.#environment.store.loadProject(projectId, signal ? { signal } : {});
			}
			const revision = await this.#environment.store.loadProject(
				projectId,
				{ revision: Number(base.revision), ...(signal ? { signal } : {}) },
			);
			throwIfAborted(signal);
			this.assertCurrent(ticket);
			if (!sameProject(durable, base) || !sameProject(revision, base)) {
				throw new Error('The active V18 base is not exactly flushed as its durable current revision.');
			}
			return ticket;
		} catch (error) {
			await this.release(ticket);
			throw error;
		}
	}

	snapshot(
		ticketValue: FramescaperVideoProxyAttachmentGateTicketV18 | unknown,
	): Readonly<FramescaperVideoProxyAttachmentGateSnapshotV18> {
		const state = ticketState(this, ticketValue, 'captured');
		return Object.freeze({
			projectId: state.projectId,
			sourceId: state.sourceId,
			base: cloneFramescaperProjectV18(this.#environment.runtime.profile, state.base),
			history: cloneFramescaperProjectHistoryV18(this.#environment.runtime.profile, state.history),
		});
	}

	assertCurrent(ticketValue: FramescaperVideoProxyAttachmentGateTicketV18 | unknown): void {
		const state = ticketState(this, ticketValue, 'captured');
		throwIfAborted(state.signal);
		this.#session.assertProjectHistoryToken(state.projectId, state.historyToken);
		const snapshot = this.#session.getSnapshot();
		const tab = snapshot.tabs.find((candidate: { readonly projectId: string }) => candidate.projectId === state.projectId);
		if (snapshot.activeProjectId !== state.projectId || !tab || tab.readOnly
			|| !sameProject(tab.history.present, state.base)) {
			throw new DOMException('The Framescaper V18 attachment base is no longer current.', 'AbortError');
		}
	}

	installCommitted(
		ticketValue: FramescaperVideoProxyAttachmentGateTicketV18 | unknown,
		projectValue: unknown,
	): FramescaperProjectV18 {
		const state = ticketState(this, ticketValue, 'captured');
		this.assertCurrent(ticketValue);
		const loaded = loadFramescaperProjectV18(this.#environment.runtime.profile, projectValue);
		// What makes a committed project installable is that it is this project,
		// carrying the attachment this ticket was captured to install. It used to
		// be recognised by opening read-only, which stopped being true of an
		// attached document once the capability became one Framescaper provides.
		if (loaded.project.id !== state.projectId || !attachedSource(loaded.project, state.sourceId)) {
			throw new Error('Only a committed V18 project carrying this source\'s proxy can be installed.');
		}
		const project = cloneFramescaperProjectV18(this.#environment.runtime.profile, loaded.project);
		if (project.revision !== Number(state.base.revision) + 1) {
			throw new Error('The committed V18 proxy project must be exactly the next revision.');
		}
		const history: FramescaperProjectHistoryV18 = {
			limit: state.history.limit,
			present: project,
			undoStack: [...state.history.undoStack, {
				project: state.base,
				command: { type: 'framescaper/video-proxy-attach', sourceId: state.sourceId } as never,
			}].slice(-state.history.limit),
			redoStack: [],
		};
		const installed = this.#session.installCommittedProjectHistory(
			state.projectId,
			history,
			{
				activationToken: state.reservation.token,
				expectedHistoryToken: state.historyToken,
				// The tab stays editable: attaching a proxy adds preservable state
				// the product provides, and the edit that follows an attachment is
				// the point of having made one.
				readOnly: false,
				dirty: false,
			},
		) as unknown as Readonly<{ readonly project: unknown; readonly readOnly: false }>;
		state.status = 'committed';
		const result = cloneFramescaperProjectV18(this.#environment.runtime.profile, installed.project);
		const snapshot = this.#session.getSnapshot();
		const tab = snapshot.tabs.find((candidate: { readonly projectId: string }) => candidate.projectId === state.projectId);
		if (!tab || tab.readOnly || !sameProject(tab.history.present, result)) {
			throw new Error('The committed V18 proxy history did not install atomically.');
		}
		return result;
	}

	release(ticketValue: FramescaperVideoProxyAttachmentGateTicketV18 | unknown): Promise<void> {
		const state = ticketState(this, ticketValue, 'any');
		if (state.status === 'released') return Promise.resolve();
		state.status = 'released';
		state.reservation.release();
		return Promise.resolve();
	}
}

export function createFramescaperVideoProxyAttachmentControllerGateV18(
	environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown,
	sessionValue: SessionControllerV18 | unknown,
): FramescaperVideoProxyAttachmentControllerGateV18 {
	return new FramescaperVideoProxyAttachmentControllerGateV18(environmentValue, sessionValue);
}

export function assertFramescaperVideoProxyAttachmentControllerGateV18(
	value: unknown,
): asserts value is FramescaperVideoProxyAttachmentControllerGateV18 {
	if (!value || typeof value !== 'object' || !GATES.has(value)) {
		throw new TypeError('An exact product-created Framescaper V18 attachment controller gate is required.');
	}
}

function attachedSource(project: unknown, sourceId: string): boolean {
	const sources = (project as Readonly<{ sources?: readonly Readonly<Record<string, unknown>>[] }>)?.sources;
	const source = sources?.find((candidate) => candidate?.id === sourceId);
	return Boolean(source && source.kind === 'video' && source.proxyAttachment);
}

function assertSession(value: unknown): SessionControllerV18 {
	if (!value || typeof value !== 'object') throw new TypeError('A selected V18 session controller is required.');
	const session = value as Record<string, unknown>;
	for (const method of [
		'getSnapshot', 'captureProjectHistory', 'assertProjectHistoryToken',
		'beginProjectActivation', 'installCommittedProjectHistory',
	] as const) {
		if (typeof session[method] !== 'function') {
			throw new TypeError(`The selected V18 session controller requires ${method}.`);
		}
	}
	return value as SessionControllerV18;
}

function ticketState(
	gate: FramescaperVideoProxyAttachmentControllerGateV18,
	value: unknown,
	status: 'captured' | 'any',
): TicketState {
	if (!value || typeof value !== 'object') throw new TypeError('An authentic V18 attachment gate ticket is required.');
	const state = TICKETS.get(value);
	if (!state || state.gate !== gate || (status === 'captured' && state.status !== 'captured')) {
		throw new TypeError('The V18 attachment gate ticket is stale, foreign, or already settled.');
	}
	return state;
}

function assertAllNullTarget(project: FramescaperProjectV18, sourceId: string): void {
	let target = 0;
	for (const source of project.sources) {
		if (source.kind === 'video' && source.proxyAttachment !== null) {
			throw new Error('Video proxy attachment starts only from an exact all-null V18 base.');
		}
		if (source.id === sourceId) {
			if (source.kind !== 'video') throw new TypeError('Video proxy attachment requires a video source.');
			target += 1;
		}
	}
	if (target !== 1) throw new ReferenceError('The exact V18 attachment source is missing or duplicated.');
}

function sameProject(value: unknown, expected: unknown): boolean {
	try { return serializeScapeProjectDocument(value) === serializeScapeProjectDocument(expected); }
	catch { return false; }
}

function allowedRecord(
	value: unknown,
	required: readonly string[],
	optional: readonly string[],
	name: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).some((key) => (
		typeof key !== 'string' || !required.includes(key) && !optional.includes(key)
	))) throw new TypeError(`${name} has an unsupported field.`);
	for (const field of required) {
		const descriptor = descriptors[field];
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${field} is required.`);
	}
	const result: Record<string, unknown> = {};
	for (const field of [...required, ...optional]) {
		const descriptor = descriptors[field];
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${field} must be data.`);
		result[field] = descriptor.value;
	}
	return result;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError(`A bounded printable ${name} is required.`);
	}
	return value;
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A V18 attachment AbortSignal is required.');
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('V18 video proxy attachment was cancelled.', 'AbortError');
}
