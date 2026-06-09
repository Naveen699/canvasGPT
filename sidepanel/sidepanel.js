const status = document.getElementById("status");
const pageContext = document.getElementById("pageContext");
const loadMaterialsBtn = document.getElementById("loadMaterialsBtn");
const summary = document.getElementById("summary");
const materialsList = document.getElementById("materialsList");

let activeTabIsCanvas = false;

function setBusy(isBusy) {
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

async function refreshCanvasContext() {
  try {
    const context = await sendRuntimeMessage({
      type: "GET_ACTIVE_TAB_CANVAS_CONTEXT"
    });

    activeTabIsCanvas = Boolean(context.isCanvas && context.routeInfo?.courseId);
    pageContext.textContent = activeTabIsCanvas
      ? `${formatRouteLabel(context.routeInfo)}. ${context.title || context.url}`
      : "Open a Canvas course page to use Canvas context.";
    setStatus(
      activeTabIsCanvas
        ? "Canvas page detected. Ready to collect course materials."
        : "Open a Canvas course page, then collect course materials."
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

function getManifest(data) {
  return data.manifest || null;
}

function getPlacementCountByMaterialKey(placements = []) {
  return placements.reduce((counts, placement) => {
    if (placement.materialKey) {
      counts.set(placement.materialKey, (counts.get(placement.materialKey) || 0) + 1);
    }

    return counts;
  }, new Map());
}

function groupMaterialsByKind(materials = []) {
  return materials.reduce((groups, material) => {
    const kind = material.kind || "unknown";

    if (!groups.has(kind)) {
      groups.set(kind, []);
    }

    groups.get(kind).push(material);
    return groups;
  }, new Map());
}

function getKindLabel(kind) {
  const labels = {
    announcement: "Announcements",
    assignment: "Assignments",
    canvas_url: "Canvas Links",
    discussion: "Discussions",
    file: "Files",
    module_item: "Module-only Items",
    page: "Pages"
  };

  return labels[kind] || kind.replaceAll("_", " ");
}

function renderSummary(data) {
  const manifest = getManifest(data);

  if (manifest) {
    const courseName = manifest.courseName || `Course ${manifest.courseId}`;
    const errors = manifest.collectionErrors || [];

    summary.hidden = false;
    summary.innerHTML = "";
    summary.append(
      createTextElement(
        "p",
        "",
        `${courseName}: ${manifest.materials.length} deduplicated materials, ${manifest.placements.length} source placements.`
      )
    );

    if (errors.length) {
      summary.append(
        createTextElement(
          "p",
          "error-text",
          `Some endpoints were unavailable: ${errors.map((error) => error.name).filter(Boolean).join(", ")}`
        )
      );
    }

    return;
  }

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

function renderMaterialItem(material, placementCount = 0) {
  const item = document.createElement("li");
  item.className = "material-item";
  const title =
    material.title ||
    material.text ||
    material.name ||
    material.fileName ||
    material.materialKey ||
    "Untitled";
  const href =
    material.canvasUrl ||
    material.fileDownloadUrl ||
    material.htmlUrl ||
    material.href ||
    material.url ||
    "";

  if (href) {
    item.append(createLink("material-link", title, href));
  } else {
    item.append(createTextElement("p", "material-title", title));
  }

  const metaParts = [
    material.materialKey || "",
    material.kind || material.type || material.itemType || "",
    material.moduleName ? `Module: ${material.moduleName}` : "",
    placementCount ? `${placementCount} placement${placementCount === 1 ? "" : "s"}` : "",
    material.dueAt ? `Due ${new Date(material.dueAt).toLocaleDateString()}` : "",
    material.contentType || material.content_type || "",
    material.size ? `${material.size} bytes` : ""
  ].filter(Boolean);

  if (metaParts.length) {
    item.append(createTextElement("p", "material-meta", metaParts.join(" - ")));
  }

  return item;
}

function renderSection(title, items, placementCounts = new Map()) {
  const card = document.createElement("article");
  card.className = "material-card";
  card.append(createTextElement("h3", "section-title", `${title} (${items.length})`));

  if (!items.length) {
    card.append(createTextElement("p", "empty-state", `No ${title.toLowerCase()} found.`));
    return card;
  }

  const list = document.createElement("ul");
  list.className = "materials-list-inner";
  items.forEach((item) =>
    list.append(renderMaterialItem(item, placementCounts.get(item.materialKey) || 0))
  );
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
  const manifest = getManifest(data);

  const materials = data.materials || {};
  clearElement(materialsList);

  if (manifest) {
    const groupedMaterials = groupMaterialsByKind(manifest.materials || []);
    const placementCounts = getPlacementCountByMaterialKey(manifest.placements || []);
    const orderedKinds = [
      "file",
      "page",
      "assignment",
      "announcement",
      "discussion",
      "module_item",
      "canvas_url"
    ];
    const renderedKinds = new Set();

    orderedKinds.forEach((kind) => {
      const items = groupedMaterials.get(kind) || [];
      renderedKinds.add(kind);
      materialsList.append(renderSection(getKindLabel(kind), items, placementCounts));
    });

    Array.from(groupedMaterials.keys())
      .filter((kind) => !renderedKinds.has(kind))
      .sort()
      .forEach((kind) =>
        materialsList.append(renderSection(getKindLabel(kind), groupedMaterials.get(kind), placementCounts))
      );

    return;
  }

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
  setStatus("Collecting course materials from Canvas...");

  try {
    const data = await sendRuntimeMessage({
      type: "GET_ACTIVE_COURSE_MATERIALS"
    });

    renderSummary(data);
    renderMaterials(data);
    setStatus("Deduplicated course materials collected.");
  } catch (error) {
    summary.hidden = true;
    clearElement(materialsList);
    materialsList.append(createTextElement("p", "error-text", error.message));
    setStatus("Could not collect course materials.");
  } finally {
    setBusy(false);
  }
});

refreshCanvasContext();
