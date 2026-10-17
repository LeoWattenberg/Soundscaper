/* SPDX-License-Identifier: AGPL-3.0-only */
import { renderMotionAeHostComposition, type MotionAeRenderComposition, type MotionAeRenderedComposition, type MotionAeRenderedPng } from './motion-ae-host-render.ts';
export interface MotionAeOwnedRenderEntry { readonly exists: boolean; remove(): boolean }
interface RenderFile extends MotionAeOwnedRenderEntry {
	readonly name: string; readonly alias?: boolean; readonly fsName: string; readonly length: number; encoding: string;
	open(mode: string): boolean; read(count: number): string; close(): boolean; copy(path: string): boolean;
}
interface RenderFolder extends MotionAeOwnedRenderEntry { readonly fsName: string; create(): boolean; getFiles(): readonly (RenderFile | RenderFolder)[] }
interface OutputModule { readonly templates: readonly string[]; file: RenderFile; postRenderAction: unknown; applyTemplate(name: string): void }
interface QueueItem {
	timeSpanStart: number; timeSpanDuration: number; skipFrames: number; render: boolean; readonly numOutputModules: number;
	setSetting(name: string, value: string): void; getSetting(name: string): string;
	outputModule(index: number): OutputModule; remove(): void;
}
interface RenderQueue { readonly numItems: number; readonly rendering: boolean; readonly items: { add(composition: unknown): QueueItem }; item(index: number): QueueItem; render(): void }
declare const app: { readonly project: { readonly renderQueue: RenderQueue } };
declare const File: { new(path: string): RenderFile };
declare const Folder: { new(path: string): RenderFolder };
declare const PostRenderAction: { readonly NONE: unknown };
declare function prompt(message: string, defaultValue: string): string | null;

/** Header admission only; decoded pixels and actual AE alpha/color remain separately qualified. */
export function readMotionAePngHeader(bytes: string, byteLength: number, index: number): MotionAeRenderedPng {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (bytes.length !== 33) throw new Error('AE fallback requires a complete PNG header.');
	for (let offset = 0; offset < signature.length; offset++) if (bytes.charCodeAt(offset) !== signature[offset]) throw new Error('Selected AE output template did not produce PNG files.');
	function uint32(offset: number): number { let result = 0; for (let part = 0; part < 4; part++) { const value = bytes.charCodeAt(offset + part); if (value > 255) throw new Error('PNG binary read changed.'); result = result * 256 + value; } return result; }
	if (uint32(8) !== 13 || bytes.slice(12, 16) !== 'IHDR' || bytes.charCodeAt(26) !== 0 || bytes.charCodeAt(27) !== 0 || bytes.charCodeAt(28) > 1) throw new Error('AE fallback PNG header is unsupported.');
	return { index, byteLength, width: uint32(16), height: uint32(20), bitDepth: bytes.charCodeAt(24), alphaChannels: bytes.charCodeAt(25) === 4 || bytes.charCodeAt(25) === 6 };
}

