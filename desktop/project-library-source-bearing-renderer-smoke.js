/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runs one phase inside the packaged renderer. Keep this function self-contained for executeJavaScript. */
export async function runDesktopProjectLibrarySourceBearingRendererSmoke(scope, plan, phase, prior) {
	const currentProjectSchemaVersion = 10;
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
	const projectDescriptor = async (document, expected = plan.seed) => {
		if (typeof document !== 'string') throw new Error('Packaged shared project document is unavailable');
		let project;
		try { project = JSON.parse(document); } catch { throw new Error('Packaged shared project document is invalid'); }
		if (JSON.stringify(project) !== document || project?.schemaVersion !== currentProjectSchemaVersion
			|| project.id !== expected.projectId || project.title !== expected.title) {
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
	const normalizeWitnessSources = (sources, witness) => {
		if (!Array.isArray(sources) || sources.length !== 2) {
			throw new Error('Packaged fallback witness does not expose two exact managed descriptors');
		}
		return sources.map((source, index) => {
			const expected = index === 0 ? witness.source : witness.fallback;
			if (source?.kind !== witness.kind || source.sourceId !== expected.sourceId
				|| source.storageKey !== expected.storageKey
				|| typeof source.bindingId !== 'string' || typeof source.sha256 !== 'string'
				|| !Number.isSafeInteger(source.byteLength) || source.byteLength < 1) {
				throw new Error(`Packaged ${witness.role} managed descriptor is invalid`);
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
	const readWitnessBundle = async (witness) => {
		const bundle = await api.readSharedProjectBundle(witness.projectId);
		if (!bundle) throw new Error(`Packaged ${witness.role} project is unavailable`);
		const document = await projectDescriptor(bundle.document, witness);
		const sources = normalizeWitnessSources(bundle.sources, witness);
		const fallback = sources.find(({ sourceId }) => sourceId === witness.fallback.sourceId);
		const expectedDocument = materializeWitnessDocument(witness, fallback?.sha256);
		if (bundle.document !== expectedDocument) {
			throw new Error(`Packaged ${witness.role} canonical document changed`);
		}
		return { ...document, sources };
	};
	const createAudioBytes = (source = plan.seed.audio) => {
		const { channelCount, frameCount, sampleRate } = source;
		const bytes = new Uint8Array(4 + frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT);
		const view = new DataView(bytes.buffer);
		view.setUint32(0, frameCount, true);
		let offset = 4;
		for (let channel = 0; channel < channelCount; channel += 1) {
			for (let frame = 0; frame < frameCount; frame += 1) {
				const polarity = channel % 2 === 0 ? 1 : -1;
				view.setFloat32(offset, Math.sin(2 * Math.PI * 220 * frame / sampleRate) * 0.2 * polarity, true);
				offset += Float32Array.BYTES_PER_ELEMENT;
			}
		}
		return bytes;
	};
	const materializeWitnessDocument = (witness, sha256) => {
		const project = JSON.parse(witness.document);
		const requirements = project?.featureRequirements?.requirements;
		if (!Array.isArray(requirements) || requirements.length !== 1) {
			throw new Error('Packaged fallback manifest is unavailable');
		}
		const requirement = requirements[0];
		if (requirement?.id !== witness.requirementId
			|| requirement.fallback?.sha256 !== '0'.repeat(64)) {
			throw new Error('Packaged fallback manifest placeholder is invalid');
		}
		requirement.fallback.sha256 = sha256;
		return JSON.stringify(project);
	};
	const createVideoBytes = async (source = plan.seed.video) => {
		if (typeof scope.MediaRecorder !== 'function') {
			throw new Error('Packaged mixed-media smoke requires MediaRecorder');
		}
		const canvas = scope.document.createElement('canvas');
		canvas.width = source.width;
		canvas.height = source.height;
		const context = canvas.getContext('2d');
		if (!context || typeof canvas.captureStream !== 'function') {
			throw new Error('Packaged mixed-media smoke requires canvas video capture');
		}
		const stream = canvas.captureStream(source.frameRate);
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
	const publishSource = async (projectId, source, encoding, bytes) => {
		const sha256 = await hexDigest(bytes);
		const admission = await api.beginSharedSourceWrite({
			byteLength: bytes.byteLength,
			encoding,
			projectId,
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
	const waitForWorkspace = async () => waitFor(() => {
		const root = scope.document.querySelector('[data-audio-editor]');
		return root?.dataset.projectId === plan.seed.projectId
			&& root.dataset.product === plan.productId
			&& root.dataset.trackCount === '2'
			&& root.dataset.clipCount === '2' ? root : null;
	}, 'Packaged mixed-media editor activation');
	const waitForWitnessWorkspace = async (witness) => waitFor(() => {
		const root = scope.document.querySelector('[data-audio-editor]');
		return root?.dataset.projectId === witness.projectId
			&& root.dataset.product === plan.productId
			&& root.dataset.trackCount === '1'
			&& root.dataset.clipCount === '1' ? root : null;
	}, `Packaged ${witness.role} editor activation`);
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
	const beginRecipientTrackEdit = async (root) => {
		const row = root.querySelector(`[data-track-row][data-track-id="${plan.seed.audio.trackId}"]`);
		const name = row?.querySelector('.track-control-panel__track-name-text');
		if (!name) throw new Error('Packaged recipient audio track is unavailable');
		name.dispatchEvent(new scope.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
		const input = await waitFor(() => row.querySelector('[data-track-name] input'), 'Packaged track-name editor');
		if (input.disabled) throw new Error('Packaged recipient track-name editor is disabled');
		input.focus();
		input.select();
	};
	const completeRecipientTrackEdit = async (root) => {
		const row = root.querySelector(`[data-track-row][data-track-id="${plan.seed.audio.trackId}"]`);
		if (!row) throw new Error('Packaged recipient audio track disappeared');
		await waitFor(() => row.querySelector('.track-control-panel__track-name-text')
			?.textContent?.includes(plan.seed.advanceTrackName),
		'Packaged recipient track edit').catch(() => {
			const input = row.querySelector('[data-track-name] input');
			throw new Error(
				`Packaged recipient track edit timed out (value=${String(input?.value)}, active=${String(scope.document.activeElement === input)}, connected=${String(input?.isConnected)})`,
			);
		});
		await waitFor(async () => {
			const bundle = await api.readSharedProjectBundle(plan.seed.projectId);
			if (!bundle) return false;
			const project = JSON.parse(bundle.document);
			return project.revision === plan.previous.project.revision + 1
				&& project.tracks.find((track) => track.id === plan.seed.audio.trackId)?.name === plan.seed.advanceTrackName;
		}, 'Packaged recipient project save');
	};
	const assertWitnessEditable = async (root) => {
		if (root.dataset.editBlockReason) {
			throw new Error('Packaged fallback witness did not return editable');
		}
		const name = root.querySelector('[data-track-row] .track-control-panel__track-name-text');
		if (!name) throw new Error('Packaged fallback witness track name is unavailable');
		name.dispatchEvent(new scope.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
		const input = await waitFor(
			() => root.querySelector('[data-track-row] [data-track-name] input'),
			'Packaged fallback witness editable control',
		);
		if (input.disabled || input.readOnly) {
			throw new Error('Packaged fallback witness edit control is blocked');
		}
		input.dispatchEvent(new scope.KeyboardEvent('keydown', {
			bubbles: true, cancelable: true, key: 'Escape', code: 'Escape',
		}));
	};
	const fallbackEvidence = async (root, witness, document, sources) => {
		const markerAttribute = witness.kind === 'audio'
			? 'data-project-feature-audio-rendered-fallback'
			: 'data-project-feature-video-rendered-fallback';
		const recipient = plan.stage === 'advance';
		const markerSelector = `[data-project-feature-requirement="${witness.featureId}"] [${markerAttribute}]`;
		if (recipient) {
			if (root.dataset.editBlockReason !== 'read-only') {
				throw new Error('Packaged fallback recipient is not read-only');
			}
			await waitFor(() => root.querySelector(markerSelector), 'Packaged fallback compatibility indicator');
		} else {
			if (root.querySelector(markerSelector)) {
				throw new Error('Packaged fallback compatibility indicator remained at the origin');
			}
			await assertWitnessEditable(root);
		}
		const requirements = document.project?.featureRequirements?.requirements;
		const matches = Array.isArray(requirements)
			? requirements.filter(({ id }) => id === witness.requirementId)
			: [];
		const requirement = matches[0];
		const nativeSource = sources.find(({ sourceId }) => sourceId === witness.source.sourceId);
		const fallbackSource = sources.find(({ sourceId }) => sourceId === witness.fallback.sourceId);
		if (matches.length !== 1 || requirement.featureId !== witness.featureId
			|| requirement.fallback?.kind !== witness.kind
			|| requirement.fallback?.role !== witness.role
			|| requirement.fallback?.sourceId !== witness.fallback.sourceId
			|| requirement.fallback?.sha256 !== fallbackSource?.sha256
			|| typeof nativeSource?.sha256 !== 'string') {
			throw new Error('Packaged fallback role evidence is invalid');
		}
		return {
			workflowId: witness.workflowId,
			featureId: witness.featureId,
			kind: witness.kind,
			projectId: witness.projectId,
			requirementId: witness.requirementId,
			role: witness.role,
			documentSha256: document.descriptor.sha256,
			nativeSha256: nativeSource.sha256,
			sha256: fallbackSource.sha256,
			sourceId: witness.fallback.sourceId,
			readOnly: recipient,
			editable: !recipient,
			compatibilityNotice: recipient,
			handoffInvoked: recipient,
			playbackStarted: true,
			playbackStopped: true,
		};
	};
	const uiResult = (videoSha256, fallbackRoles) => ({
		activeProjectId: plan.seed.projectId,
		audioTrackName: plan.stage === 'publish' ? 'Packaged sound' : plan.seed.advanceTrackName,
		clipCount: 2,
		fallbackRoles,
		handoffInvoked: plan.stage !== 'return',
		playbackStarted: true,
		playbackStopped: true,
		productId: plan.productId,
		projectBinSourceId: plan.seed.video.sourceId,
		trackCount: 2,
		videoSha256,
	});
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
			const audioBytes = createAudioBytes();
			const videoBytes = await createVideoBytes();
			const committed = await api.commitSharedProject({ document: plan.seed.document, expectedRevision: null });
			if (committed?.status !== 'committed' || committed.document !== plan.seed.document) {
				throw new Error('Packaged source-bearing seed commit changed');
			}
			await publishSource(plan.seed.projectId, plan.seed.audio, 'audio-f32le-chunks-v1', audioBytes);
			await publishSource(plan.seed.projectId, plan.seed.video, 'video-original-v1', videoBytes);
			for (const witness of plan.seed.roleWitnesses) {
				const witnessBytes = witness.kind === 'audio'
					? createAudioBytes(witness.source)
					: videoBytes;
				const sha256 = await hexDigest(witnessBytes);
				const document = materializeWitnessDocument(witness, sha256);
				const witnessCommit = await api.commitSharedProject({ document, expectedRevision: null });
				if (witnessCommit?.status !== 'committed' || witnessCommit.document !== document) {
					throw new Error(`Packaged ${witness.role} seed commit changed`);
				}
				const encoding = witness.kind === 'audio'
					? 'audio-f32le-chunks-v1'
					: 'video-original-v1';
				await publishSource(witness.projectId, witness.source, encoding, witnessBytes);
				await publishSource(witness.projectId, witness.fallback, encoding, witnessBytes);
			}
		} else if (bundle === null) {
			throw new Error('Packaged source-bearing previous project is missing');
		}
		const current = await readBundle();
		if (plan.previous) {
			if (current.descriptor.id !== plan.previous.project.id
				|| current.descriptor.title !== plan.previous.project.title
				|| current.descriptor.revision !== plan.previous.project.revision
				|| current.descriptor.sha256 !== plan.previous.project.sha256) {
				throw new Error(
					`Packaged source-bearing previous project descriptor changed (${String(plan.previous.project.revision)}/${plan.previous.project.sha256.slice(0, 8)} to ${String(current.descriptor.revision)}/${current.descriptor.sha256.slice(0, 8)})`,
				);
			}
			assertSourceContents(current.sources, plan.previous.sources);
		}
		return { phase: 'prepared', sources: current.sources };
	}

	if (phase === 'witness') {
		if (plan.stage === 'publish' || !Number.isSafeInteger(prior?.witnessIndex)) {
			throw new Error('Packaged fallback witness phase is unavailable');
		}
		const witness = plan.seed.roleWitnesses[prior.witnessIndex];
		const expectedProductId = plan.stage === 'advance'
			? witness?.recipientProductId
			: witness?.recipientProductId === 'soundscaper' ? 'framescaper' : 'soundscaper';
		if (!witness || expectedProductId !== plan.productId) {
			throw new Error('Packaged fallback witness identity is invalid');
		}
		const root = await waitForWitnessWorkspace(witness);
		const activated = await readWitnessBundle(witness);
		const fallback = await fallbackEvidence(root, witness, activated, activated.sources);
		await exerciseTransport(root);
		if (plan.stage === 'advance') await invokeHandoff(root);
		return { phase: 'witnessed', fallback };
	}

	if (phase === 'activate') {
		const expectedSources = plan.previous?.sources ?? prior?.sources;
		if (!Array.isArray(expectedSources)) throw new Error('Packaged activation expected media is unavailable');
		const root = await waitForWorkspace();
		const activated = await readBundle();
		assertSourceContents(activated.sources, expectedSources);
		const audioName = root.querySelector(
			`[data-track-row][data-track-id="${plan.seed.audio.trackId}"] .track-control-panel__track-name-text`,
		)?.textContent?.trim();
		const expectedInitialName = plan.stage === 'return' ? plan.seed.advanceTrackName : 'Packaged sound';
		if (!audioName?.includes(expectedInitialName)) throw new Error('Packaged activated audio track name is invalid');
		const videoSha256 = await verifyProjectBinVideo(root, expectedSources[1].sha256);
		await exerciseTransport(root);
		const ui = uiResult(videoSha256, prior?.fallbackRoles ?? []);
		if (plan.stage === 'advance') {
			await beginRecipientTrackEdit(root);
			return { phase: 'editing', project: activated.descriptor, sources: activated.sources, ui };
		}
		if (plan.stage !== 'return') await invokeHandoff(root);
		return { phase: 'activated', project: activated.descriptor, sources: activated.sources, ui };
	}

	if (phase === 'complete-edit') {
		if (plan.stage !== 'advance' || !Array.isArray(plan.previous?.sources)) {
			throw new Error('Packaged recipient edit completion is unavailable');
		}
		const root = await waitForWorkspace();
		await completeRecipientTrackEdit(root);
		await invokeHandoff(root);
		return {
			phase: 'activated',
			project: plan.previous.project,
			sources: plan.previous.sources,
			ui: uiResult(plan.previous.sources[1].sha256, prior?.fallbackRoles ?? []),
		};
	}

	throw new Error('Packaged source-bearing renderer smoke phase is invalid');
}
