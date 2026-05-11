const BACKEND_EXTRACT_URL = "http://localhost:8000/extract";
const CONTENT_SCRIPT_FILES = ["content/canvasApiClient.js", "content/content.js"];

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Failed to configure side panel:", error));

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return tab;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function canInjectIntoTab(tab) {
  return Boolean(tab?.id && /^https?:\/\//.test(tab.url || ""));
}

function isMissingReceivingEndError(error) {
  return error.message.includes("Receiving end does not exist");
}

async function injectContentScript(tab) {
  if (!canInjectIntoTab(tab)) {
    throw new Error("Open a Canvas page in a normal http or https tab first.");
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: CONTENT_SCRIPT_FILES
  });
}

async function sendMessageToTabWithInjectionFallback(tab, message) {
  try {
    return await sendMessageToTab(tab.id, message);
  } catch (error) {
    if (!isMissingReceivingEndError(error)) {
      throw error;
    }

    await injectContentScript(tab);
    return sendMessageToTab(tab.id, message);
  }
}

async function extractActivePageData() {
  const tab = await getActiveTab();
  const response = await sendMessageToTabWithInjectionFallback(tab, {
    type: "EXTRACT_PAGE_DATA"
  });

  if (!response?.success) {
    throw new Error(response?.error || "Failed to extract page data.");
  }

  return response.data;
}

async function sendExtractedDataToBackend(pageData) {
  const response = await fetch(BACKEND_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(pageData)
  });

  if (!response.ok) {
    throw new Error(`Backend returned ${response.status}.`);
  }

  return response.json();
}

async function getActiveCourseMaterials() {
  const tab = await getActiveTab();
  const response = await sendMessageToTabWithInjectionFallback(tab, {
    type: "GET_CANVAS_COURSE_MATERIALS"
  });

  if (!response?.success) {
    throw new Error(response?.error || "Failed to load Canvas course materials.");
  }

  return response.data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_ACTIVE_PAGE_DATA") {
    extractActivePageData()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === "SEND_PAGE_DATA_TO_BACKEND") {
    sendExtractedDataToBackend(message.data)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === "GET_ACTIVE_COURSE_MATERIALS") {
    getActiveCourseMaterials()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  return false;
});
