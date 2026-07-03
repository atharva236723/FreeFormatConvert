import { CATEGORIES, convert, findCategory, formatResult, type UnitCategory } from '../lib/tools/units';

class UnitConverter extends HTMLElement {
	private category!: UnitCategory;
	private fromValue!: HTMLInputElement;
	private fromUnit!: HTMLSelectElement;
	private toValue!: HTMLInputElement;
	private toUnit!: HTMLSelectElement;
	private formula!: HTMLElement;
	private cats: HTMLElement | null = null;

	connectedCallback() {
		this.category = (this.dataset.preset && findCategory(this.dataset.preset)) || CATEGORIES[0];
		this.fromValue = this.q('[data-role="from-value"]');
		this.fromUnit = this.q('[data-role="from-unit"]');
		this.toValue = this.q('[data-role="to-value"]');
		this.toUnit = this.q('[data-role="to-unit"]');
		this.formula = this.q('[data-role="formula"]');
		this.cats = this.querySelector('[data-role="cats"]');

		this.fromValue.addEventListener('input', () => this.compute());
		this.fromUnit.addEventListener('change', () => this.compute());
		this.toUnit.addEventListener('change', () => this.compute());
		this.q('[data-role="swap"]').addEventListener('click', () => this.swap());

		this.cats?.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((btn) => {
			btn.addEventListener('click', () => this.switchCategory(btn.dataset.cat!, btn));
		});

		this.compute();
	}

	private q<T extends HTMLElement = HTMLElement>(sel: string): T {
		const node = this.querySelector(sel);
		if (!node) throw new Error(`unit-converter: missing ${sel}`);
		return node as T;
	}

	private switchCategory(id: string, btn: HTMLButtonElement) {
		const cat = findCategory(id);
		if (!cat) return;
		this.category = cat;
		this.cats?.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
		this.populate(this.fromUnit, 0);
		this.populate(this.toUnit, 1);
		this.fromValue.value = '1';
		this.compute();
	}

	private populate(select: HTMLSelectElement, selectedIndex: number) {
		select.innerHTML = '';
		this.category.units.forEach((u, i) => {
			const opt = document.createElement('option');
			opt.value = u.id;
			opt.textContent = u.name;
			if (i === selectedIndex) opt.selected = true;
			select.append(opt);
		});
	}

	private swap() {
		const fu = this.fromUnit.value;
		this.fromUnit.value = this.toUnit.value;
		this.toUnit.value = fu;
		// Carry the converted value back into the input so the swap reads naturally.
		const current = Number(this.toValue.value.replace(/,/g, ''));
		if (Number.isFinite(current)) this.fromValue.value = String(current);
		this.compute();
	}

	private compute() {
		const value = Number(this.fromValue.value);
		if (!Number.isFinite(value) || this.fromValue.value.trim() === '') {
			this.toValue.value = '';
			this.formula.textContent = '';
			return;
		}
		const result = convert(this.category, this.fromUnit.value, this.toUnit.value, value);
		this.toValue.value = formatResult(result);
		const fromName = this.fromUnit.selectedOptions[0]?.textContent ?? '';
		const toName = this.toUnit.selectedOptions[0]?.textContent ?? '';
		this.formula.textContent = `${formatResult(value)} ${fromName} = ${formatResult(result)} ${toName}`;
	}
}

customElements.define('unit-converter', UnitConverter);
