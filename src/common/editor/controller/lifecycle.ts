export const EDITOR_DISPOSED_CODE = 'DISPOSED' as const;
export const EDITOR_PROJECT_CHANGED_CODE = 'PROJECT_CHANGED' as const;

export type EditorControllerPhase = 'booting' | 'ready' | 'error' | 'disposing' | 'disposed';

export class EditorDisposedError extends Error {
	readonly code = EDITOR_DISPOSED_CODE;

	constructor(message = 'The audio editor controller has been disposed.') {
		super(message);
		this.name = 'EditorDisposedError';
	}
}

export interface EditorLifetimeToken {
	readonly generation: number;
}

export interface EditorProjectToken {
	readonly generation: number;
	readonly projectId: string;
}

export class EditorProjectChangedError extends Error {
	readonly code = EDITOR_PROJECT_CHANGED_CODE;

	constructor() {
		super('The active editor project changed before the operation completed.');
		this.name = 'AbortError';
	}
}

/**
 * Invalidates work across project activation independently of the controller
 * lifetime. This keeps a healthy controller from accepting stale tab work.
 */
export class EditorProjectGeneration {
	#generation = 0;
	#projectId: string | null = null;

	get projectId(): string | null {
		return this.#projectId;
	}

	invalidate(): void {
		this.#generation += 1;
		this.#projectId = null;
	}

	activate(projectId: string): EditorProjectToken {
		const normalizedId = String(projectId || '').trim();
		if (!normalizedId) throw new TypeError('A project id is required to activate a project generation.');
		this.#generation += 1;
		this.#projectId = normalizedId;
		return this.capture();
	}

	capture(expectedProjectId: string | null = this.#projectId): EditorProjectToken {
		if (!this.#projectId || (expectedProjectId != null && expectedProjectId !== this.#projectId)) {
			throw new EditorProjectChangedError();
		}
		return Object.freeze({ generation: this.#generation, projectId: this.#projectId });
	}

	assertCurrent(token: EditorProjectToken): void {
		if (token.generation !== this.#generation || token.projectId !== this.#projectId) {
			throw new EditorProjectChangedError();
		}
	}
}

/**
 * The scope every cancellable that belongs to the open project carries. A
 * project switch cancels the scope instead of enumerating task names, so a new
 * subsystem joins the teardown by tagging its task rather than by being
 * remembered in a separate list.
 */
export const EDITOR_PROJECT_TASK_SCOPE = 'project' as const;

/** The abort surface a service can hand to callers or park in controller state. */
export interface EditorCancellableHandle {
	readonly signal: AbortSignal;
	abort(reason?: unknown): void;
}

export interface EditorTaskScope extends EditorCancellableHandle {
	readonly name: string;
	readonly generation: number;
	readonly scope: string | null;
	assertCurrent(): void;
	finish(): void;
}

export interface EditorTaskOptions {
	readonly scope?: string | null;
}

interface ActiveTask {
	readonly generation: number;
	readonly scope: string | null;
	readonly controller: AbortController;
}

function supersededTaskError(): DOMException {
	return new DOMException('The editor task was superseded.', 'AbortError');
}

/**
 * Owns the terminal controller lifecycle and replaceable async task scopes.
 * Feature services receive tokens/scopes instead of reaching into controller
 * state, which makes late async commits mechanically rejectable.
 */
export class EditorControllerLifetime {
	#phase: EditorControllerPhase = 'booting';
	#generation = 0;
	#taskGeneration = 0;
	#controller = new AbortController();
	#tasks = new Map<string, ActiveTask>();

	get phase(): EditorControllerPhase {
		return this.#phase;
	}

	get signal(): AbortSignal {
		return this.#controller.signal;
	}

	get inactive(): boolean {
		return this.#phase === 'disposing' || this.#phase === 'disposed';
	}

	capture(): EditorLifetimeToken {
		this.assertActive();
		return Object.freeze({ generation: this.#generation });
	}

	assertActive(token?: EditorLifetimeToken): void {
		if (this.inactive || (token && token.generation !== this.#generation)) {
			throw new EditorDisposedError();
		}
	}

	async guard<T>(value: PromiseLike<T> | T, token: EditorLifetimeToken): Promise<T> {
		const result = await value;
		this.assertActive(token);
		return result;
	}

	markReady(): void {
		this.assertActive();
		this.#phase = 'ready';
	}

	markError(): void {
		this.assertActive();
		this.#phase = 'error';
	}

	beginDisposal(): boolean {
		if (this.inactive) return false;
		this.#phase = 'disposing';
		this.#generation += 1;
		this.#controller.abort(new EditorDisposedError());
		for (const task of this.#tasks.values()) task.controller.abort(new EditorDisposedError());
		this.#tasks.clear();
		return true;
	}

	finishDisposal(): void {
		this.#phase = 'disposed';
	}

	startTask(name: string, options: EditorTaskOptions = {}): EditorTaskScope {
		this.assertActive();
		const normalizedName = String(name || '').trim();
		if (!normalizedName) throw new TypeError('Editor task scopes require a name.');
		const scope = String(options.scope ?? '').trim() || null;
		this.cancelTask(normalizedName);
		const generation = ++this.#taskGeneration;
		const controller = new AbortController();
		const abortFromLifetime = () => controller.abort(this.signal.reason || new EditorDisposedError());
		this.signal.addEventListener('abort', abortFromLifetime, { once: true });
		const task = { generation, scope, controller };
		this.#tasks.set(normalizedName, task);
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			this.signal.removeEventListener('abort', abortFromLifetime);
			if (this.#tasks.get(normalizedName) === task) this.#tasks.delete(normalizedName);
		};
		return Object.freeze({
			name: normalizedName,
			generation,
			scope,
			signal: controller.signal,
			abort: (reason: unknown = supersededTaskError()) => {
				if (this.#tasks.get(normalizedName) === task) this.#tasks.delete(normalizedName);
				controller.abort(reason);
			},
			assertCurrent: () => {
				this.assertActive();
				if (controller.signal.aborted || this.#tasks.get(normalizedName) !== task) {
					throw controller.signal.reason instanceof Error
						? controller.signal.reason
						: supersededTaskError();
				}
			},
			finish,
		});
	}

	cancelTask(name: string, reason: unknown = supersededTaskError()): void {
		const task = this.#tasks.get(name);
		if (!task) return;
		this.#tasks.delete(name);
		task.controller.abort(reason);
	}

	/**
	 * Cancels every task tagged with the given scope. Teardown asks the registry
	 * what is outstanding instead of carrying its own inventory of task names.
	 */
	cancelScope(scope: string, reason: unknown = supersededTaskError()): void {
		const normalizedScope = String(scope || '').trim();
		if (!normalizedScope) return;
		// A listener may start replacement work while the scope drains, so the
		// registry is snapshotted before anything is aborted.
		for (const [name, task] of [...this.#tasks]) {
			if (task.scope !== normalizedScope) continue;
			if (this.#tasks.get(name) === task) this.#tasks.delete(name);
			task.controller.abort(reason);
		}
	}
}

export function isEditorDisposedError(error: unknown): error is EditorDisposedError {
	return error instanceof EditorDisposedError
		|| (typeof error === 'object' && error !== null && 'code' in error && error.code === EDITOR_DISPOSED_CODE);
}
