import {
	detectCategory,
	fileMatchesSourceExt,
	formatBytes,
	getAvailableTargets,
	getExtension,
	MAX_FILE_SIZE_BYTES,
	type TargetOption,
} from '../lib/formats';
import { ConversionError, convertFile } from '../lib/converter';

type ConverterState = 'idle' | 'dragging' | 'file-selected' | 'converting' | 'done' | 'error';

class FileConverter extends HTMLElement {
	private dropzone!: HTMLElement;
	private fileInput!: HTMLInputElement;
	private fileNameEl!: HTMLElement;
	private fileSizeEl!: HTMLElement;
	private changeFileBtn!: HTMLButtonElement;
	private formatGridPopular!: HTMLElement;
	private formatGridAudioWrap!: HTMLElement;
	private formatGridAudio!: HTMLElement;
	private formatGridAll!: HTMLElement;
	private convertBtn!: HTMLButtonElement;
	private progressTrack!: HTMLElement;
	private progressFill!: HTMLElement;
	private progressLabel!: HTMLElement;
	private progressPercent!: HTMLElement;
	private loaderRing!: HTMLElement;
	private doneMeta!: HTMLElement;
	private downloadLink!: HTMLAnchorElement;
	private resetBtn!: HTMLButtonElement;
	private retryBtn!: HTMLButtonElement;
	private errorMessageEl!: HTMLElement;
	private errorActionEl!: HTMLAnchorElement;
	private statusAnnouncer!: HTMLElement;

	private currentFile: File | null = null;
	private selectedExt: string | null = null;
	private objectUrl: string | null = null;
	private dragCounter = 0;
	private presetTarget: string | null = null;
	private presetSource: string | null = null;
	private presetSourceLabel: string | null = null;
	private presetTargetLabel: string | null = null;

	connectedCallback() {
		this.dropzone = this.query('[data-role="dropzone"]');
		this.fileInput = this.query<HTMLInputElement>('[data-role="file-input"]');
		this.fileNameEl = this.query('[data-role="file-name"]');
		this.fileSizeEl = this.query('[data-role="file-size"]');
		this.changeFileBtn = this.query<HTMLButtonElement>('[data-role="change-file"]');
		this.formatGridPopular = this.query('[data-role="format-grid-popular"]');
		this.formatGridAudioWrap = this.query('[data-role="format-group-audio"]');
		this.formatGridAudio = this.query('[data-role="format-grid-audio"]');
		this.formatGridAll = this.query('[data-role="format-grid-all"]');
		this.convertBtn = this.query<HTMLButtonElement>('[data-role="convert-button"]');
		this.progressTrack = this.query('[data-role="progress-track"]');
		this.progressFill = this.query('[data-role="progress-fill"]');
		this.progressLabel = this.query('[data-role="progress-label"]');
		this.progressPercent = this.query('[data-role="progress-percent"]');
		this.loaderRing = this.query('[data-role="loader-ring"]');
		this.doneMeta = this.query('[data-role="done-meta"]');
		this.downloadLink = this.query<HTMLAnchorElement>('[data-role="download-link"]');
		this.resetBtn = this.query<HTMLButtonElement>('[data-role="reset-button"]');
		this.retryBtn = this.query<HTMLButtonElement>('[data-role="retry-button"]');
		this.errorMessageEl = this.query('[data-role="error-message"]');
		this.errorActionEl = this.query<HTMLAnchorElement>('[data-role="error-action"]');
		this.statusAnnouncer = this.query('[data-role="status-announcer"]');

		this.presetTarget = this.dataset.presetTarget?.toLowerCase() || null;
		this.presetSource = this.dataset.presetSource?.toLowerCase() || null;
		this.presetSourceLabel = this.dataset.presetSourceLabel || null;
		this.presetTargetLabel = this.dataset.presetTargetLabel || null;

		this.wireEvents();
	}

	private query<T extends HTMLElement = HTMLElement>(selector: string): T {
		const el = this.querySelector(selector);
		if (!el) throw new Error(`file-converter: missing element for ${selector}`);
		return el as T;
	}

