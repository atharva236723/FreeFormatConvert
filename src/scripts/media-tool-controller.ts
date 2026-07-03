import { formatBytes } from '../lib/formats';

type Mode = 'compress-video' | 'compress-audio' | 'compress-gif' | 'trim';
type State = 'idle' | 'dragging' | 'editing' | 'working' | 'done' | 'error';

const MAX_BYTES: Record<Mode, number> = {
	'compress-video': 1024 * 1024 * 1024,
	'compress-audio': 300 * 1024 * 1024,
	'compress-gif': 50 * 1024 * 1024,
	trim: 1024 * 1024 * 1024,
};

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
	children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') node.className = v as string;
		else if (k in node) (node as Record<string, unknown>)[k] = v;
		else node.setAttribute(k, String(v));
	}
	for (const c of children) node.append(c);
	return node;
}

function fmtTime(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A "By quality / Target size" mode toggle plus a target-size slider ("dragger"), shared by the
 * compress tools. The slider runs from a small floor up to the original file size and shows the
 * chosen size as you drag — the single-pass encoder lands close to it. Returns the toggle element,
 * the (initially hidden) target-size field, and a getter for the chosen byte target. The caller
 * wires `onModeChange` to show/hide its own quality controls.
 */
function buildTargetControls(origBytes: number, onModeChange: (m: 'quality' | 'target') => void) {
	const seg = el('div', { class: 'tool-segments' });
	const qualityBtn = el('button', { class: 'tool-seg', type: 'button', 'aria-pressed': 'true' } as never, ['By quality']);
	const targetBtn = el('button', { class: 'tool-seg', type: 'button', 'aria-pressed': 'false' } as never, ['Target size']);
	seg.append(qualityBtn, targetBtn);

	const minBytes = Math.max(50 * 1024, Math.round(origBytes * 0.05));
	const startBytes = Math.min(origBytes, Math.max(minBytes, Math.round(origBytes * 0.5)));
	const slider = el('input', {
		class: 'tool-range',
		type: 'range',
		min: String(minBytes),
		max: String(Math.max(minBytes + 1, origBytes)),
		step: String(Math.max(1024, Math.round(origBytes / 200))),
		value: String(startBytes),
	});
	const valueLabel = el('span', { class: 'tool-range-value' }, [formatBytes(startBytes)]);
	const resultLabel = el('p', { class: 'tool-hint' }, ['Result will land close to this size.']);
	slider.addEventListener('input', () => {
		const bytes = Number(slider.value);
		valueLabel.textContent = formatBytes(bytes);
		const saved = 1 - bytes / origBytes;
		resultLabel.textContent =
			saved > 0.01 ? `Result ≈ ${formatBytes(bytes)} — about ${Math.round(saved * 100)}% smaller` : 'Result will land close to this size.';
	});
	const targetField = el('div', {}, [
		el('div', { class: 'tool-field' }, [
			el('div', { class: 'tool-slider-head' }, [el('label', { class: 'tool-label' }, ['Target size']), valueLabel]),
			slider,
		]),
		resultLabel,
		el('p', { class: 'tool-hint' }, [`Original is ${formatBytes(origBytes)}.`]),
	]);
	targetField.hidden = true;

	const set = (mode: 'quality' | 'target') => {
		qualityBtn.setAttribute('aria-pressed', String(mode === 'quality'));
		targetBtn.setAttribute('aria-pressed', String(mode === 'target'));
		targetField.hidden = mode !== 'target';
		onModeChange(mode);
	};
	qualityBtn.addEventListener('click', () => set('quality'));
	targetBtn.addEventListener('click', () => set('target'));

	return {
		modeField: el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Mode']), seg]),
		targetField,
		getTargetBytes: () => Number(slider.value),
	};
}

class MediaTool extends HTMLElement {
	private mode!: Mode;
	private dropzone!: HTMLElement;
	private fileInput!: HTMLInputElement;
	private fileNameEl!: HTMLElement;
	private fileSizeEl!: HTMLElement;
	private preview!: HTMLElement;
	private controls!: HTMLElement;
	private applyBtn!: HTMLButtonElement;
	private resultPreview!: HTMLElement;
	private doneMeta!: HTMLElement;
	private downloadLink!: HTMLAnchorElement;
	private errorMsg!: HTMLElement;
	private statusEl!: HTMLElement;
	private progressFill!: HTMLElement;
	private progressTrack!: HTMLElement;
	private workLabel!: HTMLElement;

	private file: File | null = null;
	private objectUrls: string[] = [];
	private dragCounter = 0;
	private duration = 0;
	private op: (() => Promise<{ blob: Blob; ext: string }>) | null = null;

	connectedCallback() {
		this.mode = (this.dataset.mode as Mode) || 'compress-video';
		this.dropzone = this.q('[data-role="dropzone"]');
		this.fileInput = this.q('[data-role="file-input"]');
		this.fileNameEl = this.q('[data-role="file-name"]');
		this.fileSizeEl = this.q('[data-role="file-size"]');
		this.preview = this.q('[data-role="preview"]');
		this.controls = this.q('[data-role="controls"]');
		this.applyBtn = this.q('[data-role="apply"]');
		this.resultPreview = this.q('[data-role="result-preview"]');
		this.doneMeta = this.q('[data-role="done-meta"]');
		this.downloadLink = this.q('[data-role="download"]');
		this.errorMsg = this.q('[data-role="error-message"]');
		this.statusEl = this.q('[data-role="status"]');
		this.progressFill = this.q('[data-role="progress-fill"]');
		this.progressTrack = this.q('[data-role="progress-track"]');
		this.workLabel = this.q('[data-role="work-label"]');
		if (this.dataset.actionLabel) this.applyBtn.textContent = this.dataset.actionLabel;
		this.wire();
	}

	private q<T extends HTMLElement = HTMLElement>(sel: string): T {
		const node = this.querySelector(sel);
		if (!node) throw new Error(`media-tool: missing ${sel}`);
		return node as T;
	}

	private set state(s: State) {
		this.dataset.state = s;
	}

	private announce(msg: string) {
		this.statusEl.textContent = msg;
	}

	private trackUrl(url: string): string {
		this.objectUrls.push(url);
		return url;
	}

	private wire() {
		this.dropzone.addEventListener('click', () => this.fileInput.click());
		this.dropzone.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.fileInput.click();
			}
		});
		this.dropzone.addEventListener('dragenter', (e) => {
			e.preventDefault();
			this.dragCounter++;
			this.state = 'dragging';
		});
		this.dropzone.addEventListener('dragover', (e) => e.preventDefault());
		this.dropzone.addEventListener('dragleave', (e) => {
			e.preventDefault();
			this.dragCounter = Math.max(0, this.dragCounter - 1);
			if (this.dragCounter === 0) this.state = 'idle';
		});
		this.dropzone.addEventListener('drop', (e) => {
			e.preventDefault();
			this.dragCounter = 0;
			const f = e.dataTransfer?.files?.[0];
			if (f) this.selectFile(f);
			else this.state = 'idle';
		});
		this.fileInput.addEventListener('change', () => {
			const f = this.fileInput.files?.[0];
			if (f) this.selectFile(f);
		});
		this.q('[data-role="change-file"]').addEventListener('click', () => this.fileInput.click());
		this.q('[data-role="restart"]').addEventListener('click', () => this.reset());
		this.q('[data-role="retry"]').addEventListener('click', () => {
			if (this.file) this.state = 'editing';
			else this.fileInput.click();
		});
		this.applyBtn.addEventListener('click', () => this.apply());
	}

	private selectFile(file: File) {
		const wantsGif = this.mode === 'compress-gif';
		const okType = wantsGif
			? file.type === 'image/gif' || /\.gif$/i.test(file.name)
			: this.mode === 'compress-audio'
				? file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff?|opus)$/i.test(file.name)
				: file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|flv|wmv|mpe?g|m4v|3gp|ogv)$/i.test(file.name);
		if (!okType) {
			this.showError('That file type isn’t supported by this tool. Please choose a matching file.');
			return;
		}
		if (file.size > MAX_BYTES[this.mode]) {
			this.showError(`This file is ${formatBytes(file.size)}, larger than the ${formatBytes(MAX_BYTES[this.mode])} limit.`);
			return;
		}
		this.file = file;
		this.duration = 0;
		this.fileNameEl.textContent = file.name;
		this.fileSizeEl.textContent = formatBytes(file.size);
		this.buildControls();
		this.state = 'editing';
		this.announce(`${file.name} loaded.`);
	}

	private buildControls() {
		this.controls.innerHTML = '';
		this.preview.innerHTML = '';
		const url = this.trackUrl(URL.createObjectURL(this.file!));
		switch (this.mode) {
			case 'compress-video': {
				const video = el('video', { src: url, controls: true, muted: true }) as HTMLVideoElement;
				video.addEventListener('loadedmetadata', () => {
					if (video.duration > 0 && Number.isFinite(video.duration)) this.duration = video.duration;
				});
				this.preview.append(video);
				return this.buildVideoCompress();
			}
			case 'compress-audio': {
				const audio = el('audio', { src: url, controls: true }) as HTMLAudioElement;
				audio.addEventListener('loadedmetadata', () => {
					if (audio.duration > 0 && Number.isFinite(audio.duration)) this.duration = audio.duration;
				});
				this.preview.append(audio);
				return this.buildAudioCompress();
			}
			case 'compress-gif':
				this.preview.append(el('img', { src: url, alt: '' }));
				return this.buildGifCompress();
			case 'trim':
				return this.buildTrim(url);
		}
	}

	private buildVideoCompress() {
		const levels = [
			{ id: 'high', label: 'Higher quality', crf: 24 },
			{ id: 'balanced', label: 'Balanced', crf: 28 },
			{ id: 'small', label: 'Smallest file', crf: 32 },
		];
		let crf = 28;
		const seg = el('div', { class: 'tool-segments' });
		levels.forEach((lvl) => {
			const b = el('button', { class: 'tool-seg', type: 'button' }, [lvl.label]);
			b.setAttribute('aria-pressed', String(lvl.id === 'balanced'));
			b.addEventListener('click', () => {
				crf = lvl.crf;
				seg.querySelectorAll('.tool-seg').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
			});
			seg.append(b);
		});
		const levelField = el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Compression level']), seg]);
		const { modeField, targetField, getTargetBytes } = buildTargetControls(this.file!.size, (mode) => {
			levelField.hidden = mode === 'target';
		});

		this.controls.append(
			modeField,
			levelField,
			targetField,
			el('p', { class: 'tool-hint' }, [
				'Output is an MP4 (H.264). A target size lands close but not exact — the in-browser encoder is single-pass.',
			]),
		);
		this.op = async () => {
			const { compressVideo, compressVideoToTarget } = await import('../lib/tools/mediaTools');
			if (!targetField.hidden) {
				const targetBytes = getTargetBytes();
				if (!targetBytes) throw new Error('Enter a target size greater than zero.');
				return compressVideoToTarget(this.file!, {
					targetBytes,
					durationSec: this.duration,
					onProgress: (r) => this.setProgress(r),
				});
			}
			return compressVideo(this.file!, crf, { onProgress: (r) => this.setProgress(r) });
		};
	}

	private buildAudioCompress() {
		const select = el('select', { class: 'tool-select' }, [
			el('option', { value: '96' }, ['96 kbps — small']),
			el('option', { value: '128', selected: true }, ['128 kbps — standard']),
			el('option', { value: '192' }, ['192 kbps — high']),
			el('option', { value: '256' }, ['256 kbps — very high']),
		]);
		const bitrateField = el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Target bitrate']), select]);
		const { modeField, targetField, getTargetBytes } = buildTargetControls(this.file!.size, (mode) => {
			bitrateField.hidden = mode === 'target';
		});

		this.controls.append(
			modeField,
			bitrateField,
			targetField,
			el('p', { class: 'tool-hint' }, ['Lower bitrates make smaller files. MP3 output (M4A/AAC/OGG kept when possible).']),
		);
		this.op = async () => {
			const { compressAudio, compressAudioToTarget } = await import('../lib/tools/mediaTools');
			if (!targetField.hidden) {
				const targetBytes = getTargetBytes();
				if (!targetBytes) throw new Error('Enter a target size greater than zero.');
				return compressAudioToTarget(this.file!, {
					targetBytes,
					durationSec: this.duration,
					onProgress: (r) => this.setProgress(r),
				});
			}
			return compressAudio(this.file!, Number(select.value), { onProgress: (r) => this.setProgress(r) });
		};
	}

	private buildGifCompress() {
		const scale = el('select', { class: 'tool-select' }, [
			el('option', { value: '1', selected: true }, ['Keep size (100%)']),
			el('option', { value: '0.75' }, ['75% size']),
			el('option', { value: '0.5' }, ['50% size']),
		]);
		const fps = el('select', { class: 'tool-select' }, [
			el('option', { value: '15', selected: true }, ['15 fps']),
			el('option', { value: '10' }, ['10 fps']),
			el('option', { value: '8' }, ['8 fps']),
		]);
		const scaleField = el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Scale']), scale]);
		const fpsField = el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Frame rate']), fps]);
		const { modeField, targetField, getTargetBytes } = buildTargetControls(this.file!.size, (mode) => {
			scaleField.hidden = mode === 'target';
			fpsField.hidden = mode === 'target';
		});

		this.controls.append(
			modeField,
			scaleField,
			fpsField,
			targetField,
			el('p', { class: 'tool-hint' }, [
				'Fewer frames and a smaller size make a lighter GIF. Hitting a target size tries several settings, so it can take a few passes.',
			]),
		);
		this.op = async () => {
			const { compressGif, compressGifToTarget } = await import('../lib/tools/mediaTools');
			if (!targetField.hidden) {
				const targetBytes = getTargetBytes();
				if (!targetBytes) throw new Error('Enter a target size greater than zero.');
				return compressGifToTarget(this.file!, { targetBytes, onProgress: (r) => this.setProgress(r) });
			}
			return compressGif(this.file!, {
				scale: Number(scale.value),
				fps: Number(fps.value),
				onProgress: (r) => this.setProgress(r),
			});
		};
	}

	private buildTrim(url: string) {
		const video = el('video', { src: url, controls: true }) as HTMLVideoElement;
		this.preview.append(video);
		let start = 0;
		let end = 0;
		const startLabel = el('span', { class: 'tool-range-value' }, ['0:00']);
		const endLabel = el('span', { class: 'tool-range-value' }, ['0:00']);
		const startRange = el('input', { class: 'tool-range', type: 'range', min: '0', max: '100', step: '0.1', value: '0' });
		const endRange = el('input', { class: 'tool-range', type: 'range', min: '0', max: '100', step: '0.1', value: '100' });
		const selLabel = el('p', { class: 'tool-hint' }, ['Load a video to set the trim range.']);

		const sync = () => {
			start = Number(startRange.value);
			end = Number(endRange.value);
			if (start > end - 0.1) start = Math.max(0, end - 0.1);
			startRange.value = String(start);
			startLabel.textContent = fmtTime(start);
			endLabel.textContent = fmtTime(end);
			selLabel.textContent = `Keep ${fmtTime(start)} → ${fmtTime(end)}  ·  ${(end - start).toFixed(1)}s`;
		};
		const seekPreview = (t: number) => {
			if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = t;
		};
		startRange.addEventListener('input', () => {
			sync();
			seekPreview(start);
		});
		endRange.addEventListener('input', () => {
			sync();
			seekPreview(end);
		});

		let durationSet = false;
		const setDuration = (d: number) => {
			if (durationSet || !(d > 0)) return;
			durationSet = true;
			this.duration = d;
			startRange.max = String(d);
			endRange.max = String(d);
			startRange.value = '0';
			endRange.value = String(d);
			sync();
		};
		video.addEventListener('loadedmetadata', () => setDuration(video.duration || 0));

		// Some containers the file-type check accepts (AVI/WMV/FLV, some MKV/MOV) can't be decoded
		// by the browser, so <video> fires an error / never reports a duration and the trim range
		// would be stuck at its 0–100 default. Fall back to probing the length with ffmpeg and swap
		// the dead preview for a note, so trimming still works.
		const probeFallback = async () => {
			if (durationSet) return;
			selLabel.textContent = 'Reading video length…';
			try {
				const { probeDuration } = await import('../lib/converter/ffmpegEngine');
				const d = await probeDuration(this.file!);
				if (durationSet) return;
				if (d) {
					this.preview.innerHTML = '';
					this.preview.append(
						el('p', { class: 'tool-hint' }, [
							'Preview isn’t available for this format in your browser, but trimming still works — set your range below.',
						]),
					);
					setDuration(d);
				} else {
					selLabel.textContent = 'Couldn’t read this video’s length — try a different file or format.';
				}
			} catch {
				if (!durationSet) selLabel.textContent = 'Couldn’t read this video’s length — try a different file or format.';
			}
		};
		video.addEventListener('error', probeFallback);
		// Cover the case where <video> silently stalls without firing an error event.
		window.setTimeout(() => {
			if (!durationSet) probeFallback();
		}, 5000);

		this.controls.append(
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Start']), startRange, startLabel]),
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['End']), endRange, endLabel]),
			selLabel,
		);
		this.op = async () => {
			if (end - start < 0.1) throw new Error('Choose a trim range longer than a fraction of a second.');
			const { trimVideo } = await import('../lib/tools/mediaTools');
			return trimVideo(this.file!, start, end, { onProgress: (r) => this.setProgress(r) });
		};
	}

	private setProgress(ratio: number) {
		const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
		this.progressFill.style.width = `${pct}%`;
		this.progressTrack.setAttribute('aria-valuenow', String(pct));
	}

	private async apply() {
		if (!this.file || !this.op) return;
		this.state = 'working';
		this.setProgress(0);
		this.workLabel.textContent = 'Processing…';
		this.announce('Processing your file.');
		try {
			const { blob, ext } = await this.op();
			const filename = this.outName(ext);
			const url = this.trackUrl(URL.createObjectURL(blob));
			this.downloadLink.href = url;
			this.downloadLink.download = filename;

			this.resultPreview.innerHTML = '';
			if (blob.type.startsWith('video/')) this.resultPreview.append(el('video', { src: url, controls: true }));
			else if (blob.type.startsWith('audio/')) this.resultPreview.append(el('audio', { src: url, controls: true }));
			else if (blob.type.startsWith('image/')) this.resultPreview.append(el('img', { src: url, alt: '' }));

			const saved = 1 - blob.size / this.file.size;
			const note = saved > 0.01 ? ` · ${Math.round(saved * 100)}% smaller` : '';
			this.doneMeta.innerHTML = `${filename} · ${formatBytes(blob.size)}<span class="tool-saving">${note}</span>`;
			this.state = 'done';
			this.announce('Done. Your file is ready to download.');
		} catch (err) {
			this.showError(err instanceof Error ? err.message : 'Something went wrong.');
		}
	}

	private outName(ext: string): string {
		const dot = this.file!.name.lastIndexOf('.');
		const base = dot === -1 ? this.file!.name : this.file!.name.slice(0, dot);
		const suffix = this.mode === 'trim' ? 'trimmed' : 'compressed';
		return `${base}-${suffix}.${ext}`;
	}

	private showError(message: string) {
		this.errorMsg.textContent = message;
		this.announce(message);
		this.state = 'error';
	}

	private reset() {
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls = [];
		this.file = null;
		this.op = null;
		this.fileInput.value = '';
		this.state = 'idle';
	}
}

customElements.define('media-tool', MediaTool);
