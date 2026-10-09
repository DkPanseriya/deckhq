/*
 * Everything on this site that needs a script.
 *
 * Four things, and the page is whole without any of them:
 *
 *   - a command line gets a "copy" button. The line is selectable text with or
 *     without it;
 *   - the menu on a narrow screen closes on Escape and on a click outside. It
 *     is a `<details>` element and opens on its own;
 *   - a gallery of styles becomes one stage and a row of names. Without the
 *     script it is every picture, one under another;
 *   - two pictures of the same rooms become one, with a slider between them.
 *     Without the script they sit side by side.
 *
 * It makes no network call of any kind and stores nothing.
 */
(function () {
  'use strict';

  /* --------------------------------------------------------------- copy */

  document.querySelectorAll('.cmd').forEach(function (line) {
    const code = line.querySelector('code');
    if (!code || !navigator.clipboard) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'copy';
    button.setAttribute('aria-label', 'Copy the command: ' + code.textContent);
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(code.textContent).then(function () {
        button.textContent = 'copied';
        button.setAttribute('data-done', '');
        setTimeout(function () {
          button.textContent = 'copy';
          button.removeAttribute('data-done');
        }, 1600);
      });
    });
    line.appendChild(button);
  });

  /* --------------------------------------------------------------- menu */

  const menu = document.querySelector('.nav-toggle');
  if (menu) {
    document.addEventListener('click', function (event) {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  }

  /* ------------------------------------------------------------- styles */

  document.querySelectorAll('.switcher').forEach(function (box) {
    const stage = box.querySelector('.switch-stage');
    const figures = stage ? Array.prototype.slice.call(stage.querySelectorAll('figure')) : [];
    if (figures.length < 2) return;

    const names = document.createElement('div');
    names.className = 'switch-names';
    names.setAttribute('role', 'group');
    names.setAttribute('aria-label', box.getAttribute('data-label') || 'Style');

    const buttons = figures.map(function (figure, i) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = figure.getAttribute('data-name');
      button.addEventListener('click', function () {
        show(i);
      });
      names.appendChild(button);
      return button;
    });

    function show(index) {
      figures.forEach(function (figure, i) {
        figure.classList.toggle('is-on', i === index);
        buttons[i].setAttribute('aria-pressed', String(i === index));
      });
    }

    box.insertBefore(names, stage);
    box.classList.add('is-live');
    show(0);
  });

  /* ------------------------------------------------------------ compare */

  document.querySelectorAll('.compare').forEach(function (box) {
    if (box.querySelectorAll('figure').length !== 2) return;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = '50';
    range.setAttribute('aria-label', box.getAttribute('data-label') || 'Compare');
    const line = document.createElement('span');
    line.className = 'compare-line';
    range.addEventListener('input', function () {
      box.style.setProperty('--at', range.value + '%');
    });
    box.appendChild(range);
    box.appendChild(line);
    box.classList.add('is-live');
  });
})();
