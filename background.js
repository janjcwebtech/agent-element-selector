/* Agent Element Selector — service worker.
   Its only job: the toolbar icon toggles the on-page toolbar. chrome.action.onClicked exists
   nowhere else, so this is the whole worker; everything it toggles lives in content.js. */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  // No answer means no content script there: a chrome:// page, the Web Store, or a tab opened
  // before the extension was installed or reloaded.
  chrome.tabs.sendMessage(tab.id, { type: 'aes:toggle' }, { frameId: 0 }, () => void chrome.runtime.lastError);
});
