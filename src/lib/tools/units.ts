/**
 * Unit-conversion tables for the standalone Unit Converter / Time Converter tools. Pure data +
 * arithmetic — no network, no dependency. Linear units store a `factor` relative to the
 * category's base unit; temperature (non-linear) supplies explicit to/from-base functions.
 */

export interface Unit {
	id: string;
	name: string;
	/** value_in_base = value * factor. Omitted when to/fromBase are supplied. */
	factor?: number;
	toBase?: (v: number) => number;
	fromBase?: (v: number) => number;
}

export interface UnitCategory {
	id: string;
	name: string;
	units: Unit[];
}

export const CATEGORIES: UnitCategory[] = [
	{
		id: 'length',
		name: 'Length',
		units: [
			{ id: 'mm', name: 'Millimeter', factor: 0.001 },
			{ id: 'cm', name: 'Centimeter', factor: 0.01 },
			{ id: 'm', name: 'Meter', factor: 1 },
			{ id: 'km', name: 'Kilometer', factor: 1000 },
			{ id: 'in', name: 'Inch', factor: 0.0254 },
			{ id: 'ft', name: 'Foot', factor: 0.3048 },
			{ id: 'yd', name: 'Yard', factor: 0.9144 },
			{ id: 'mi', name: 'Mile', factor: 1609.344 },
			{ id: 'nmi', name: 'Nautical mile', factor: 1852 },
		],
	},
	{
		id: 'mass',
		name: 'Weight / Mass',
		units: [
			{ id: 'mg', name: 'Milligram', factor: 0.000001 },
			{ id: 'g', name: 'Gram', factor: 0.001 },
			{ id: 'kg', name: 'Kilogram', factor: 1 },
			{ id: 't', name: 'Metric ton', factor: 1000 },
			{ id: 'oz', name: 'Ounce', factor: 0.028349523125 },
			{ id: 'lb', name: 'Pound', factor: 0.45359237 },
			{ id: 'st', name: 'Stone', factor: 6.35029318 },
		],
	},
	{
		id: 'temperature',
		name: 'Temperature',
		units: [
			{ id: 'c', name: 'Celsius', toBase: (v) => v, fromBase: (v) => v },
			{ id: 'f', name: 'Fahrenheit', toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
			{ id: 'k', name: 'Kelvin', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
		],
	},
	{
		id: 'area',
		name: 'Area',
		units: [
			{ id: 'cm2', name: 'Square centimeter', factor: 0.0001 },
			{ id: 'm2', name: 'Square meter', factor: 1 },
			{ id: 'ha', name: 'Hectare', factor: 10000 },
			{ id: 'km2', name: 'Square kilometer', factor: 1000000 },
			{ id: 'in2', name: 'Square inch', factor: 0.00064516 },
			{ id: 'ft2', name: 'Square foot', factor: 0.09290304 },
			{ id: 'ac', name: 'Acre', factor: 4046.8564224 },
			{ id: 'mi2', name: 'Square mile', factor: 2589988.110336 },
		],
	},
	{
		id: 'volume',
		name: 'Volume',
		units: [
			{ id: 'ml', name: 'Milliliter', factor: 0.001 },
			{ id: 'l', name: 'Liter', factor: 1 },
			{ id: 'm3', name: 'Cubic meter', factor: 1000 },
			{ id: 'tsp', name: 'Teaspoon (US)', factor: 0.00492892159375 },
			{ id: 'tbsp', name: 'Tablespoon (US)', factor: 0.01478676478125 },
			{ id: 'floz', name: 'Fluid ounce (US)', factor: 0.0295735295625 },
			{ id: 'cup', name: 'Cup (US)', factor: 0.2365882365 },
			{ id: 'pt', name: 'Pint (US)', factor: 0.473176473 },
			{ id: 'qt', name: 'Quart (US)', factor: 0.946352946 },
			{ id: 'gal', name: 'Gallon (US)', factor: 3.785411784 },
		],
	},
	{
		id: 'speed',
		name: 'Speed',
		units: [
			{ id: 'mps', name: 'Meter / second', factor: 1 },
			{ id: 'kph', name: 'Kilometer / hour', factor: 1 / 3.6 },
			{ id: 'mph', name: 'Mile / hour', factor: 0.44704 },
			{ id: 'fps', name: 'Foot / second', factor: 0.3048 },
			{ id: 'kn', name: 'Knot', factor: 0.514444 },
		],
	},
	{
		id: 'digital',
		name: 'Digital storage',
		units: [
			{ id: 'b', name: 'Byte', factor: 1 },
			{ id: 'kb', name: 'Kilobyte (1000)', factor: 1000 },
			{ id: 'mb', name: 'Megabyte (1000)', factor: 1000 ** 2 },
			{ id: 'gb', name: 'Gigabyte (1000)', factor: 1000 ** 3 },
			{ id: 'tb', name: 'Terabyte (1000)', factor: 1000 ** 4 },
			{ id: 'kib', name: 'Kibibyte (1024)', factor: 1024 },
			{ id: 'mib', name: 'Mebibyte (1024)', factor: 1024 ** 2 },
			{ id: 'gib', name: 'Gibibyte (1024)', factor: 1024 ** 3 },
			{ id: 'tib', name: 'Tebibyte (1024)', factor: 1024 ** 4 },
		],
	},
	{
		id: 'time',
		name: 'Time',
		units: [
			{ id: 'ns', name: 'Nanosecond', factor: 1e-9 },
			{ id: 'ms', name: 'Millisecond', factor: 0.001 },
			{ id: 's', name: 'Second', factor: 1 },
			{ id: 'min', name: 'Minute', factor: 60 },
			{ id: 'h', name: 'Hour', factor: 3600 },
			{ id: 'day', name: 'Day', factor: 86400 },
			{ id: 'week', name: 'Week', factor: 604800 },
			{ id: 'month', name: 'Month (30 days)', factor: 2592000 },
			{ id: 'year', name: 'Year (365 days)', factor: 31536000 },
		],
	},
];

export function findCategory(id: string): UnitCategory | undefined {
	return CATEGORIES.find((c) => c.id === id);
}

/** Convert `value` from `fromId` to `toId` within a category. Returns NaN if a unit is unknown. */
export function convert(category: UnitCategory, fromId: string, toId: string, value: number): number {
	const from = category.units.find((u) => u.id === fromId);
	const to = category.units.find((u) => u.id === toId);
	if (!from || !to) return NaN;
	const base = from.toBase ? from.toBase(value) : value * (from.factor ?? 1);
	return to.fromBase ? to.fromBase(base) : base / (to.factor ?? 1);
}

/** Format a converted number for display: trim floating-point noise without losing precision. */
export function formatResult(value: number): string {
	if (!Number.isFinite(value)) return '—';
	if (value === 0) return '0';
	const abs = Math.abs(value);
	if (abs >= 1e15 || abs < 1e-6) return value.toExponential(6).replace(/\.?0+e/, 'e');
	// Round to ~10 significant figures, then strip trailing zeros.
	const rounded = Number(value.toPrecision(10));
	return String(rounded);
}
