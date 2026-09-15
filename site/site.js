/*
 * Everything on this site that needs a script — WP-94c.
 *
 * Four things, and the page is whole without any of them: the scheme toggle,
 * the reveal, the copy buttons, and closing a menu. Each one is written as an
 * enhancement of something that already works:
 *
 *   - the scheme follows `prefers-color-scheme` until the toggle is pressed,
 *     and the toggle itself is `hidden` in the markup until this file un-hides
 *     it, so scripting off leaves no dead control on the bar;
 *   - the reveal only exists after `js-reveal` is set on the root, so with no
 *     script (or a headless render, or a tab that was never focused) every
 *     section is simply visible;
 *   - a command line is selectable text with or without its button;
 *   - the two menus are `<details>` elements and open on their own.
 *
 * It makes no network call of any kind. `test/unit/site.test.mjs` asserts that
 * over this file as well as over the pages.
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const reduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;

  /* ------------------------------------------------------------- scheme */

  function currentScheme() {
    const set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  const toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    toggle.hidden = false;
    const label = function () {
      const next = currentScheme() === 'dark' ? 'light' : 'dark';
      toggle.setAttribute('aria-label', 'Switch to the ' + next + ' scheme');
      toggle.setAttribute('title', 'Switch to the ' + next + ' scheme');
    };
    label();
    toggle.addEventListener('click', function () {
      const next = currentScheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('deckhq-theme', next);
      } catch {
        /* storage blocked; the choice lasts as long as the page does */
      }
      label();
    });
  }

  /* -------------------------------------------------------------- menus */

  // A `<details>` menu closes when the page is clicked past it, and on Escape.
  // Neither is required to open one, which is why this is down here.
  const menus = document.querySelectorAll('.site-head details');
  if (menus.length) {
    document.addEventListener('click', function (event) {
      for (let i = 0; i < menus.length; i++) {
        if (menus[i].open && !menus[i].contains(event.target)) menus[i].open = false;
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      for (let i = 0; i < menus.length; i++) {
        if (menus[i].open) {
          menus[i].open = false;
          const summary = menus[i].querySelector('summary');
          if (summary) summary.focus();
        }
      }
    });
  }

  /* --------------------------------------------------------------- copy */

  // `navigator.clipboard` where it is offered, a hidden textarea and
  // `execCommand` where it is not. Both are local operations; nothing about
  // this asks the network for anything.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      document.body.removeChild(area);
      ok ? resolve() : reject(new Error('copy refused'));
    });
  }

  const lines = document.querySelectorAll('[data-command]');
  for (let c = 0; c < lines.length; c++) {
    (function (line) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', 'Copy ' + line.getAttribute('data-command'));
      button.addEventListener('click', function () {
        copyText(line.getAttribute('data-command')).then(
          function () {
            button.textContent = 'Copied';
            button.setAttribute('data-copied', 'yes');
            window.setTimeout(function () {
              button.textContent = 'Copy';
              button.removeAttribute('data-copied');
            }, 1600);
          },
          function () {
            button.textContent = 'Select it';
          },
        );
      });
      line.appendChild(button);
    })(lines[c]);
  }

  /* ------------------------------------------------------------- reveal */

  // Opacity and ten pixels, once per element. Anything already on the screen
  // when the observer starts is resolved on its first callback, so nothing
  // above the fold waits for a scroll that may never happen.
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  if (reduced || typeof IntersectionObserver !== 'function') return;

  root.classList.add('js-reveal');
  let answered = false;
  const observer = new IntersectionObserver(
    function (entries) {
      // A working observer calls this once per element the moment it is
      // observed, whether or not the element is on the screen. That callback —
      // not a reveal — is the signal the mechanism is alive, which is why the
      // flag is set before the loop and not inside it.
      answered = true;
      for (let i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.add('is-in');
        observer.unobserve(entries[i].target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.02 },
  );
  for (let t = 0; t < targets.length; t++) observer.observe(targets[t]);

  // A last resort, and the reason the default in the stylesheet is `visible`.
  // If the observer has not said anything at all in two seconds — a renderer
  // that reports no intersections, a print, a tab that was never shown — the
  // whole mechanism is abandoned and the page is plain. A reader who has
  // simply not scrolled yet has already had a callback, so their reveals
  // survive.
  window.setTimeout(function () {
    if (!answered) root.classList.remove('js-reveal');
  }, 2000);
})();
