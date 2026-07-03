import { formatBytes } from '../lib/formats';
import {
	compressImage,
	compressImageToTarget,
	cropImage,
	decodeImage,
	flipImage,
	readDimensions,
	resizeImage,
	rotateImage,
	suffixName,
	type CropRect,
} from '../lib/tools/imageTools';

type Mode = 'resize' | 'crop' | 'rotate' | 'flip' | 'compress' | 'colorpicker';
type State = 'idle' | 'dragging' | 'editing' | 'working' | 'done' | 'error';

const MAX_BYTES = 50 * 1024 * 1024; // matches the image cap in formats.ts

/** Tiny DOM builder to keep the runtime-built controls readable. */
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

class ImageTool extends HTMLElement {
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

	private file: File | null = null;
	private animated = false; // true for a multi-frame GIF, which must keep its frames via ffmpeg
	private objectUrls: string[] = [];
	private dragCounter = 0;

	// per-mode transient state
	private rotateAngle = 0;
	private flipH = false;
	private flipV = false;
	private natural = { width: 0, height: 0 };
	private aspectLocked = true;
	private compressTimer: number | undefined;

	connectedCallback() {
		this.mode = (this.dataset.mode as Mode) || 'resize';
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

		if (this.dataset.actionLabel) this.applyBtn.textContent = this.dataset.actionLabel;

		this.wire();
	}

	private q<T extends HTMLElement = HTMLElement>(sel: string): T {
		const node = this.querySelector(sel);
		if (!node) throw new Error(`image-tool: missing ${sel}`);
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
		// The primary action is wired per-mode via applyBtn.onclick in each build*() method
		// (each mode needs its own options), so there's no shared handler here.
	}

	private async selectFile(file: File) {
		if (!file.type.startsWith('image/') && !/\.(jpe?g|jfif|png|webp|gif|bmp|svg|avif|tiff?)$/i.test(file.name)) {
			this.showError('That doesn’t look like an image. Try a JPG, PNG, WebP, GIF or SVG file.');
			return;
		}
		if (file.size > MAX_BYTES) {
			this.showError(`This image is ${formatBytes(file.size)} — images are limited to ${formatBytes(MAX_BYTES)}.`);
			return;
		}
		this.file = file;
		this.fileNameEl.textContent = file.name;
		this.fileSizeEl.textContent = formatBytes(file.size);

		try {
			this.natural = await readDimensions(file);
		} catch {
			this.showError('This image could not be opened in your browser.');
			return;
		}

		this.animated = await this.isAnimatedGif(file);
		this.rotateAngle = 0;
		this.flipH = false;
		this.flipV = false;
		this.buildControls();
		this.state = 'editing';
		this.announce(`${file.name} loaded.`);
	}

