(() => {
  const settingsSheet = document.getElementById('settings-sheet');
  const sheetBackdrop = document.getElementById('sheet-backdrop');
  const settingsOpen = document.getElementById('settings-open');
  const sheetClose = document.getElementById('sheet-close');
  const sheetTabs = document.querySelectorAll('.sheet-tab');
  const playToggleMobile = document.getElementById('play-toggle-mobile');
  const resetMobile = document.getElementById('reset-mobile');
  const playToggleDesktop = document.getElementById('play-toggle');
  const vizPanel = document.querySelector('.viz-panel');

  let currentTab = 'audio';

  const mobileQuery = window.matchMedia('(max-width: 820px)');

  // The sheet wraps the Controls/Audio/Chart panels. On desktop those panels
  // are laid out inline (display: contents) and must stay in the accessibility
  // tree; only when the sheet is a collapsed mobile overlay should it be
  // hidden from assistive tech.
  function syncSheetA11y() {
    if (mobileQuery.matches && !settingsSheet.classList.contains('is-open')) {
      settingsSheet.setAttribute('aria-hidden', 'true');
    } else {
      settingsSheet.removeAttribute('aria-hidden');
    }
  }

  function openSheet() {
    settingsSheet.classList.add('is-open');
    syncSheetA11y();

    if (sheetBackdrop) {
      sheetBackdrop.hidden = false;
    }

    requestAnimationFrame(() => {
      render();
    });

    const handleTransitionEnd = () => {
      render();
      settingsSheet.removeEventListener('transitionend', handleTransitionEnd);
    };
    settingsSheet.addEventListener('transitionend', handleTransitionEnd);
  }

  function closeSheet() {
    settingsSheet.classList.remove('is-open');
    syncSheetA11y();

    if (sheetBackdrop) {
      sheetBackdrop.hidden = true;
    }

    render();
  }

  function switchTab(tabName) {
    currentTab = tabName;
    settingsSheet.dataset.active = tabName;

    sheetTabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.setAttribute('aria-selected', 'false');
      }
    });

    render();
  }

  function syncPlayButtonLabel() {
    if (playToggleDesktop && playToggleMobile) {
      playToggleMobile.textContent = playToggleDesktop.textContent;
    }
  }

  sheetTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  settingsOpen.addEventListener('click', openSheet);
  sheetClose.addEventListener('click', closeSheet);

  sheetBackdrop.addEventListener('click', closeSheet);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsSheet.classList.contains('is-open')) {
      closeSheet();
    }
  });

  playToggleMobile.addEventListener('click', togglePlayback);
  resetMobile.addEventListener('click', resetSimulation);

  const observer = new MutationObserver(() => {
    syncPlayButtonLabel();
  });

  observer.observe(playToggleDesktop, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  syncPlayButtonLabel();

  const resizeObserver = new ResizeObserver(() => {
    render();
  });

  resizeObserver.observe(vizPanel);

  mobileQuery.addEventListener('change', syncSheetA11y);

  switchTab('audio');
  syncSheetA11y();
})();