/** Fresh folder + one owned queue item. Existing queue items and original project settings are never edited. */
export function renderMotionAeInstalledComposition(composition: MotionAeRenderComposition, nativeComposition: unknown, mediaDirectory: string,
	register: (entry: MotionAeOwnedRenderEntry) => void): MotionAeRenderedComposition {
	if (Math.round(composition.duration * composition.frameRate) > 256) throw new Error('The current Motion image-sequence carrier accepts at most 256 frames. Split this composition before rendering.');
	const queue = app.project.renderQueue;
	return renderMotionAeHostComposition(composition, { queueLength: queue.numItems, rendering: queue.rendering, checkCancelled: () => {},
		begin: () => {
			const directory = new Folder(mediaDirectory + '/render-stage');
			if (directory.exists || !directory.create()) throw new Error('Could not create a fresh AE render staging folder.'); register(directory);
			const item = queue.items.add(nativeComposition), files: RenderFile[] = [];
			function collect(): void {
				const entries = directory.getFiles(); if (entries.length > 256) throw new Error('AE output file count exceeded its frame budget.');
				for (let index = 0; index < entries.length; index++) {
					const entry = entries[index]!;
					if (!(entry instanceof File) || entry.alias === true || entry.fsName !== new File(directory.fsName + '/' + entry.name).fsName || !/^frame-?\d+\.png$/i.test(entry.name)) throw new Error('AE template produced an unexpected output. Inspect the new transfer folder.');
					let retained = false; for (let offset = 0; offset < files.length; offset++) if (files[offset]!.fsName === entry.fsName) retained = true;
					if (!retained) { files.push(entry); register(entry); }
				}
			}
			let output: OutputModule; let templates: readonly string[];
			try { output = item.outputModule(1); templates = output.templates; }
			catch (error) { try { item.remove(); } catch (cleanup) { const cause = { primary: error, cleanup }, failure = new Error('AE output initialization failed: ' + String(error) + '; queue cleanup failed: ' + String(cleanup), { cause }); failure.cause = cause; throw failure; } throw error; }
			return { templates,
				chooseTemplate: () => prompt('Enter the exact name of an installed full-size 8-bit PNG sequence template with RGB+Alpha. No template is qualified yet.\n\n' + templates.join('\n'), ''),
				configure: (template, duration) => {
					output.applyTemplate(template); output = item.outputModule(1); if (item.numOutputModules !== 1) throw new Error('AE fallback requires exactly one output module.');
					output.postRenderAction = PostRenderAction.NONE; output.file = new File(directory.fsName + '/frame[#####].png');
					item.timeSpanStart = 0; item.timeSpanDuration = duration; item.skipFrames = 0; item.render = true;
					// AE exposes English setting keys. Installed-version qualification must verify these actual values.
					item.setSetting('Frame Rate', String(composition.frameRate)); item.setSetting('Resolution', 'Full');
					if (Number(item.getSetting('Frame Rate')) !== composition.frameRate || item.getSetting('Resolution') !== 'Full'
						|| item.timeSpanStart !== 0 || item.timeSpanDuration !== duration || item.skipFrames !== 0 || output.postRenderAction !== PostRenderAction.NONE) throw new Error('AE could not confirm the exact full-span frame grid and render settings.');
				},
				render: () => {
					let failed = false, primary: unknown;
					try { if (queue.numItems !== 1 || queue.item(1) !== item) throw new Error('AE render queue changed; existing work must remain untouched.'); queue.render(); } catch (error) { failed = true; primary = error; }
					try { collect(); } catch (cleanup) { if (failed) { const cause = { primary, cleanup }, failure = new Error('AE rendering failed: ' + String(primary) + '; partial output discovery failed: ' + String(cleanup), { cause }); failure.cause = cause; throw failure; } throw cleanup; }
					if (failed) throw primary;
				},
				frames: () => {
					const frames: MotionAeRenderedPng[] = [];
					for (let offset = 0; offset < files.length; offset++) {
						const file = files[offset]!, match = /^frame(-?\d+)\.png$/i.exec(file.name)!; file.encoding = 'BINARY';
						if (!file.open('r')) throw new Error('Could not read rendered PNG header.'); let header = '', primary: unknown, failed = false;
						try { header = file.read(33); } catch (error) { failed = true; primary = error; }
						if (!file.close()) throw new Error('Rendered PNG header read/close failed: ' + String(primary)); if (failed) throw primary;
						frames.push(readMotionAePngHeader(header, file.length, Number(match[1])));
					} return frames;
				},
				retain: (frame, id) => {
					let source: RenderFile | undefined;
					for (let index = 0; index < files.length; index++) if (Number(/^frame(-?\d+)\.png$/i.exec(files[index]!.name)![1]) === frame.index) source = files[index];
					const destination = new File(mediaDirectory + '/' + id + '.png');
					if (!source || destination.exists || source.length !== frame.byteLength) throw new Error('AE rendered frame changed before retention.'); register(destination);
					if (!source.copy(destination.fsName) || destination.length !== frame.byteLength || !source.remove()) throw new Error('Could not retain the complete AE rendered frame.');
					return { path: 'media/' + id + '.png', byteLength: destination.length };
				},
				removeQueueItem: () => { item.remove(); if (directory.exists && directory.getFiles().length === 0 && !directory.remove()) throw new Error('Could not remove the empty render staging folder.'); },
			};
		},
	});
}
