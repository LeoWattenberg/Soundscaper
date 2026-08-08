/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runs one phase inside the packaged renderer. Keep this function self-contained for executeJavaScript. */
export async function runDesktopProjectLibrarySourceBearingRendererSmoke(scope, plan, phase, prior) {
	const api = scope?.scapeDesktop?.v1;
	const requiredMethods = [
		'readSharedProjectBundle', 'commitSharedProject', 'beginSharedSourceWrite',
		'writeSharedSourceChunk', 'finishSharedSourceWrite',
	];
	if (!api || requiredMethods.some((name) => typeof api[name] !== 'function')) {
		throw new Error('Packaged source-bearing project-library bridge is incomplete');
	}
	const wait = (milliseconds) => new Promise((resolve) => scope.setTimeout(resolve, milliseconds));
	const waitFor = async (operation, label, timeoutMs = 12_000) => {
		const deadline = scope.performance.now() + timeoutMs;
		let lastError = null;
		while (scope.performance.now() < deadline) {
			try {
				const result = await operation();
				if (result) return result;
			} catch (error) {
				lastError = error;
			}
			await wait(50);
		}
		throw new Error(`${label} timed out${lastError ? `: ${String(lastError.message || lastError)}` : ''}`);
	};
	const hexDigest = async (bytes) => {
		const digest = await scope.crypto.subtle.digest('SHA-256', bytes);
		return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	};
	const projectDescriptor = async (document) => {
		if (typeof document !== 'string') throw new Error('Packaged shared project document is unavailable');
		let project;
		try { project = JSON.parse(document); } catch { throw new Error('Packaged shared project document is invalid'); }
		if (JSON.stringify(project) !== document || project?.schemaVersion !== 9
			|| project.id !== plan.seed.projectId || project.title !== plan.seed.title) {
			throw new Error('Packaged shared project document is not the fixed exact-schema project');
		}
		const sha256 = await hexDigest(new scope.TextEncoder().encode(document));
		return { project, descriptor: { id: project.id, title: project.title, revision: project.revision, sha256 } };
	};
	const normalizeSources = (sources) => {
		if (!Array.isArray(sources) || sources.length !== 2) {
			throw new Error('Packaged shared project does not expose exact mixed-media descriptors');
		}
		return sources.map((source, index) => {
			const expected = index === 0 ? plan.seed.audio : plan.seed.video;
			const kind = index === 0 ? 'audio' : 'video';
			if (source?.kind !== kind || source.sourceId !== expected.sourceId
				|| source.storageKey !== expected.storageKey
				|| typeof source.bindingId !== 'string' || typeof source.sha256 !== 'string'
				|| !Number.isSafeInteger(source.byteLength) || source.byteLength < 1) {
				throw new Error(`Packaged shared ${kind} descriptor is invalid`);
			}
			return {
				bindingId: source.bindingId,
				byteLength: source.byteLength,
				encoding: source.encoding,
				kind: source.kind,
				sha256: source.sha256,
				sourceId: source.sourceId,
				storageKey: source.storageKey,
			};
		});
	};
	const assertSourceContents = (actual, expected) => {
		for (const [index, source] of actual.entries()) {
			const priorSource = expected[index];
			if (!priorSource || source.kind !== priorSource.kind || source.encoding !== priorSource.encoding
				|| source.sourceId !== priorSource.sourceId || source.storageKey !== priorSource.storageKey
				|| source.byteLength !== priorSource.byteLength || source.sha256 !== priorSource.sha256) {
				throw new Error('Packaged shared media changed across the product handoff');
			}
		}
	};
	const readBundle = async () => {
		const bundle = await api.readSharedProjectBundle(plan.seed.projectId);
		if (!bundle) throw new Error('Packaged shared mixed-media project is unavailable');
		const document = await projectDescriptor(bundle.document);
		return { ...document, sources: normalizeSources(bundle.sources) };
	};
	const createAudioBytes = () => {
		const { channelCount, frameCount, sampleRate } = plan.seed.audio;
		const bytes = new Uint8Array(4 + frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT);
		const view = new DataView(bytes.buffer);
		view.setUint32(0, frameCount, true);
		for (let frame = 0; frame < frameCount; frame += 1) {
			view.setFloat32(4 + frame * 4, Math.sin(2 * Math.PI * 220 * frame / sampleRate) * 0.2, true);
		}
		return bytes;
	};
	const createVideoBytes = async () => {
		if (typeof scope.MediaRecorder !== 'function') {
			throw new Error('Packaged mixed-media smoke requires MediaRecorder');
		}
		const canvas = scope.document.createElement('canvas');
		canvas.width = plan.seed.video.width;
		canvas.height = plan.seed.video.height;
		const context = canvas.getContext('2d');
		if (!context || typeof canvas.captureStream !== 'function') {
			throw new Error('Packaged mixed-media smoke requires canvas video capture');
		}
		const stream = canvas.captureStream(plan.seed.video.frameRate);
		const mimeType = scope.MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
			? 'video/webm;codecs=vp8' : 'video/webm';
		const recorder = new scope.MediaRecorder(stream, { mimeType, videoBitsPerSecond: 200_000 });
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data?.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve, reject) => {
			recorder.addEventListener('stop', resolve, { once: true });
			recorder.addEventListener('error', () => reject(new Error('Packaged video generation failed')), { once: true });
		});
		recorder.start();
		for (let frame = 0; frame < 15; frame += 1) {
			context.fillStyle = frame % 2 ? '#245fce' : '#d92f45';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#f5f7ff';
			context.fillRect(frame % canvas.width, 8, 12, 12);
			stream.getVideoTracks()[0]?.requestFrame?.();
			await wait(34);
		}
		recorder.stop();
		await stopped;
		for (const track of stream.getTracks()) track.stop();
		const bytes = new Uint8Array(await new scope.Blob(chunks, { type: 'video/webm' }).arrayBuffer());
		if (!bytes.byteLength) throw new Error('Packaged video generation returned no bytes');
		return bytes;
	};
	const publishSource = async (source, encoding, bytes) => {
		const sha256 = await hexDigest(bytes);
		const admission = await api.beginSharedSourceWrite({
			byteLength: bytes.byteLength,
			encoding,
			projectId: plan.seed.projectId,
			projectRevision: 1,
			sha256,
			sourceId: source.sourceId,
		});
		if (admission.status === 'present') return admission.source;
		let offset = 0;
		while (offset < bytes.byteLength) {
			const chunk = bytes.slice(offset, Math.min(bytes.byteLength, offset + admission.chunkSize));
			const acknowledgement = await api.writeSharedSourceChunk({
				bytes: chunk, offset, writeId: admission.writeId,
			});
			if (acknowledgement.nextOffset !== offset + chunk.byteLength) {
				throw new Error('Packaged shared-source upload acknowledgement is invalid');
			}
			offset = acknowledgement.nextOffset;
		}
		return api.finishSharedSourceWrite({ writeId: admission.writeId, sha256 });
	};
	const scheduleProjectOpen = () => {
		scope.setTimeout(() => {
			scope.location.assign(`/?project=${encodeURIComponent(plan.seed.projectId)}`);
		}, 0);
	};
	const waitForWorkspace = async () => waitFor(() => {
		const root = scope.document.querySelector('[data-audio-editor]');
		return root?.dataset.projectId === plan.seed.projectId
			&& root.dataset.product === plan.productId
			&& root.dataset.trackCount === '2'
			&& root.dataset.clipCount === '2' ? root : null;
	}, 'Packaged mixed-media editor activation');
	const verifyProjectBinVideo = async (root, expectedDigest) => {
		const card = await waitFor(() => root.querySelector(
			`[data-project-bin-item][data-source-id="${plan.seed.video.sourceId}"]`,
		), 'Packaged Project Bin video activation');
		const buttons = [...card.querySelectorAll('button')];
		const preview = buttons.at(-1);
		if (!preview || preview.disabled) throw new Error('Packaged Project Bin video preview is unavailable');
		preview.click();
		const video = await waitFor(() => card.querySelector('video[src]'), 'Packaged Project Bin video preview');
		const response = await scope.fetch(video.src);
		const digest = await hexDigest(await response.arrayBuffer());
		if (digest !== expectedDigest) throw new Error('Packaged Project Bin video bytes changed after activation');
		preview.click();
		return digest;
	};
	const exerciseTransport = async (root) => {
		const play = root.querySelector('.kw-audio-editor__transport-play .kw-audio-editor__split-button-main button');
		if (!play || play.disabled) throw new Error('Packaged mixed-media playback is unavailable');
		play.click();
		await waitFor(() => play.getAttribute('aria-pressed') === 'true', 'Packaged mixed-media playback start');
		const stop = [...root.querySelectorAll('.kw-audio-editor__transport > .transport-button')]
			.find((button) => !button.closest('[data-transport="record"]'));
		if (!stop || stop.disabled) throw new Error('Packaged mixed-media stop control is unavailable');
		stop.click();
		await waitFor(() => play.getAttribute('aria-pressed') === 'false', 'Packaged mixed-media playback stop');
	};
	const editRecipientTrack = async (root) => {
		const row = root.querySelector(`[data-track-row][data-track-id="${plan.seed.audio.trackId}"]`);
		const name = row?.querySelector('[data-track-name]');
		if (!name) throw new Error('Packaged recipient audio track is unavailable');
		name.dispatchEvent(new scope.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
		const input = await waitFor(() => row.querySelector('[data-track-name] input'), 'Packaged track-name editor');
		const setter = Object.getOwnPropertyDescriptor(scope.HTMLInputElement.prototype, 'value')?.set;
		if (typeof setter !== 'function') throw new Error('Packaged track-name input setter is unavailable');
		setter.call(input, plan.seed.advanceTrackName);
		input.dispatchEvent(new scope.Event('input', { bubbles: true }));
		await wait(0);
		input.blur();
		await waitFor(() => row.querySelector('[data-track-name]')?.textContent?.includes(plan.seed.advanceTrackName),
			'Packaged recipient track edit');
		await waitFor(async () => {
			const bundle = await api.readSharedProjectBundle(plan.seed.projectId);
			if (!bundle) return false;
			const project = JSON.parse(bundle.document);
			return project.revision === plan.previous.project.revision + 1
				&& project.tracks.find((track) => track.id === plan.seed.audio.trackId)?.name === plan.seed.advanceTrackName;
		}, 'Packaged recipient project save');
	};
	const invokeHandoff = async (root) => {
		const fileMenu = root.querySelector('[data-application-menubar] button');
		if (!fileMenu) throw new Error('Packaged application File menu is unavailable');
		fileMenu.click();
		const destination = plan.productId === 'soundscaper' ? 'Framescaper' : 'Soundscaper';
		const item = await waitFor(() => [...scope.document.querySelectorAll(
			'.kw-audio-editor__application-menu .context-menu-item',
		)].find((candidate) => candidate.textContent?.includes(destination) && !candidate.classList.contains('disabled')),
		'Packaged cross-product handoff action');
		item.click();
	};

	if (phase === 'prepare') {
		const bundle = await api.readSharedProjectBundle(plan.seed.projectId);
		if (plan.stage === 'publish') {
			if (bundle !== null) throw new Error('Packaged source-bearing publish target already exists');
			const committed = await api.commitSharedProject(plan.seed.document);
			if (committed !== plan.seed.document) throw new Error('Packaged source-bearing seed commit changed');
			await publishSource(plan.seed.audio, 'audio-f32le-chunks-v1', createAudioBytes());
			await publishSource(plan.seed.video, 'video-original-v1', await createVideoBytes());
		} else if (bundle === null) {
			throw new Error('Packaged source-bearing previous project is missing');
		}
		const current = await readBundle();
		if (plan.previous) {
			if (JSON.stringify(current.descriptor) !== JSON.stringify(plan.previous.project)) {
				throw new Error('Packaged source-bearing previous project descriptor changed');
			}
			assertSourceContents(current.sources, plan.previous.sources);
		}
		scheduleProjectOpen();
		return { phase: 'prepared', sources: current.sources };
	}

	if (phase === 'activate') {
		const expectedSources = plan.previous?.sources ?? prior?.sources;
		if (!Array.isArray(expectedSources)) throw new Error('Packaged activation expected media is unavailable');
		const root = await waitForWorkspace();
		const audioName = root.querySelector(
			`[data-track-row][data-track-id="${plan.seed.audio.trackId}"] [data-track-name]`,
		)?.textContent?.trim();
		const expectedInitialName = plan.stage === 'return' ? plan.seed.advanceTrackName : 'Packaged sound';
		if (!audioName?.includes(expectedInitialName)) throw new Error('Packaged activated audio track name is invalid');
		const videoSha256 = await verifyProjectBinVideo(root, expectedSources[1].sha256);
		await exerciseTransport(root);
		if (plan.stage === 'advance') await editRecipientTrack(root);
		const current = await readBundle();
		const audioTrackName = plan.stage === 'publish' ? 'Packaged sound' : plan.seed.advanceTrackName;
		const ui = {
			activeProjectId: plan.seed.projectId,
			audioTrackName,
			clipCount: 2,
			handoffInvoked: plan.stage !== 'return',
			playbackStarted: true,
			playbackStopped: true,
			productId: plan.productId,
			projectBinSourceId: plan.seed.video.sourceId,
			trackCount: 2,
			videoSha256,
		};
		if (plan.stage !== 'return') await invokeHandoff(root);
		else assertSourceContents(current.sources, expectedSources);
		return { phase: 'activated', project: current.descriptor, sources: current.sources, ui };
	}

	if (phase === 'finalize') {
		await waitForWorkspace();
		const current = await readBundle();
		const expectedSources = plan.previous?.sources ?? prior?.sources;
		assertSourceContents(current.sources, expectedSources);
		return { phase: 'finalized', project: current.descriptor, sources: current.sources };
	}
	throw new Error('Packaged source-bearing renderer smoke phase is invalid');
}
