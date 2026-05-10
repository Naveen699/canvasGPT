let latestExtractedData = null;

const output = document.getElementById("output");
const status = document.getElementById("status");
const extractBtn = document.getElementById("extractBtn");
const sendBtn = document.getElementById("sendBtn");

function setBusy(isBusy) {
  extractBtn.disabled = isBusy;
  sendBtn.disabled = isBusy;
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

extractBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Extracting data from the active Canvas page...");

  try {
    latestExtractedData = await sendRuntimeMessage({
      type: "EXTRACT_ACTIVE_PAGE_DATA"
    });

    output.textContent = JSON.stringify(latestExtractedData, null, 2);
    setStatus("Page data extracted.");
  } catch (error) {
    output.textContent = `Error: ${error.message}`;
    setStatus("Extraction failed.");
  } finally {
    setBusy(false);
  }
});

sendBtn.addEventListener("click", async () => {
  if (!latestExtractedData) {
    setStatus("Extract page data before sending it to the backend.");
    output.textContent = "Extract data first.";
    return;
  }

  setBusy(true);
  setStatus("Sending extracted data to the backend...");

  try {
    const result = await sendRuntimeMessage({
      type: "SEND_PAGE_DATA_TO_BACKEND",
      data: latestExtractedData
    });

    output.textContent = JSON.stringify(result, null, 2);
    setStatus("Backend received the extracted data.");
  } catch (error) {
    output.textContent = `Backend error: ${error.message}`;
    setStatus("Backend request failed.");
  } finally {
    setBusy(false);
  }
});
