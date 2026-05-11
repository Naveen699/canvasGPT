const CANVAS_JSON_ACCEPT_HEADER = "application/json+canvas-string-ids";
const PRESENTATION_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
];

function appendArrayParams(searchParams, key, values = []) {
  values.filter(Boolean).forEach((value) => searchParams.append(`${key}[]`, value));
}

function appendScalarParam(searchParams, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    searchParams.set(key, value);
  }
}

function createCanvasApiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      appendArrayParams(url.searchParams, key, value);
      return;
    }

    appendScalarParam(url.searchParams, key, value);
  });

  return url;
}

function extractNextPageUrl(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const nextLink = linkHeader
    .split(",")
    .map((link) => link.trim())
    .find((link) => link.includes('rel="next"'));

  return nextLink?.match(/<([^>]+)>/)?.[1] || null;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

function getCurrentCourseId() {
  const courseId = window.location.pathname.match(/\/courses\/(\d+)/)?.[1];

  if (!courseId) {
    throw new Error("Open a Canvas course page before loading course materials.");
  }

  return courseId;
}

function getUniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

function isPresentationFile(file) {
  const contentType = file?.["content-type"] || file?.content_type || "";
  const filename = file?.filename || file?.display_name || "";

  return (
    PRESENTATION_CONTENT_TYPES.includes(contentType) ||
    /\.(pdf|ppt|pptx)$/i.test(filename)
  );
}

function getFileIdsFromModules(modules = []) {
  return modules.flatMap((module) =>
    (module.items || [])
      .filter((item) => item.type === "File" && item.content_id)
      .map((item) => item.content_id)
  );
}

function getFileIdsFromPages(pages = []) {
  return pages.flatMap((page) => {
    const body = page.body || "";
    const matches = body.matchAll(/\/files\/(\d+)/g);

    return Array.from(matches, (match) => match[1]);
  });
}

function getLinksFromHtml(html = "", source = {}) {
  if (!html) {
    return [];
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  return Array.from(doc.querySelectorAll("a[href]"))
    .map((link) => normalizeLink(link.textContent, link.getAttribute("href"), source))
    .filter(Boolean);
}

function getRenderedLinks(source = {}) {
  return Array.from(document.querySelectorAll("a[href]"))
    .map((link) => normalizeLink(link.textContent, link.getAttribute("href"), source))
    .filter(Boolean);
}

function normalizeLink(text, href, source = {}) {
  if (!href) {
    return null;
  }

  let url;

  try {
    url = new URL(href, window.location.origin);
  } catch {
    return null;
  }

  return {
    text: text?.trim() || url.pathname,
    href: url.toString(),
    canvasPath: url.origin === window.location.origin ? url.pathname : "",
    source
  };
}

function getUniqueLinks(links = []) {
  const seen = new Set();

  return links.filter((link) => {
    const key = `${link.href}:${link.source?.type || ""}:${link.source?.id || ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getFileIdsFromLinks(links = []) {
  return links.flatMap((link) => {
    const matches = link.href.matchAll(/\/files\/(\d+)/g);

    return Array.from(matches, (match) => match[1]);
  });
}

function getUniqueFiles(files = []) {
  const seen = new Set();

  return files.filter((file) => {
    const id = file?.id;

    if (!id || seen.has(String(id))) {
      return false;
    }

    seen.add(String(id));
    return true;
  });
}

async function loadOptionalMaterial(name, loadFn) {
  try {
    return {
      data: await loadFn(),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: {
        name,
        message: error.message
      }
    };
  }
}

class CanvasSessionApiClient {
  async request(pathOrUrl, params = {}) {
    const url = /^https?:\/\//.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : createCanvasApiUrl(pathOrUrl, params);

    if (url.origin !== window.location.origin) {
      throw new Error("Canvas session API requests must stay on the current Canvas origin.");
    }

    const response = await fetch(url.toString(), {
      credentials: "same-origin",
      headers: {
        Accept: CANVAS_JSON_ACCEPT_HEADER
      }
    });
    const responseText = await response.text();
    let data = null;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { message: responseText };
      }
    }

    if (!response.ok) {
      const message = data?.errors?.[0]?.message || data?.message || response.statusText;
      throw new Error(`Canvas API returned ${response.status}: ${message}`);
    }

    return {
      data,
      nextPageUrl: extractNextPageUrl(response.headers.get("Link"))
    };
  }

  async requestAllPages(path, params = {}) {
    const firstUrl = createCanvasApiUrl(path, {
      per_page: 100,
      ...params
    });
    const results = [];
    let nextUrl = firstUrl.toString();

    while (nextUrl) {
      const { data, nextPageUrl } = await this.request(nextUrl);
      results.push(...(Array.isArray(data) ? data : [data]));
      nextUrl = nextPageUrl;
    }

    return results;
  }

  listCourses(params = {}) {
    return this.requestAllPages("/api/v1/courses", params);
  }

  listActiveCourses() {
    return this.listCourses({
      enrollment_state: "active",
      include: ["term", "course_image", "total_students"]
    });
  }

  getCourse(courseId, params = {}) {
    return this.request(`/api/v1/courses/${encodePathSegment(courseId)}`, params).then(
      ({ data }) => data
    );
  }

  listCourseFiles(courseId, options = {}) {
    return this.requestAllPages(`/api/v1/courses/${encodePathSegment(courseId)}/files`, {
      content_types: options.contentTypes,
      exclude_content_types: options.excludeContentTypes,
      include: options.include,
      only: options.only,
      search_term: options.searchTerm,
      sort: options.sort,
      order: options.order
    });
  }

  listAssignments(courseId, options = {}) {
    return this.requestAllPages(`/api/v1/courses/${encodePathSegment(courseId)}/assignments`, {
      include: options.include,
      bucket: options.bucket,
      order_by: options.orderBy,
      search_term: options.searchTerm
    });
  }

  listAnnouncements(courseId, options = {}) {
    return this.requestAllPages("/api/v1/announcements", {
      context_codes: [`course_${courseId}`],
      active_only: options.activeOnly,
      latest_only: options.latestOnly
    });
  }

  listDiscussionTopics(courseId, options = {}) {
    return this.requestAllPages(
      `/api/v1/courses/${encodePathSegment(courseId)}/discussion_topics`,
      {
        only_announcements: options.onlyAnnouncements,
        order_by: options.orderBy,
        scope: options.scope
      }
    );
  }

  listCourseFolders(courseId) {
    return this.requestAllPages(`/api/v1/courses/${encodePathSegment(courseId)}/folders`);
  }

  listFolderFiles(folderId, options = {}) {
    return this.requestAllPages(`/api/v1/folders/${encodePathSegment(folderId)}/files`, {
      content_types: options.contentTypes,
      exclude_content_types: options.excludeContentTypes,
      include: options.include,
      only: options.only,
      search_term: options.searchTerm,
      sort: options.sort,
      order: options.order
    });
  }

  getFile(fileId, params = {}) {
    return this.request(`/api/v1/files/${encodePathSegment(fileId)}`, params).then(
      ({ data }) => data
    );
  }

  getFilePublicUrl(fileId, params = {}) {
    return this.request(`/api/v1/files/${encodePathSegment(fileId)}/public_url`, params).then(
      ({ data }) => data
    );
  }

  listModules(courseId) {
    return this.requestAllPages(`/api/v1/courses/${encodePathSegment(courseId)}/modules`);
  }

  listModuleItems(courseId, moduleId, options = {}) {
    return this.requestAllPages(
      `/api/v1/courses/${encodePathSegment(courseId)}/modules/${encodePathSegment(
        moduleId
      )}/items`,
      {
        include: options.include || ["content_details"]
      }
    );
  }

  listCoursePages(courseId, options = {}) {
    return this.requestAllPages(`/api/v1/courses/${encodePathSegment(courseId)}/pages`, {
      include: options.include,
      sort: options.sort,
      order: options.order,
      search_term: options.searchTerm,
      published: options.published
    });
  }

  getCoursePage(courseId, urlOrId) {
    return this.request(
      `/api/v1/courses/${encodePathSegment(courseId)}/pages/${encodePathSegment(urlOrId)}`
    ).then(({ data }) => data);
  }

  getFileDownloadPath(fileId, options = {}) {
    const encodedFileId = encodePathSegment(fileId);

    if (options.courseId) {
      return `/courses/${encodePathSegment(options.courseId)}/files/${encodedFileId}/download`;
    }

    return `/files/${encodedFileId}/download`;
  }

  async listModuleGraph(courseId) {
    const modules = await this.listModules(courseId);
    const modulesWithItems = await Promise.all(
      modules.map(async (module) => {
        try {
          return {
            ...module,
            items: await this.listModuleItems(courseId, module.id),
            itemsLoadError: ""
          };
        } catch (error) {
          return {
            ...module,
            items: [],
            itemsLoadError: error.message
          };
        }
      })
    );

    return modulesWithItems;
  }
}

async function getFilesByIds(client, fileIds) {
  const fileResults = await Promise.all(
    getUniqueValues(fileIds).map((fileId) =>
      loadOptionalMaterial(`file:${fileId}`, () => client.getFile(fileId))
    )
  );

  return {
    files: fileResults.flatMap((result) => (result.data ? [result.data] : [])),
    errors: fileResults.flatMap((result) => (result.error ? [result.error] : []))
  };
}

function normalizeCourseMaterial(type, item, courseId) {
  const id = item.id || item.page_id || item.url || item.html_url || item.title;
  const htmlUrl =
    item.html_url ||
    (type === "page" && item.url
      ? `${window.location.origin}/courses/${courseId}/pages/${item.url}`
      : "");

  return {
    type,
    id,
    title: item.title || item.name || item.display_name || `${type} ${id}`,
    htmlUrl,
    apiUrl: item.url && String(item.url).startsWith("http") ? item.url : "",
    body: item.body || item.description || item.message || "",
    published: item.published,
    lockedForUser: Boolean(item.locked_for_user),
    dueAt: item.due_at || "",
    updatedAt: item.updated_at || item.posted_at || item.last_reply_at || "",
    raw: item
  };
}

function normalizeModuleMaterial(module, item, courseId) {
  return {
    type: "moduleItem",
    id: item.id,
    moduleId: module.id,
    moduleName: module.name,
    title: item.title,
    itemType: item.type,
    contentId: item.content_id || "",
    htmlUrl: item.html_url || "",
    apiUrl: item.url || "",
    externalUrl: item.external_url || "",
    pageUrl: item.page_url || "",
    completionRequirement: item.completion_requirement || null,
    contentDetails: item.content_details || null,
    fileDownloadPath:
      item.type === "File" && item.content_id
        ? `/courses/${courseId}/files/${item.content_id}/download`
        : "",
    raw: item
  };
}

function getLinksFromMaterials(materials = []) {
  return materials.flatMap((material) =>
    getLinksFromHtml(material.body, {
      type: material.type,
      id: material.id,
      title: material.title
    })
  );
}

function getLinksFromModuleMaterials(materials = []) {
  return materials.flatMap((material) => {
    const source = {
      type: "moduleItem",
      id: material.id,
      title: material.title
    };
    const directLinks = [
      normalizeLink(material.title, material.htmlUrl, source),
      normalizeLink(material.title, material.apiUrl, source),
      normalizeLink(material.title, material.externalUrl, source),
      normalizeLink(material.title, material.fileDownloadPath, source)
    ].filter(Boolean);

    return directLinks;
  });
}

async function getCurrentCanvasCourseMaterials() {
  const courseId = getCurrentCourseId();
  const client = new CanvasSessionApiClient();
  const [
    courseResult,
    modulesResult,
    pagesResult,
    assignmentsResult,
    announcementsResult,
    discussionsResult
  ] = await Promise.all([
    loadOptionalMaterial("course", () =>
      client.getCourse(courseId, { include: ["term", "course_image"] })
    ),
    loadOptionalMaterial("modules", () => client.listModuleGraph(courseId)),
    loadOptionalMaterial("pages", () => client.listCoursePages(courseId, { include: ["body"] })),
    loadOptionalMaterial("assignments", () => client.listAssignments(courseId, { orderBy: "position" })),
    loadOptionalMaterial("announcements", () =>
      client.listAnnouncements(courseId, { activeOnly: true })
    ),
    loadOptionalMaterial("discussions", () =>
      client.listDiscussionTopics(courseId, {
        onlyAnnouncements: false,
        orderBy: "recent_activity"
      })
    )
  ]);
  const modules = modulesResult.data || [];
  const pages = pagesResult.data || [];
  const assignments = assignmentsResult.data || [];
  const announcements = announcementsResult.data || [];
  const discussions = discussionsResult.data || [];
  const pageMaterials = pages.map((page) => normalizeCourseMaterial("page", page, courseId));
  const assignmentMaterials = assignments.map((assignment) =>
    normalizeCourseMaterial("assignment", assignment, courseId)
  );
  const announcementMaterials = announcements.map((announcement) =>
    normalizeCourseMaterial("announcement", announcement, courseId)
  );
  const discussionMaterials = discussions.map((discussion) =>
    normalizeCourseMaterial("discussion", discussion, courseId)
  );
  const moduleMaterials = modules.flatMap((module) =>
    (module.items || []).map((item) => normalizeModuleMaterial(module, item, courseId))
  );
  const contentMaterials = [
    ...pageMaterials,
    ...assignmentMaterials,
    ...announcementMaterials,
    ...discussionMaterials
  ];
  const links = getUniqueLinks([
    ...getRenderedLinks({ type: "renderedPage", id: window.location.pathname, title: document.title }),
    ...getLinksFromMaterials(contentMaterials),
    ...getLinksFromModuleMaterials(moduleMaterials)
  ]);
  const linkedFileIds = getUniqueValues([
    ...getFileIdsFromModules(modules),
    ...getFileIdsFromPages(pages),
    ...getFileIdsFromLinks(links)
  ]);
  const linkedFilesResult = await getFilesByIds(client, linkedFileIds);
  const files = getUniqueFiles(linkedFilesResult.files);
  const errors = [
    courseResult.error,
    modulesResult.error,
    pagesResult.error,
    assignmentsResult.error,
    announcementsResult.error,
    discussionsResult.error,
    ...linkedFilesResult.errors
  ].filter(Boolean);

  return {
    canvasBaseUrl: window.location.origin,
    courseId,
    course: courseResult.data,
    modules,
    materials: {
      modules: moduleMaterials,
      pages: pageMaterials,
      assignments: assignmentMaterials,
      announcements: announcementMaterials,
      discussions: discussionMaterials
    },
    files,
    presentationFiles: files.filter(isPresentationFile),
    links,
    errors,
    unavailable: errors.map((error) => error.name),
    linkedFileIds
  };
}

window.CanvasSessionApi = {
  CanvasSessionApiClient,
  getCurrentCanvasCourseMaterials
};
