const STORAGE_KEY = 'theme';

function currentTheme(): 'light' | 'dark' {
	return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark') {
	if (theme === 'dark') {
		document.documentElement.setAttribute('data-theme', 'dark');
	} else {
		document.documentElement.removeAttribute('data-theme');
	}
	localStorage.setItem(STORAGE_KEY, theme);
}

document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
	button.setAttribute('aria-pressed', String(currentTheme() === 'dark'));

	button.addEventListener('click', () => {
		const next = currentTheme() === 'dark' ? 'light' : 'dark';
		applyTheme(next);
		button.setAttribute('aria-pressed', String(next === 'dark'));
	});
});
