import { formatBytes } from '../lib/formats';

type Mode = 'merge' | 'split' | 'rotate' | 'remove' | 'extract';
type State = 'idle' | 'dragging' | 'editing' | 'working' | 'done' | 'error';

const MAX_BYTES = 100 * 1024 * 1024; // matches the document cap in formats.ts

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

function isPdf(file: File): boolean {
	return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function baseName(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? name : name.slice(0, dot);
}

class PdfTool extends HTMLElement {
	private mode!: Mode;
	private dropzone!: HTMLElement;
	private fileInput!: HTMLInputElement;
	private filebar!: HTMLElement;
	private fileNameEl!: HTMLElement;
	private fileSizeEl!: HTMLElement;
	private controls!: HTMLElement;
	private workarea!: HTMLElement;
	private applyBtn!: HTMLButtonElement;
	private doneMeta!: HTMLElement;
	private downloadLink!: HTMLAnchorElement;
	private errorMsg!: HTMLElement;
	private statusEl!: HTMLElement;
	private workLabel!: HTMLElement;

	private files: File[] = []; // merge mode
	private file: File | null = null; // page modes
	private selected = new Set<number>();
	private rotateAngle = 90;
	private objectUrl: string | null = null;
	private dragCounter = 0;

	connectedCallback() {
		this.mode = (this.dataset.mode as Mode) || 'merge';
		this.dropzone = this.q('[data-role="dropzone"]');
		this.fileInput = this.q('[data-role="file-input"]');
		this.filebar = this.q('[data-role="filebar"]');
		this.fileNameEl = this.q('[data-role="file-name"]');
		this.fileSizeEl = this.q('[data-role="file-size"]');
		this.controls = this.q('[data-role="controls"]');
		this.workarea = this.q('[data-role="workarea"]');
		this.applyBtn = this.q('[data-role="apply"]');
		this.doneMeta = this.q('[data-role="done-meta"]');
		this.downloadLink = this.q('[data-role="download"]');
		this.errorMsg = this.q('[data-role="error-message"]');
		this.statusEl = this.q('[data-role="status"]');
		this.workLabel = this.q('[data-role="work-label"]');
		if (this.dataset.actionLabel) this.applyBtn.textContent = this.dataset.actionLabel;
		this.wire();
	}

	private q<T extends HTMLElement = HTMLElement>(sel: string): T {
		const node = this.querySelector(sel);
		if (!node) throw new Error(`pdf-tool: missing ${sel}`);
		return node as T;
	}

	private set state(s: State) {
		this.dataset.state = s;
	}

	private announce(msg: string) {
		this.statusEl.textContent = msg;
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
			const dropped = Array.from(e.dataTransfer?.files ?? []);
			if (dropped.length) this.acceptFiles(dropped);
			else this.state = 'idle';
		});
		this.fileInput.addEventListener('change', () => {
			const picked = Array.from(this.fileInput.files ?? []);
			if (picked.length) this.acceptFiles(picked);
			this.fileInput.value = '';
		});
		this.q('[data-role="change-file"]').addEventListener('click', () => this.fileInput.click());
		this.q('[data-role="restart"]').addEventListener('click', () => this.reset());
		this.q('[data-role="retry"]').addEventListener('click', () => this.reset());
		this.applyBtn.addEventListener('click', () => this.apply());
	}

	private acceptFiles(incoming: File[]) {
		const pdfs = incoming.filter(isPdf);
		if (!pdfs.length) {
			this.showError('Please choose PDF files.');
			return;
		}
		const tooBig = pdfs.find((f) => f.size > MAX_BYTES);
		if (tooBig) {
			this.showError(`"${tooBig.name}" is ${formatBytes(tooBig.size)} — PDFs are limited to ${formatBytes(MAX_BYTES)}.`);
			return;
		}
		if (this.mode === 'merge') {
			this.files.push(...pdfs);
			this.buildMerge();
			this.state = 'editing';
		} else {
			this.file = pdfs[0];
			this.filebar.hidden = false;
			this.fileNameEl.textContent = this.file.name;
			this.fileSizeEl.textContent = formatBytes(this.file.size);
			this.state = 'editing';
			this.buildPageMode();
		}
	}

	// ---- merge ----
	private buildMerge() {
		this.controls.innerHTML = '';
		this.workarea.innerHTML = '';
		this.controls.append(
			el('p', { class: 'tool-hint' }, ['Files merge top to bottom. Reorder or remove, then merge.']),
		);
		const list = el('div', { class: 'tool-filelist' });
		this.files.forEach((f, i) => {
			const up = el('button', { class: 'tool-iconbtn', type: 'button', title: 'Move up', disabled: i === 0 } as never, ['↑']);
			const down = el('button', { class: 'tool-iconbtn', type: 'button', title: 'Move down', disabled: i === this.files.length - 1 } as never, ['↓']);
			const del = el('button', { class: 'tool-iconbtn', type: 'button', title: 'Remove' }, ['✕']);
			up.addEventListener('click', () => this.reorder(i, i - 1));
			down.addEventListener('click', () => this.reorder(i, i + 1));
			del.addEventListener('click', () => this.removeFile(i));
			list.append(
				el('div', { class: 'tool-fileitem' }, [
					el('span', { class: 'tool-fileitem-name' }, [`${i + 1}. ${f.name}`]),
					el('span', { class: 'tool-filesize' }, [formatBytes(f.size)]),
					up,
					down,
					del,
				]),
			);
		});
		const addMore = el('button', { class: 'tool-ghost', type: 'button' }, ['+ Add more PDFs']);
		addMore.addEventListener('click', () => this.fileInput.click());
		this.workarea.append(list, addMore);
		this.applyBtn.disabled = this.files.length < 2;
	}

	private reorder(from: number, to: number) {
		if (to < 0 || to >= this.files.length) return;
		const [moved] = this.files.splice(from, 1);
		this.files.splice(to, 0, moved);
		this.buildMerge();
	}

	private removeFile(i: number) {
		this.files.splice(i, 1);
		if (this.files.length === 0) {
			this.reset();
			return;
		}
		this.buildMerge();
	}

	// ---- page modes (split / rotate / remove / extract) ----
	private async buildPageMode() {
		this.controls.innerHTML = '';
		this.workarea.innerHTML = '';
		this.selected.clear();

		const hint: Record<Exclude<Mode, 'merge'>, string> = {
			rotate: 'Select pages to rotate, or leave all unselected to rotate every page.',
			split: 'Select pages to split into separate files, or leave all unselected to split every page.',
			remove: 'Select the pages you want to delete.',
			extract: 'Select the pages you want to keep.',
		};

		if (this.mode === 'rotate') {
			const seg = el('div', { class: 'tool-segments' });
			[90, 180, 270].forEach((a) => {
				const b = el('button', { class: 'tool-seg', type: 'button' }, [`${a}°`]);
				b.setAttribute('aria-pressed', String(a === this.rotateAngle));
				b.addEventListener('click', () => {
					this.rotateAngle = a;
					seg.querySelectorAll('.tool-seg').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
					this.repaintRotation();
				});
				seg.append(b);
			});
			this.controls.append(el('div', { class: 'tool-field' }, [el('label', { class: 'tool-label' }, ['Rotation']), seg]));
		}

		const selAll = el('button', { class: 'tool-ghost', type: 'button' }, ['Select all']);
		const clear = el('button', { class: 'tool-ghost', type: 'button' }, ['Clear']);
		selAll.addEventListener('click', () => this.setAllSelected(true));
		clear.addEventListener('click', () => this.setAllSelected(false));
		this.controls.append(
			el('p', { class: 'tool-hint' }, [hint[this.mode as Exclude<Mode, 'merge'>]]),
			el('div', { class: 'tool-segments', style: 'margin-top: var(--space-xs)' } as never, [selAll, clear]),
		);

		const grid = el('div', { class: 'tool-pagegrid' });
		const loading = el('p', { class: 'tool-hint' }, ['Rendering pages…']);
		this.workarea.append(grid, loading);
		this.applyBtn.disabled = true;

		try {
			const { renderThumbnails } = await import('../lib/tools/pdfTools');
			await renderThumbnails(this.file!, {
				onThumb: ({ page, dataUrl }) => {
					const img = el('img', { src: dataUrl, alt: `Page ${page}`, loading: 'lazy' } as never);
					const check = el('span', { class: 'tool-page-check' }, ['✓']);
					const num = el('span', { class: 'tool-page-num' }, [String(page)]);
					const btn = el('button', { class: 'tool-page', type: 'button', 'aria-pressed': 'false' } as never, [img, check, num]);
					btn.dataset.page = String(page);
					btn.addEventListener('click', () => this.togglePage(page, btn, img));
					grid.append(btn);
				},
			});
			loading.remove();
			this.updateApplyState();
		} catch {
			this.showError('This PDF could not be read. It may be password-protected or corrupt.');
		}
	}

	private togglePage(page: number, btn: HTMLButtonElement, img: HTMLImageElement) {
		if (this.selected.has(page)) this.selected.delete(page);
		else this.selected.add(page);
		btn.setAttribute('aria-pressed', String(this.selected.has(page)));
		if (this.mode === 'rotate') img.style.transform = this.selected.has(page) ? `rotate(${this.rotateAngle}deg)` : '';
		this.updateApplyState();
	}

	private setAllSelected(on: boolean) {
		this.workarea.querySelectorAll<HTMLButtonElement>('.tool-page').forEach((btn) => {
			const page = Number(btn.dataset.page);
			const img = btn.querySelector('img')!;
			if (on) this.selected.add(page);
			else this.selected.delete(page);
			btn.setAttribute('aria-pressed', String(on));
			if (this.mode === 'rotate') img.style.transform = on ? `rotate(${this.rotateAngle}deg)` : '';
		});
		this.updateApplyState();
	}

	private repaintRotation() {
		this.workarea.querySelectorAll<HTMLButtonElement>('.tool-page').forEach((btn) => {
			const page = Number(btn.dataset.page);
			const img = btn.querySelector('img')!;
			img.style.transform = this.selected.has(page) ? `rotate(${this.rotateAngle}deg)` : '';
		});
	}

	private updateApplyState() {
		if (this.mode === 'remove' || this.mode === 'extract') this.applyBtn.disabled = this.selected.size === 0;
		else this.applyBtn.disabled = false; // rotate / split allow "all"
	}

	private async apply() {
		this.state = 'working';
		this.workLabel.textContent = this.mode === 'merge' ? 'Merging…' : 'Working…';
		this.announce('Processing your PDF.');
		try {
			const pdf = await import('../lib/tools/pdfTools');
			let blob: Blob;
			let filename: string;
			const pages = [...this.selected].sort((a, b) => a - b);

			if (this.mode === 'merge') {
				blob = await pdf.mergePdfs(this.files);
				filename = 'merged.pdf';
			} else if (this.mode === 'rotate') {
				blob = await pdf.rotatePdf(this.file!, this.rotateAngle, pages);
				filename = `${baseName(this.file!.name)}-rotated.pdf`;
			} else if (this.mode === 'remove') {
				blob = await pdf.removePages(this.file!, pages);
				filename = `${baseName(this.file!.name)}-pages-removed.pdf`;
			} else if (this.mode === 'extract') {
				blob = await pdf.extractPages(this.file!, pages);
				filename = `${baseName(this.file!.name)}-extracted.pdf`;
			} else {
				blob = await pdf.splitToZip(this.file!, pages, baseName(this.file!.name));
				filename = `${baseName(this.file!.name)}-split.zip`;
			}

			if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = URL.createObjectURL(blob);
			this.downloadLink.href = this.objectUrl;
			this.downloadLink.download = filename;
			this.doneMeta.textContent = `${filename} · ${formatBytes(blob.size)}`;
			this.state = 'done';
			this.announce('Done. Your file is ready to download.');
		} catch (err) {
			this.showError(err instanceof Error ? err.message : 'Something went wrong processing the PDF.');
		}
	}

	private showError(message: string) {
		this.errorMsg.textContent = message;
		this.announce(message);
		this.state = 'error';
	}

	private reset() {
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
		this.files = [];
		this.file = null;
		this.selected.clear();
		this.filebar.hidden = true;
		this.fileInput.value = '';
		this.controls.innerHTML = '';
		this.workarea.innerHTML = '';
		this.state = 'idle';
	}
}

customElements.define('pdf-tool', PdfTool);
