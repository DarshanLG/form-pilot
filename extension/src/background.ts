// Clicking the toolbar icon opens the side panel (and grants activeTab on the current page).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
