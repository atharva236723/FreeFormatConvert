// Shared registry of every dropdown's close handler so that opening one can
// close the others — otherwise two menus can be open (and overlapping) at once,
// because each trigger stops click propagation and never reaches a sibling's
// outside-click listener.
const closers: Array<{ root: HTMLElement; close: () => void }> = [];

function initDropdown(root: HTMLElement) {
	const trigger = root.querySelector<HTMLButtonElement>('[data-dropdown-trigger]');
	const panel = root.querySelector<HTMLElement>('[data-dropdown-panel]');
	if (!trigger || !panel) return;

	function open() {
		// Close any other dropdown before opening this one.
		for (const other of closers) {
			if (other.root !== root) other.close();
		}
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

	closers.push({ root, close });
}

document.querySelectorAll<HTMLElement>('[data-dropdown]').forEach(initDropdown);
