const status = document.getElementById("status");
const pageContext = document.getElementById("pageContext");
const collectPageBtn = document.getElementById("collectPageBtn");
const loadMaterialsBtn = document.getElementById("loadMaterialsBtn");
const summary = document.getElementById("summary");
const materialsList = document.getElementById("materialsList");
const domainForm = document.getElementById("domainForm");
const domainInput = document.getElementById("domainInput");
const domainList = document.getElementById("domainList");
const collectedPage = document.getElementById("collectedPage");
const collectedPageTitle = document.getElementById("collectedPageTitle");
const collectedPageMeta = document.getElementById("collectedPageMeta");
const collectedPageText = document.getElementById("collectedPageText");

let activeTabIsCanvas = false;

function setBusy(isBusy) {
  collectPageBtn.disabled = isBusy || !activeTabIsCanvas;
  loadMaterialsBtn.disabled = isBusy || !activeTabIsCanvas;
}

function setStatus(message) {
  status.textContent = message;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.success) {
        reject(new Error(response?.error || "Extension message failed."));
        return;
      }

      resolve(response.data);
    });
  });
}

function formatRouteLabel(routeInfo) {
  if (!routeInfo) {
    return "Not a configured Canvas page.";
  }

  const courseLabel = routeInfo.courseId ? `Course ${routeInfo.courseId}` : "Canvas";
  return `${courseLabel} - ${routeInfo.route.replaceAll("_", " ")}`;
}

function renderDomainList(domains = [], defaultDomains = CanvasDetection.getDefaultCanvasDomainPatterns()) {
  const configuredText = domains.length ? domains.join(", ") : "none";
  domainList.textContent = `Configured: ${configuredText}. Defaults: ${defaultDomains.join(", ")}.`;
}

