const BACKEND_EXTRACT_URL = "http://localhost:8000/extract";
const CONTENT_SCRIPT_FILES = ["canvas/detect.js", "content/canvasApiClient.js", "content/content.js"];

importScripts(
  "canvas/detect.js",
  "settings/canvas-domains.js",
  "canvas/collect/types.js",
  "canvas/collect/status.js",
  "canvas/collect/active-page.js"
);

const CANVAS_CONTEXT_MENU_ID = "ask-canvas-page";

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

async function getActiveTabCanvasContext() {
  const tab = await getActiveTab();
  const configuredDomains = await CanvasDomainSettings.getConfiguredCanvasDomains();
  const routeInfo = CanvasDetection.parseCanvasRoute(tab.url || "", configuredDomains);

  return {
    tabId: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    configuredDomains,
    defaultDomains: CanvasDetection.getDefaultCanvasDomainPatterns(),
    isCanvas: Boolean(routeInfo),
    routeInfo
  };
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

function isDefaultCanvasHost(hostname) {
  return CanvasDetection.isAllowedCanvasHost(hostname, []);
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

async function assertActiveTabIsCanvas() {
  const context = await getActiveTabCanvasContext();

  if (!context.isCanvas || !context.routeInfo?.courseId) {
    throw new Error("Open a Canvas course page before loading course materials.");
  }

  return context;
}

async function assertTabHasCanvasDom(context) {
  if (isDefaultCanvasHost(context.routeInfo.hostname)) {
    return;
  }

  const response = await sendMessageToTabWithInjectionFallback(
    { id: context.tabId, url: context.url },
    { type: "CHECK_CANVAS_PAGE" }
  );
  const verification = response?.data;
  const verifiedRouteInfo = verification?.routeInfo;

  if (
    !response?.success ||
    !verification?.isCanvasDom ||
    !verifiedRouteInfo?.courseId ||
    verifiedRouteInfo.courseId !== context.routeInfo.courseId
  ) {
    throw new Error("This custom domain does not look like a Canvas course page.");
  }
}

function domainPatternToDocumentUrlPattern(domainPattern) {
  const normalizedDomain = CanvasDetection.normalizeDomainPattern(domainPattern);

  if (!normalizedDomain) {
    return null;
  }

  return `https://${normalizedDomain}/*`;
}

async function getCanvasDocumentUrlPatterns() {
  const configuredDomains = await CanvasDomainSettings.getConfiguredCanvasDomains();
  const domains = [
    ...CanvasDetection.getDefaultCanvasDomainPatterns(),
    ...configuredDomains
  ];

  return Array.from(
    new Set(domains.map(domainPatternToDocumentUrlPattern).filter(Boolean))
  );
}

async function rebuildCanvasContextMenu() {
  await chrome.contextMenus.remove(CANVAS_CONTEXT_MENU_ID).catch(() => {});

  chrome.contextMenus.create({
    id: CANVAS_CONTEXT_MENU_ID,
    title: "Ask about this Canvas page",
    contexts: ["page"],
    documentUrlPatterns: await getCanvasDocumentUrlPatterns()
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

async function collectActivePageContext() {
  const context = await assertActiveTabIsCanvas();
  await assertTabHasCanvasDom(context);

  const page = await CanvasActivePageCollector.collectCurrentActivePageContext(
    context.tabId,
    context.routeInfo
  );

  return {
    status: CanvasCollectionStatus.createStatus(CanvasCollectionStatus.STATES.ready),
    page
  };
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
  const context = await assertActiveTabIsCanvas();
  await assertTabHasCanvasDom(context);

  const tab = { id: context.tabId, url: context.url };
  const response = await sendMessageToTabWithInjectionFallback(tab, {
    type: "GET_CANVAS_COURSE_MATERIALS"
  });

  if (!response?.success) {
    throw new Error(response?.error || "Failed to load Canvas course materials.");
  }

  return response.data;
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildCanvasContextMenu().catch((error) => {
    console.error("Failed to configure Canvas context menu:", error);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CANVAS_CONTEXT_MENU_ID || !tab?.windowId) {
    return;
  }

  chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
    console.error("Failed to open Canvas side panel:", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_ACTIVE_TAB_CANVAS_CONTEXT") {
    getActiveTabCanvasContext()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === "ADD_CANVAS_DOMAIN") {
    CanvasDomainSettings.addConfiguredCanvasDomain(message.domain || "")
      .then(async (data) => {
        await rebuildCanvasContextMenu();
        sendResponse({ success: true, data });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (
    message.type === CanvasCollectTypes.ACTIVE_PAGE_CONTEXT_MESSAGE ||
    message.type === "EXTRACT_ACTIVE_PAGE_DATA"
  ) {
    collectActivePageContext()
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
