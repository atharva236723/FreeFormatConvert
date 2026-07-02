function initDropdown(root: HTMLElement) {
	const trigger = root.querySelector<HTMLButtonElement>('[data-dropdown-trigger]');
	const panel = root.querySelector<HTMLElement>('[data-dropdown-panel]');
	if (!trigger || !panel) return;

	function open() {
		panel!.hidden = false;
		trigger!.setAttribute('aria-expanded', 'true');
	}

	function close() {
		panel!.hidden = true;
		trigger!.setAttribute('aria-expanded', 'false');
	}

	function isOpen() {
		return trigger!.getAttribute('aria-expanded') === 'true';
	}

	trigger.addEventListener('click', (event) => {
		event.stopPropagation();
		isOpen() ? close() : open();
	});

	// Close when clicking anywhere outside the dropdown.
	document.addEventListener('click', (event) => {
		if (isOpen() && !root.contains(event.target as Node)) close();
	});

	// Close on Escape and return focus to the trigger.
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && isOpen()) {
			close();
			trigger.focus();
		}
	});

	// Close after following a link inside the menu.
	panel.addEventListener('click', (event) => {
		if ((event.target as HTMLElement).closest('a')) close();
	});
}

document.querySelectorAll<HTMLElement>('[data-dropdown]').forEach(initDropdown);