async function refreshCanvasContext() {
  try {
    const context = await sendRuntimeMessage({
      type: "GET_ACTIVE_TAB_CANVAS_CONTEXT"
    });

    activeTabIsCanvas = Boolean(context.isCanvas && context.routeInfo?.courseId);
    pageContext.textContent = activeTabIsCanvas
      ? `${formatRouteLabel(context.routeInfo)}. ${context.title || context.url}`
      : "Open a Canvas course page to use Canvas context.";
    renderDomainList(context.configuredDomains || [], context.defaultDomains || []);
    setStatus(
      activeTabIsCanvas
        ? "Canvas page detected. Ready to load visible course materials."
        : "Open a Canvas course page, then load visible materials."
    );
  } catch (error) {
    activeTabIsCanvas = false;
    pageContext.textContent = error.message;
    setStatus("Could not inspect the active tab.");
  }

  setBusy(false);
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createLink(className, text, href) {
  const link = document.createElement("a");
  link.className = className;
  link.textContent = text;
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

function renderSummary(data) {
  const materials = data.materials || {};
  const counts = {
    modules: materials.modules?.length || 0,
    pages: materials.pages?.length || 0,
    assignments: materials.assignments?.length || 0,
    announcements: materials.announcements?.length || 0,
    discussions: materials.discussions?.length || 0,
    links: data.links?.length || 0,
    files: data.files?.length || 0
  };
  const courseName = data.course?.name || data.course?.course_code || `Course ${data.courseId}`;

  summary.hidden = false;
  summary.innerHTML = "";
  summary.append(
    createTextElement(
      "p",
      "",
      `${courseName}: ${counts.modules} module items, ${counts.pages} pages, ${counts.assignments} assignments, ${counts.announcements} announcements, ${counts.discussions} discussions, ${counts.links} links, ${counts.files} linked files.`
    )
  );

  if (data.unavailable?.length) {
    summary.append(
      createTextElement("p", "error-text", `Some endpoints were unavailable: ${data.unavailable.join(", ")}`)
    );
  }
}

function renderCollectedPage(data) {
  const page = data.page || data;
  const textLength = page.text?.length || 0;
  const rawHtmlNote = page.rawHtmlLifecycle === "transient"
    ? `Raw HTML parsed transiently and discarded (${page.rawHtmlBytes || 0} bytes).`
    : "Raw HTML lifecycle unknown.";

  collectedPage.hidden = false;
  collectedPageTitle.textContent = page.title || "Untitled Canvas page";
  collectedPageMeta.textContent = [
    page.contentType || "unknown content type",
    page.url || "",
    `${textLength} text characters`,
    rawHtmlNote
  ].filter(Boolean).join(" - ");
  collectedPageText.textContent = page.text || "No visible text was found on this page.";
}

function renderMaterialItem(material) {
  const item = document.createElement("li");
  item.className = "material-item";
  const title = material.title || material.text || material.name || "Untitled";
  const href = material.htmlUrl || material.href || material.url || "";

  if (href) {
    item.append(createLink("material-link", title, href));
  } else {
    item.append(createTextElement("p", "material-title", title));
  }

  const metaParts = [
    material.type || material.itemType || "",
    material.moduleName ? `Module: ${material.moduleName}` : "",
    material.dueAt ? `Due ${new Date(material.dueAt).toLocaleDateString()}` : "",
    material.contentType || "",
    material.size ? `${material.size} bytes` : ""
  ].filter(Boolean);

  if (metaParts.length) {
    item.append(createTextElement("p", "material-meta", metaParts.join(" - ")));
  }

  return item;
}

function renderSection(title, items) {
  const card = document.createElement("article");
  card.className = "material-card";
  card.append(createTextElement("h3", "section-title", `${title} (${items.length})`));

  if (!items.length) {
    card.append(createTextElement("p", "empty-state", `No ${title.toLowerCase()} found.`));
    return card;
  }

  const list = document.createElement("ul");
  list.className = "materials-list-inner";
  items.forEach((item) => list.append(renderMaterialItem(item)));
  card.append(list);

  return card;
}

function normalizeFiles(files = []) {
  return files.map((file) => ({
    type: "file",
    title: file.display_name || file.filename || `File ${file.id}`,
    htmlUrl: file.url || file.preview_url || "",
    contentType: file["content-type"] || file.content_type || "",
    size: file.size || 0
  }));
}

function renderMaterials(data) {
  const materials = data.materials || {};
  clearElement(materialsList);
  materialsList.append(renderSection("Module Items", materials.modules || []));
  materialsList.append(renderSection("Pages", materials.pages || []));
  materialsList.append(renderSection("Assignments", materials.assignments || []));
  materialsList.append(renderSection("Announcements", materials.announcements || []));
  materialsList.append(renderSection("Discussions", materials.discussions || []));
  materialsList.append(renderSection("Rendered and Content Links", data.links || []));
  materialsList.append(renderSection("Linked Files", normalizeFiles(data.files)));
}

loadMaterialsBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Loading student-visible course materials from Canvas...");

  try {
    const data = await sendRuntimeMessage({
      type: "GET_ACTIVE_COURSE_MATERIALS"
    });

    renderSummary(data);
    renderMaterials(data);
    setStatus("Visible course materials loaded.");
  } catch (error) {
    summary.hidden = true;
    clearElement(materialsList);
    materialsList.append(createTextElement("p", "error-text", error.message));
    setStatus("Could not load visible course materials.");
  } finally {
    setBusy(false);
  }
});

collectPageBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus(
    CanvasCollectionStatus.createStatus(CanvasCollectionStatus.STATES.collecting).message
  );

  try {
    const data = await sendRuntimeMessage({
      type: CanvasCollectTypes.ACTIVE_PAGE_CONTEXT_MESSAGE
    });

    renderCollectedPage(data);
    setStatus(data.status?.message || "Current Canvas page collected.");
  } catch (error) {
    collectedPage.hidden = true;
    setStatus(error.message || "Could not collect the current Canvas page.");
  } finally {
    setBusy(false);
  }
});

domainForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const domain = domainInput.value.trim();
  if (!domain) {
    return;
  }

  setStatus("Saving Canvas domain...");

  try {
    const domains = await sendRuntimeMessage({
      type: "ADD_CANVAS_DOMAIN",
      domain
    });

    domainInput.value = "";
    renderDomainList(domains);
    await refreshCanvasContext();
  } catch (error) {
    setStatus(error.message);
  }
});

refreshCanvasContext();
