/* SPDX-License-Identifier: AGPL-3.0-only */
import { MAX_UPLOAD_BYTES, record } from './contracts.ts';
import { accessTokenForSession, type OAuthHandlerDependencies } from './oauth-handlers.ts';
import { handleOAuthEndpoint, oauthJson, oauthResponseHeaders, OAuthHttpError, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import { selectedProviderContext } from './provider-selection.ts';
import { providerConfiguration, trustedProviderHookUrl, trustedProviderMediaUrl, trustedProviderUploadUrl } from './provider-config.ts';
import { discoverAudiocityCapabilities } from './provider-discovery.ts';
import { checkResponse, providerFetch } from './provider-fetch.ts';
import { archiveUploadInput, invalid, normalizeProject, projectId, sqliteArchiveStream } from './project-contracts.ts';
import { exactUploadStream } from './streams.ts';

export function handleAudiocomProjectsRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD', 'POST'], async admission => {
		context = selectedProviderContext(context);
		const provider = providerConfiguration(context.env);
		if (provider.kind !== 'audiocity') throw new OAuthHttpError(404, 'not_found', 'Project archive storage is unavailable.');
		const input = context.request.method === 'POST' ? archiveUploadInput(context.request) : null;
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		context = authorized.context;
		const capabilities = await discoverAudiocityCapabilities(context, dependencies);
		if (!capabilities.projectFormats.length || (input && !capabilities.projectFormats.includes(input.format))) throw new OAuthHttpError(404, 'not_found', 'This server does not support project archives.');
		const control = async (path: string, init: RequestInit = {}): Promise<unknown> => {
			const response = await providerFetch(context, dependencies, new URL(path, provider.apiOrigin), { ...init,
				headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
			await checkResponse(response, authorized, dependencies);
			return readUpstreamJson(response, 1024 * 1024);
		};
		if (input === null) {
			const query = new URL(context.request.url).searchParams;
			if ([...query.keys()].some(key => key !== 'page') || query.getAll('page').length > 1 || !/^[1-9]\d{0,5}$/u.test(query.get('page') ?? '1')) throw new OAuthHttpError(400, 'invalid_request', 'Invalid archive page.');
			const page = Number(query.get('page') ?? '1');
			const data = record(await control(`/project?transport=file&per-page=20&page=${page}`));
			const pagination = record(data.pagination);
			if (!Array.isArray(data.items) || data.items.length > 20 || pagination.page !== page || !Number.isSafeInteger(pagination.pages) || Number(pagination.pages) < 0) throw invalid('Invalid archive list.');
			return oauthJson({ data: { results: data.items.map(normalizeProject), page, hasNext: page < Number(pagination.pages) } }, 200, admission);
		}
		if (input.size > capabilities.maximumUploadBytes) throw new OAuthHttpError(413, 'payload_too_large', 'The project archive exceeds the server upload limit.');
		const created = record(await control('/project', { method: 'POST', body: JSON.stringify(input) }));
		const project = normalizeProject(created.project);
		const snapshot = projectId(record(created.snapshot).id);
		const sync = record(created.sync);
		if (!Array.isArray(sync.blocks) || sync.blocks.length !== 0) throw invalid('Unexpected native project transport.');
		const descriptor = record(sync.file);
		const destination = trustedProviderUploadUrl(descriptor.url, provider);
		const success = trustedProviderHookUrl(descriptor.success, provider, 'success');
		const failure = trustedProviderHookUrl(descriptor.fail, provider, 'fail');
		try {
			const transfer = exactUploadStream(sqliteArchiveStream(context.request.body!), input.size);
			const uploaded = await providerFetch(context, dependencies, destination, { method: 'PUT',
				headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(input.size) }, body: transfer.body }, true);
			if (!uploaded.ok) { await uploaded.body?.cancel(); throw new OAuthHttpError(502, 'upload_failed', 'The server rejected the project archive.'); }
			await uploaded.body?.cancel(); await transfer.completed;
			const confirmed = await providerFetch(context, dependencies, success, { method: 'POST' });
			await checkResponse(confirmed, authorized, dependencies); await confirmed.body?.cancel();
			await control(`/project/${project.id}/snapshot/${snapshot}/sync`, { method: 'POST' });
			const completed = normalizeProject(await control(`/project/${project.id}`));
			if (completed.snapshotId !== snapshot) throw invalid('Project synchronization did not complete.');
			return oauthJson({ data: completed }, 201, admission);
		} catch (error) {
			try {
				const response = await (dependencies.fetchImpl ?? fetch)(failure, { method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
				await response.body?.cancel();
			} catch { /* The server retains a pending revision if best-effort cleanup fails. */ }
			throw error;
		}
	});
}

export function handleAudiocomProjectDownloadRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD'], async admission => {
		context = selectedProviderContext(context);
		const provider = providerConfiguration(context.env);
		if (provider.kind !== 'audiocity') throw new OAuthHttpError(404, 'not_found', 'Project archive storage is unavailable.');
		const query = new URL(context.request.url).searchParams;
		if (query.size !== 2 || query.getAll('id').length !== 1 || query.getAll('snapshotId').length !== 1) throw new OAuthHttpError(400, 'invalid_request', 'Invalid project archive download.');
		let id: string; let snapshotId: string;
		try { id = projectId(query.get('id')); snapshotId = projectId(query.get('snapshotId')); }
		catch { throw new OAuthHttpError(400, 'invalid_request', 'Invalid project identifier.'); }
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		context = authorized.context;
		const capabilities = await discoverAudiocityCapabilities(context, dependencies);
		if (!capabilities.projectFormats.length) throw new OAuthHttpError(404, 'not_found', 'Project archives are unavailable.');
		const metadata = async (path: string): Promise<unknown> => {
			const response = await providerFetch(context, dependencies, new URL(path, provider.apiOrigin), { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
			await checkResponse(response, authorized, dependencies); return readUpstreamJson(response);
		};
		const project = normalizeProject(await metadata(`/project/${id}`));
		const snapshot = record(await metadata(`/project/${id}/snapshot/${snapshotId}?expand=blocks,file_url`));
		if (project.id !== id || snapshot.id !== snapshotId || snapshot.transport !== 'file' || !capabilities.projectFormats.includes(snapshot.format as 'aup3' | 'aup4')
			|| !Number.isSafeInteger(snapshot.date_synced) || Number(snapshot.date_synced) <= 0
			|| !Number.isSafeInteger(snapshot.file_size) || Number(snapshot.file_size) < 16 || Number(snapshot.file_size) > MAX_UPLOAD_BYTES
			|| (Array.isArray(snapshot.blocks) && snapshot.blocks.length !== 0)) throw invalid('The completed project archive is unavailable.');
		const response = await providerFetch(context, dependencies, trustedProviderMediaUrl(snapshot.file_url, provider), { method: admission.head ? 'HEAD' : 'GET' }, true);
		if (response.status !== 200 || !response.body && !admission.head || response.headers.get('Content-Length') !== String(snapshot.file_size)) {
			await response.body?.cancel(); throw invalid('The project archive size could not be verified.');
		}
		const headers = oauthResponseHeaders(admission.corsOrigin);
		headers.set('Cache-Control', 'private, no-store'); headers.set('Content-Type', 'application/octet-stream');
		headers.set('Content-Length', String(snapshot.file_size));
		const safeName = [...project.name].map(character => character.charCodeAt(0) < 32 ? '-' : character).join('').replaceAll(/[\\/";]+/gu, '-');
		const filename = `${safeName.slice(0, 160)}.${String(snapshot.format)}`;
		headers.set('Content-Disposition', `attachment; filename="${filename.replaceAll(/[^\x20-\x7e]/gu, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
		const checked = response.body ? exactUploadStream(sqliteArchiveStream(response.body), Number(snapshot.file_size)) : null;
		return new Response(admission.head ? null : checked?.body, { status: 200, headers });
	});
}