	private setState(state: ConverterState) {
		this.dataset.state = state;
	}

	private wireEvents() {
		this.dropzone.addEventListener('click', () => this.fileInput.click());
		this.dropzone.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				this.fileInput.click();
			}
		});

		this.dropzone.addEventListener('dragenter', (event) => {
			event.preventDefault();
			this.dragCounter++;
			this.setState('dragging');
		});
		this.dropzone.addEventListener('dragover', (event) => event.preventDefault());
		this.dropzone.addEventListener('dragleave', (event) => {
			event.preventDefault();
			this.dragCounter = Math.max(0, this.dragCounter - 1);
			if (this.dragCounter === 0) this.setState('idle');
		});
		this.dropzone.addEventListener('drop', (event) => {
			event.preventDefault();
			this.dragCounter = 0;
			const file = event.dataTransfer?.files?.[0];
			if (file) this.selectFile(file);
			else this.setState('idle');
		});

		this.fileInput.addEventListener('change', () => {
			const file = this.fileInput.files?.[0];
			if (file) this.selectFile(file);
		});

		this.changeFileBtn.addEventListener('click', () => this.fileInput.click());
		this.resetBtn.addEventListener('click', () => this.reset());
		this.retryBtn.addEventListener('click', () => {
			// After a conversion error the file is still valid — go back to the format picker.
			// After a rejection (bad type/format/size) there's no valid file — reopen the chooser.
			if (this.currentFile) this.setState('file-selected');
			else this.fileInput.click();
		});
		this.convertBtn.addEventListener('click', () => this.runConversion());
	}

	private selectFile(file: File) {
		const category = detectCategory(file);
		if (!category) {
			this.currentFile = null;
			this.showError("We don't support that file type yet. Try an image, video, audio, PDF, or Word file.");
			return;
		}

		// On an exact-conversion page (e.g. /png-to-jpg) the source format is fixed — reject a file
		// that isn't that format instead of silently offering a different conversion. The homepage
		// and category hubs leave presetSource unset, so they keep auto-detecting whatever is dropped.
		if (this.presetSource && !fileMatchesSourceExt(file.name, this.presetSource)) {
			this.currentFile = null;
			const expected = (this.presetSourceLabel || this.presetSource.toUpperCase()).trim();
			const target = this.presetTargetLabel || this.presetTarget?.toUpperCase() || '';
			const droppedExt = getExtension(file.name);
			const dropped = droppedExt ? `a ${droppedExt.toUpperCase()} file` : 'a different file type';
			this.showError(
				`This converter turns ${expected} files into ${target}, but you dropped ${dropped}. ` +
					`Drop a ${expected} file to continue, or use the all-in-one converter to convert this file.`,
				{ label: 'Use the all-in-one converter', href: '/' },
			);
			return;
		}

		const maxBytes = MAX_FILE_SIZE_BYTES[category];
		if (file.size > maxBytes) {
			this.currentFile = null;
			this.showError(
				`This ${category} file is ${formatBytes(file.size)} — ${category} files are limited to ${formatBytes(maxBytes)} so conversions stay fast. Try a smaller file.`,
			);
			return;
		}

		this.currentFile = file;
		this.selectedExt = null;
		this.fileNameEl.textContent = file.name;
		this.fileSizeEl.textContent = formatBytes(file.size);

		const sourceExt = getExtension(file.name);
		const targets = getAvailableTargets(category, sourceExt);
		const convertTargets = targets.filter((t) => t.group === 'convert');
		const audioTargets = targets.filter((t) => t.group === 'extract-audio');

		this.renderGrid(this.formatGridPopular, convertTargets.filter((t) => t.popular));
		this.renderGrid(this.formatGridAll, convertTargets.filter((t) => !t.popular));

		if (audioTargets.length > 0) {
			this.formatGridAudioWrap.hidden = false;
			this.renderGrid(this.formatGridAudio, audioTargets);
		} else {
			this.formatGridAudioWrap.hidden = true;
			this.formatGridAudio.innerHTML = '';
		}

		this.convertBtn.disabled = true;
		this.setState('file-selected');

		// On a per-conversion landing page (e.g. /png-to-jpg) the target is known up front —
		// auto-select it so the user only has to pick a file and hit Convert.
		if (this.presetTarget && this.autoSelectTarget(this.presetTarget)) {
			this.announce(`${file.name} selected. Ready to convert to ${this.presetTarget.toUpperCase()}.`);
		} else {
			this.announce(`${file.name} selected. Choose a format to convert to.`);
		}
	}

	/** Selects the chip matching `ext` if the current file offers it. Returns whether it did. */
	private autoSelectTarget(ext: string): boolean {
		const chip = this.querySelector<HTMLButtonElement>(`.format-chip[data-ext="${ext}"]`);
		if (!chip) return false;
		// Reveal the collapsed "Show all formats" group if the target lives inside it.
		const details = chip.closest('details.format-more');
		if (details) (details as HTMLDetailsElement).open = true;
		chip.click();
		return true;
	}

	private renderGrid(container: HTMLElement, options: TargetOption[]) {
		container.innerHTML = '';
		for (const option of options) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'format-chip';
			btn.textContent = option.label;
			btn.dataset.ext = option.ext;
			btn.setAttribute('aria-pressed', 'false');
			btn.addEventListener('click', () => this.pickFormat(option, btn));
			container.appendChild(btn);
		}
	}

	private pickFormat(option: TargetOption, selectedBtn: HTMLButtonElement) {
		this.selectedExt = option.ext;
		this.querySelectorAll('.format-chip').forEach((chip) => {
			chip.setAttribute('aria-pressed', String(chip === selectedBtn));
		});
		this.convertBtn.disabled = false;
	}

	private async runConversion() {
		if (!this.currentFile || !this.selectedExt) return;
		this.setState('converting');
		this.progressFill.style.width = '0%';
		this.progressTrack.setAttribute('aria-valuenow', '0');
		this.progressLabel.textContent = 'Converting…';
		this.progressPercent.textContent = '0%';
		this.loaderRing.style.setProperty('--progress-ratio', '0');
		this.announce('Converting your file.');

		try {
			const { blob, filename } = await convertFile(this.currentFile, this.selectedExt, {
				onProgress: (ratio) => {
					const percent = Math.round(ratio * 100);
					this.progressFill.style.width = `${percent}%`;
					this.progressTrack.setAttribute('aria-valuenow', String(percent));
					this.progressPercent.textContent = `${percent}%`;
					this.loaderRing.style.setProperty('--progress-ratio', String(ratio));
				},
			});

			if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = URL.createObjectURL(blob);
			this.downloadLink.href = this.objectUrl;
			this.downloadLink.download = filename;
			this.doneMeta.textContent = `${filename} · ${formatBytes(blob.size)}`;
			this.announce('Conversion complete. Your file is ready to download.');
			this.setState('done');
		} catch (err) {
			const message = err instanceof ConversionError ? err.message : 'Something went wrong during conversion.';
			this.showError(message);
		}
	}

	private showError(message: string, action?: { label: string; href: string }) {
		this.errorMessageEl.textContent = message;
		// A conversion failure keeps the file (retry a different target); a rejected file needs a new one.
		this.retryBtn.textContent = this.currentFile ? 'Try a different format' : 'Choose a different file';
		if (action) {
			this.errorActionEl.textContent = action.label;
			this.errorActionEl.href = action.href;
			this.errorActionEl.hidden = false;
		} else {
			this.errorActionEl.hidden = true;
		}
		this.announce(message);
		this.setState('error');
	}

	private announce(message: string) {
		this.statusAnnouncer.textContent = message;
	}

	private reset() {
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
		this.currentFile = null;
		this.selectedExt = null;
		this.fileInput.value = '';
		this.setState('idle');
	}
}

customElements.define('file-converter', FileConverter);
