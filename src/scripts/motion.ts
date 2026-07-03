// Global motion layer.
//
// Adds the butter-smooth, site-wide behaviours that don't belong to any single
// component: scroll-reveal for content sections, a staggered cascade for card
// grids, and eased in-page anchor scrolling. Everything is a progressive
// enhancement — `js-motion` (added by the inline <head> script) gates the CSS,
// and a failsafe timer guarantees content is never left hidden if this never runs.
//
// Kept in vanilla TS with no framework, matching the rest of the project.

const REVEALED = 'is-revealed';

// Grids whose individual cards should cascade in one-by-one instead of the whole
// section fading as a single block. Everything else reveals at section granularity.
const STAGGER_GRIDS =
	'.feature-grid, .steps-grid, .related-grid, .popular-grid, .values-grid, .faq-list';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Mark an element as a reveal target with a stagger index (capped so long lists
 *  don't accumulate a huge delay). */
function tag(el: HTMLElement, index: number): void {
	el.setAttribute('data-reveal', '');
	el.style.setProperty('--reveal-i', String(Math.min(index, 6)));
}

function setupReveal(): void {
	const main = document.querySelector('main');
	if (!main) return;

	// A content section that contains a known card grid gets its intro (heading)
	// and each card tagged individually for a cascade; the <section> itself is left
	// un-tagged so the block-level reveal rule doesn't double up on the cards.
	const observer = new IntersectionObserver(
		(entries, obs) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				entry.target.classList.add(REVEALED);
				obs.unobserve(entry.target);
			}
		},
		// Trigger a touch before the element is fully in view so it's already
		// settling by the time it reaches the reader's eye.
		{ threshold: 0, rootMargin: '0px 0px -8% 0px' }
	);

	const sections = Array.from(main.children).filter(
		(el): el is HTMLElement => el.tagName === 'SECTION' && !el.classList.contains('hero')
	);

	for (const section of sections) {
		const grid = section.querySelector<HTMLElement>(STAGGER_GRIDS);
		if (grid && grid.children.length > 0 && grid.parentElement) {
			// This section reveals per-card, so opt it out of the block-level hide
			// rule — otherwise the section stays transparent and hides its own cards.
			section.setAttribute('data-reveal-container', '');
			// Expand the grid into its cards; keep any sibling intro (title) ahead of it.
			const container = grid.parentElement;
			let i = 0;
			for (const child of Array.from(container.children) as HTMLElement[]) {
				if (child === grid) {
					for (const card of Array.from(grid.children) as HTMLElement[]) {
						tag(card, i++);
						observer.observe(card);
					}
				} else {
					tag(child, i++);
					observer.observe(child);
				}
			}
		} else {
			// Plain section (prose, etc.) — reveal as one block.
			section.setAttribute('data-reveal', '');
			observer.observe(section);
		}
	}

	// Also honour anything the markup opted in with [data-reveal] up front.
	document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)').forEach((el) => {
		observer.observe(el);
	});
}

/** Smoothly ease same-page hash links (e.g. "How it works") into view. */
function setupSmoothAnchors(): void {
	document.addEventListener('click', (event) => {
		if (event.defaultPrevented || (event as MouseEvent).button !== 0) return;
		const anchor = (event.target as HTMLElement)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
		if (!anchor) return;
		const id = anchor.getAttribute('href')!.slice(1);
		if (!id) return;
		const target = document.getElementById(id);
		if (!target) return;
		event.preventDefault();
		target.scrollIntoView({ behavior: 'smooth', block: 'start' });
		// Keep the URL + focus in sync without the instant jump.
		history.pushState(null, '', `#${id}`);
		target.setAttribute('tabindex', '-1');
		(target as HTMLElement).focus({ preventScroll: true });
	});
}

function init(): void {
	// If motion is reduced, don't hide/animate anything — reveal immediately.
	if (reduceMotion) {
		document.documentElement.classList.add('motion-failsafe');
		return;
	}
	setupReveal();
	setupSmoothAnchors();
}

// Signal the inline failsafe that motion booted, so it doesn't force-reveal.
(window as unknown as { __ffcMotionReady?: boolean }).__ffcMotionReady = true;

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
	init();
}