	/**
	 * True for a multi-frame (animated) GIF. The Canvas decode path only ever sees the first frame,
	 * so animated GIFs are routed through ffmpeg (resize/crop/rotate/flip) to keep their animation.
	 * Detected by counting Graphic Control Extension blocks (`21 F9 04`) — one per frame.
	 */
	private async isAnimatedGif(file: File): Promise<boolean> {
		if (file.type !== 'image/gif' && !/\.gif$/i.test(file.name)) return false;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			let frames = 0;
			for (let i = 0; i + 3 < bytes.length; i++) {
				if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
					if (++frames > 1) return true;
				}
			}
			return false;
		} catch {
			return false;
		}
	}

	/** Whether the current mode transforms pixels (and so must preserve GIF frames via ffmpeg). */
	private get animatedMode(): boolean {
		return this.animated && (['resize', 'rotate', 'flip', 'crop'] as Mode[]).includes(this.mode);
	}

	private buildControls() {
		this.controls.innerHTML = '';
		this.preview.innerHTML = '';
		switch (this.mode) {
			case 'resize':
				this.buildResize();
				break;
			case 'rotate':
				this.buildRotate();
				break;
			case 'flip':
				this.buildFlip();
				break;
			case 'compress':
				this.buildCompress();
				break;
			case 'crop':
				this.buildCrop();
				break;
			case 'colorpicker':
				this.buildColorPicker();
				break;
		}
		if (this.animatedMode) {
			this.controls.append(
				el('p', { class: 'tool-hint' }, [
					'🎞️ Animated GIF detected — its animation will be preserved. This runs in the in-browser video engine, so the first run downloads it and may take a few seconds.',
				]),
			);
		}
	}

	private simplePreview(): HTMLImageElement {
		const img = el('img', { src: this.trackUrl(URL.createObjectURL(this.file!)), alt: '' });
		this.preview.append(img);
		return img;
	}

	// ---- resize ----
	private buildResize() {
		this.aspectLocked = true;
		this.simplePreview();
		const widthInput = el('input', { class: 'tool-input', type: 'number', min: '1', value: String(this.natural.width) });
		const heightInput = el('input', { class: 'tool-input', type: 'number', min: '1', value: String(this.natural.height) });
		const ratio = this.natural.width / this.natural.height;
		const lock = el('input', { type: 'checkbox', checked: true });
		lock.addEventListener('change', () => (this.aspectLocked = lock.checked));
		widthInput.addEventListener('input', () => {
			if (this.aspectLocked && widthInput.value) heightInput.value = String(Math.round(Number(widthInput.value) / ratio));
		});
		heightInput.addEventListener('input', () => {
			if (this.aspectLocked && heightInput.value) widthInput.value = String(Math.round(Number(heightInput.value) * ratio));
		});

		this.controls.append(
			el('div', { class: 'tool-row' }, [
				el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Width (px)']), widthInput]),
				el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Height (px)']), heightInput]),
			]),
			el('label', { class: 'tool-check' }, [lock, 'Lock aspect ratio']),
			el('p', { class: 'tool-hint' }, [`Original: ${this.natural.width} × ${this.natural.height} px`]),
		);
		this.applyBtn.onclick = async () => {
			const w = Math.max(1, Number(widthInput.value) || this.natural.width);
			const h = Math.max(1, Number(heightInput.value) || this.natural.height);
			await this.run(async () => {
				if (this.animated) {
					const { resizeGif } = await import('../lib/tools/mediaTools');
					return resizeGif(this.file!, w, h);
				}
				return resizeImage(this.file!, { width: w, height: h }, { quality: 0.92 });
			}, 'resized');
		};
	}

	// ---- rotate ----
	private buildRotate() {
		const img = this.simplePreview();
		img.style.transition = 'transform 0.2s ease';
		const readout = el('span', { class: 'tool-range-value' }, ['0°']);
		const applyTransform = () => {
			img.style.transform = `rotate(${this.rotateAngle}deg)`;
			readout.textContent = `${this.rotateAngle}°`;
		};
		const range = el('input', { class: 'tool-range', type: 'range', min: '-180', max: '180', step: '1', value: '0' });
		range.addEventListener('input', () => {
			this.rotateAngle = Number(range.value);
			applyTransform();
		});
		const left = el('button', { class: 'tool-seg', type: 'button' }, ['⟲ 90° left']);
		const right = el('button', { class: 'tool-seg', type: 'button' }, ['⟳ 90° right']);
		const flip180 = el('button', { class: 'tool-seg', type: 'button' }, ['180°']);
		const bump = (delta: number) => {
			this.rotateAngle = ((this.rotateAngle + delta + 180) % 360) - 0;
			if (this.rotateAngle > 180) this.rotateAngle -= 360;
			range.value = String(this.rotateAngle);
			applyTransform();
		};
		left.addEventListener('click', () => bump(-90));
		right.addEventListener('click', () => bump(90));
		flip180.addEventListener('click', () => bump(180));

		this.controls.append(
			el('div', { class: 'tool-field' }, [
				el('label', { class: 'tool-label' }, ['Rotate']),
				el('div', { class: 'tool-segments' }, [left, right, flip180]),
			]),
			el('div', { class: 'tool-field' }, [
				el('label', { class: 'tool-label' }, ['Fine angle']),
				range,
				readout,
			]),
		);
		this.applyBtn.onclick = () =>
			this.run(async () => {
				if (this.animated) {
					const { rotateGif } = await import('../lib/tools/mediaTools');
					return rotateGif(this.file!, this.rotateAngle);
				}
				return rotateImage(this.file!, this.rotateAngle);
			}, 'rotated');
	}

	// ---- flip ----
	private buildFlip() {
		const img = this.simplePreview();
		img.style.transition = 'transform 0.2s ease';
		const apply = () => {
			img.style.transform = `scale(${this.flipH ? -1 : 1}, ${this.flipV ? -1 : 1})`;
		};
		const h = el('button', { class: 'tool-seg', type: 'button', 'aria-pressed': 'false' } as never, ['Flip horizontal']);
		const v = el('button', { class: 'tool-seg', type: 'button', 'aria-pressed': 'false' } as never, ['Flip vertical']);
		h.addEventListener('click', () => {
			this.flipH = !this.flipH;
			h.setAttribute('aria-pressed', String(this.flipH));
			apply();
		});
		v.addEventListener('click', () => {
			this.flipV = !this.flipV;
			v.setAttribute('aria-pressed', String(this.flipV));
			apply();
		});
		this.controls.append(
			el('div', { class: 'tool-field' }, [
				el('label', { class: 'tool-label' }, ['Mirror']),
				el('div', { class: 'tool-segments' }, [h, v]),
				el('p', { class: 'tool-hint' }, ['Pick one or both directions.']),
			]),
		);
		this.applyBtn.onclick = async () => {
			if (!this.flipH && !this.flipV) {
				this.showError('Choose horizontal or vertical flip first.');
				return;
			}
			await this.run(async () => {
				if (this.animated) {
					const { flipGif } = await import('../lib/tools/mediaTools');
					return flipGif(this.file!, this.flipH, this.flipV);
				}
				let current: File = this.file!;
				let ext = 'png';
				if (this.flipH) {
					const r = await flipImage(current, 'horizontal');
					current = new File([r.blob], this.file!.name, { type: r.blob.type });
					ext = r.ext;
				}
				if (this.flipV) {
					const r = await flipImage(current, 'vertical');
					current = new File([r.blob], this.file!.name, { type: r.blob.type });
					ext = r.ext;
				}
				return { blob: current, ext };
			}, 'flipped');
		};
	}

	// ---- compress ----
	private buildCompress() {
		this.simplePreview();
		const format = el('select', { class: 'tool-select' }, [
			el('option', { value: 'image/jpeg' }, ['JPEG (smallest)']),
			el('option', { value: 'image/webp' }, ['WebP (modern)']),
		]);

		// Mode toggle: dial a quality, or aim for a target file size.
		let mode: 'quality' | 'target' = 'quality';
		const modeSeg = el('div', { class: 'tool-segments' });
		const qualityBtn = el('button', { class: 'tool-seg', type: 'button', 'aria-pressed': 'true' } as never, ['By quality']);
		const targetBtn = el('button', { class: 'tool-seg', type: 'button', 'aria-pressed': 'false' } as never, ['Target size']);
		modeSeg.append(qualityBtn, targetBtn);

		// --- quality controls ---
		const quality = el('input', { class: 'tool-range', type: 'range', min: '30', max: '95', step: '1', value: '75' });
		const qLabel = el('span', { class: 'tool-range-value' }, ['75%']);
		const estimate = el('p', { class: 'tool-hint' }, ['Adjust quality to preview the new size.']);
		const schedule = () => {
			qLabel.textContent = `${quality.value}%`;
			window.clearTimeout(this.compressTimer);
			this.compressTimer = window.setTimeout(async () => {
				try {
					const { blob } = await compressImage(this.file!, {
						quality: Number(quality.value) / 100,
						mime: format.value as 'image/jpeg' | 'image/webp',
					});
					const saved = 1 - blob.size / this.file!.size;
					estimate.textContent = `Estimated: ${formatBytes(blob.size)} — ${saved > 0 ? `${Math.round(saved * 100)}% smaller` : 'no saving'}`;
				} catch {
					/* preview estimate is best-effort */
				}
			}, 250);
		};
		quality.addEventListener('input', schedule);
		format.addEventListener('change', schedule);
		schedule();
		const qualityWrap = el('div', {}, [
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Quality']), quality, qLabel]),
			estimate,
		]);

		// --- target-size controls: a slider ("dragger") from a small floor up to the original
		// size. As it moves we run the real compressor (debounced) and show the size the file
		// will actually become, so the user sees the outcome before hitting Compress.
		const origBytes = this.file!.size;
		const minBytes = Math.max(10 * 1024, Math.round(origBytes * 0.05));
		const startBytes = Math.min(origBytes, Math.max(minBytes, Math.round(origBytes * 0.5)));
		const targetRange = el('input', {
			class: 'tool-range',
			type: 'range',
			min: String(minBytes),
			max: String(origBytes),
			step: String(Math.max(1024, Math.round(origBytes / 200))),
			value: String(startBytes),
		});
		const targetValue = el('span', { class: 'tool-range-value' }, [formatBytes(startBytes)]);
		const targetResult = el('p', { class: 'tool-hint' }, ['Drag to choose a target size.']);
		let targetTimer: number | undefined;
		const previewTarget = () => {
			const targetBytes = Number(targetRange.value);
			targetValue.textContent = formatBytes(targetBytes);
			window.clearTimeout(targetTimer);
			targetResult.textContent = 'Estimating…';
			targetTimer = window.setTimeout(async () => {
				try {
					const { blob, underTarget } = await compressImageToTarget(this.file!, {
						targetBytes,
						mime: format.value as 'image/jpeg' | 'image/webp',
					});
					const saved = 1 - blob.size / origBytes;
					const savingNote = saved > 0.01 ? ` — ${Math.round(saved * 100)}% smaller` : '';
					targetResult.textContent = underTarget
						? `Result: ~${formatBytes(blob.size)}${savingNote}`
						: `Can’t go this small — closest is ~${formatBytes(blob.size)}`;
				} catch {
					/* preview estimate is best-effort */
				}
			}, 300);
		};
		targetRange.addEventListener('input', previewTarget);
		format.addEventListener('change', () => {
			if (mode === 'target') previewTarget();
		});
		const targetWrap = el('div', {}, [
			el('div', { class: 'tool-field' }, [
				el('div', { class: 'tool-slider-head' }, [el('label', { class: 'tool-label' }, ['Target size']), targetValue]),
				targetRange,
			]),
			targetResult,
			el('p', { class: 'tool-hint' }, [
				`Original is ${formatBytes(origBytes)}. We lower quality (and shrink if needed) to land under your target.`,
			]),
		]);
		targetWrap.hidden = true;

		const setMode = (next: 'quality' | 'target') => {
			mode = next;
			qualityBtn.setAttribute('aria-pressed', String(next === 'quality'));
			targetBtn.setAttribute('aria-pressed', String(next === 'target'));
			qualityWrap.hidden = next !== 'quality';
			targetWrap.hidden = next !== 'target';
			if (next === 'target') previewTarget();
		};
		qualityBtn.addEventListener('click', () => setMode('quality'));
		targetBtn.addEventListener('click', () => setMode('target'));

		this.controls.append(
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Output format']), format]),
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Mode']), modeSeg]),
			qualityWrap,
			targetWrap,
		);
		this.applyBtn.onclick = () => {
			const mime = format.value as 'image/jpeg' | 'image/webp';
			if (mode === 'target') {
				const targetBytes = Number(targetRange.value);
				if (!targetBytes) {
					this.showError('Choose a target size greater than zero.');
					return;
				}
				this.run(() => compressImageToTarget(this.file!, { targetBytes, mime }), 'compressed');
			} else {
				this.run(() => compressImage(this.file!, { quality: Number(quality.value) / 100, mime }), 'compressed');
			}
		};
	}

	// ---- crop ----
	private buildCrop() {
		const stage = el('div', { class: 'tool-crop-stage' });
		const img = el('img', { src: this.trackUrl(URL.createObjectURL(this.file!)), alt: '', draggable: false });
		const shade = el('div', { class: 'tool-crop-shade' });
		for (const pos of ['nw', 'ne', 'sw', 'se']) {
			const h = el('div', { class: `tool-crop-handle handle-${pos}` });
			h.dataset.handle = pos;
			shade.append(h);
		}
		stage.append(img, shade);
		this.preview.innerHTML = '';
		this.preview.append(stage);

		const readout = el('p', { class: 'tool-hint' }, ['Drag to move, corners to resize.']);
		this.controls.append(
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Crop area']), readout]),
		);

		// Selection is stored in displayed pixels; converted to natural on apply.
		let sel = { x: 0, y: 0, w: 0, h: 0 };
		const initSel = () => {
			const w = img.clientWidth;
			const h = img.clientHeight;
			sel = { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 };
			paint();
		};
		const paint = () => {
			shade.style.left = `${sel.x}px`;
			shade.style.top = `${sel.y}px`;
			shade.style.width = `${sel.w}px`;
			shade.style.height = `${sel.h}px`;
			const scale = this.natural.width / img.clientWidth;
			readout.textContent = `${Math.round(sel.w * scale)} × ${Math.round(sel.h * scale)} px`;
		};

		let drag: { type: 'move' | string; sx: number; sy: number; orig: typeof sel } | null = null;
		const onDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement;
			const handle = target.dataset.handle;
			drag = { type: handle ?? 'move', sx: e.clientX, sy: e.clientY, orig: { ...sel } };
			(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
			e.preventDefault();
		};
		const onMove = (e: PointerEvent) => {
			if (!drag) return;
			const dx = e.clientX - drag.sx;
			const dy = e.clientY - drag.sy;
			const maxW = img.clientWidth;
			const maxH = img.clientHeight;
			const o = drag.orig;
			if (drag.type === 'move') {
				sel.x = Math.min(Math.max(0, o.x + dx), maxW - o.w);
				sel.y = Math.min(Math.max(0, o.y + dy), maxH - o.h);
			} else {
				let { x, y, w, h } = o;
				if (drag.type.includes('e')) w = Math.min(o.w + dx, maxW - o.x);
				if (drag.type.includes('s')) h = Math.min(o.h + dy, maxH - o.y);
				if (drag.type.includes('w')) {
					x = Math.min(Math.max(0, o.x + dx), o.x + o.w - 20);
					w = o.w + (o.x - x);
				}
				if (drag.type.includes('n')) {
					y = Math.min(Math.max(0, o.y + dy), o.y + o.h - 20);
					h = o.h + (o.y - y);
				}
				sel = { x, y, w: Math.max(20, w), h: Math.max(20, h) };
			}
			paint();
		};
		const onUp = () => (drag = null);
		shade.addEventListener('pointerdown', onDown);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);

		if (img.complete) initSel();
		else img.addEventListener('load', initSel);

		this.applyBtn.onclick = () => {
			const scale = this.natural.width / img.clientWidth;
			const rect: CropRect = {
				x: sel.x * scale,
				y: sel.y * scale,
				width: sel.w * scale,
				height: sel.h * scale,
			};
			this.run(async () => {
				if (this.animated) {
					const { cropGif } = await import('../lib/tools/mediaTools');
					return cropGif(this.file!, rect);
				}
				return cropImage(this.file!, rect);
			}, 'cropped');
		};
	}

	// ---- color picker ----
	private async buildColorPicker() {
		this.applyBtn.style.display = 'none';
		const canvas = el('canvas');
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		const { source, width, height, cleanup } = await decodeImage(this.file!);
		const scale = Math.min(1, 900 / Math.max(width, height));
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
		cleanup();
		canvas.style.cursor = 'crosshair';
		this.preview.append(canvas);

		const swatch = el('div', { class: 'tool-swatch' });
		const hexRow = el('div', { class: 'tool-swatch-value' });
		const hexText = el('span', {}, ['#RRGGBB']);
		const copyHex = el('button', { class: 'tool-copy', type: 'button' }, ['Copy']);
		hexRow.append(hexText, copyHex);
		const rgbRow = el('div', { class: 'tool-swatch-value' });
		const rgbText = el('span', {}, ['rgb(–, –, –)']);
		const copyRgb = el('button', { class: 'tool-copy', type: 'button' }, ['Copy']);
		rgbRow.append(rgbText, copyRgb);
		const recent = el('div', { class: 'tool-recent' });

		this.controls.append(
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Picked color']), swatch]),
			hexRow,
			rgbRow,
			el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Recent']), recent]),
			el('p', { class: 'tool-hint' }, ['Click anywhere on the image to sample a color.']),
		);

		const toHex = (n: number) => n.toString(16).padStart(2, '0');
		const sample = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
			const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
			const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
			const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
			const rgb = `rgb(${r}, ${g}, ${b})`;
			swatch.style.background = hex;
			hexText.textContent = hex;
			rgbText.textContent = rgb;
			const chip = el('button', { class: 'tool-recent-swatch', type: 'button', title: hex });
			chip.style.background = hex;
			chip.addEventListener('click', () => {
				swatch.style.background = hex;
				hexText.textContent = hex;
				rgbText.textContent = rgb;
			});
			recent.prepend(chip);
			while (recent.children.length > 12) recent.lastChild?.remove();
		};
		canvas.addEventListener('click', sample);
		const copy = (text: string, btn: HTMLElement) => {
			navigator.clipboard?.writeText(text).then(() => {
				const prev = btn.textContent;
				btn.textContent = 'Copied';
				setTimeout(() => (btn.textContent = prev), 1200);
			});
		};
		copyHex.addEventListener('click', () => copy(hexText.textContent!, copyHex));
		copyRgb.addEventListener('click', () => copy(rgbText.textContent!, copyRgb));
	}

	private async run(op: () => Promise<{ blob: Blob; ext: string }>, suffix: string) {
		if (!this.file) return;
		this.state = 'working';
		this.announce('Processing…');
		try {
			const { blob, ext } = await op();
			const filename = suffixName(this.file.name, suffix, ext);
			const url = this.trackUrl(URL.createObjectURL(blob));
			this.downloadLink.href = url;
			this.downloadLink.download = filename;

			this.resultPreview.innerHTML = '';
			if (blob.type.startsWith('image/')) {
				this.resultPreview.append(el('img', { src: url, alt: '' }));
			}

			const saved = 1 - blob.size / this.file.size;
			const savingNote =
				suffix === 'compressed' && saved > 0.01 ? ` · ${Math.round(saved * 100)}% smaller` : '';
			this.doneMeta.innerHTML = `${filename} · ${formatBytes(blob.size)}<span class="tool-saving">${savingNote}</span>`;
			this.state = 'done';
			this.announce('Done. Your file is ready to download.');
		} catch (err) {
			this.showError(err instanceof Error ? err.message : 'Something went wrong.');
		}
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
		this.animated = false;
		this.fileInput.value = '';
		this.applyBtn.style.display = '';
		this.state = 'idle';
	}
}

customElements.define('image-tool', ImageTool);
