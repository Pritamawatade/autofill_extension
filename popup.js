/* Popup: Start Filling button + editable profile stored in chrome.storage.local */
const FIELDS = [
  ["firstName", "First name"], ["lastName", "Last name"],
  ["fullName", "Full name"], ["email", "Email"],
  ["phone", "Phone"], ["address", "Address"],
  ["street", "Street"], ["city", "City"],
  ["state", "State"], ["zip", "ZIP / PIN"],
  ["country", "Country"], ["dob", "DOB (YYYY-MM-DD)"],
  ["gender", "Gender"], ["jobTitle", "Job title"],
  ["company", "Company"], ["experience", "Experience"],
  ["currentCTC", "Current CTC"], ["expectedCTC", "Expected CTC"],
  ["noticePeriod", "Notice period"], ["linkedin", "LinkedIn"],
  ["github", "GitHub"], ["portfolio", "Portfolio"],
  ["website", "Website"], ["summary", "Summary"],
  ["coverLetter", "Cover letter"],
];

const form = document.getElementById("form");
const status = document.getElementById("status");
const detailsEl = document.getElementById("profileDetails");
const firstRunHint = document.getElementById("firstRunHint");

// Build inputs
for (const [key, label] of FIELDS) {
  const l = document.createElement("label");
  l.textContent = label;
  const inp = key === "summary" || key === "coverLetter"
    ? document.createElement("textarea")
    : document.createElement("input");
  inp.id = "f_" + key;
  inp.dataset.key = key;
  if (key === "summary" || key === "coverLetter") l.classList.add("full");
  l.appendChild(inp);
  form.appendChild(l);
}

function isEmptyProfile(obj) {
  return !obj || !Object.values(obj).some((v) => typeof v === "string" ? v.trim() !== "" : v != null && v !== "");
}

async function loadProfile() {
  let stored = {};
  try { stored = await chrome.storage.local.get(null); } catch (e) {}
  const base = (typeof DEFAULT_PROFILE !== "undefined" ? DEFAULT_PROFILE : {});
  const merged = { ...base, ...stored };
  document.querySelectorAll("[data-key]").forEach((el) => {
    el.value = merged[el.dataset.key] || "";
  });

  // First-run flow: nothing saved yet -> prompt user to fill + save once.
  const firstRun = isEmptyProfile(stored);
  if (firstRunHint) firstRunHint.style.display = firstRun ? "block" : "none";
  if (detailsEl) detailsEl.open = firstRun ? true : detailsEl.open;
  if (firstRun) status.textContent = "No saved info yet — fill below and click Save info.";
  return { stored, firstRun };
}
loadProfile();

document.getElementById("saveBtn").addEventListener("click", async () => {
  const data = {};
  document.querySelectorAll("[data-key]").forEach((el) => (data[el.dataset.key] = el.value.trim()));
  // Auto-derive fullName so single "Full name" fields still work.
  if (!data.fullName && (data.firstName || data.lastName)) {
    data.fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim();
    const fullEl = document.querySelector('[data-key="fullName"]');
    if (fullEl) fullEl.value = data.fullName;
  }
  if (!data.firstName && !data.lastName && !data.email && !data.phone) {
    status.textContent = "Please fill at least name, email or phone before saving.";
    return;
  }
  await chrome.storage.local.set(data);
  if (firstRunHint) firstRunHint.style.display = "none";
  status.textContent = "Saved ✓ — now click Start Filling on any job form.";
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.clear();
  document.querySelectorAll("[data-key]").forEach((el) => (el.value = ""));
  if (firstRunHint) firstRunHint.style.display = "block";
  if (detailsEl) detailsEl.open = true;
  status.textContent = "Cleared. Fill and Save again to reuse.";
});

document.getElementById("fillBtn").addEventListener("click", async () => {
  status.textContent = "Filling…";
  try {
    // Block fill when nothing has been saved yet (first-run).
    let stored = {};
    try { stored = await chrome.storage.local.get(null); } catch (e) {}
    if (isEmptyProfile(stored)) {
      if (firstRunHint) firstRunHint.style.display = "block";
      if (detailsEl) detailsEl.open = true;
      status.textContent = "Save your info first, then click Start Filling.";
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { status.textContent = "No active tab."; return; }
    // Ensure content script is injected (handles SPAs / late loads)
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["profile.js", "content.js"] });
    } catch (e) { /* already injected — ignore */ }
    const res = await chrome.tabs.sendMessage(tab.id, { action: "FILL" });
    if (res?.noProfile) {
      if (firstRunHint) firstRunHint.style.display = "block";
      if (detailsEl) detailsEl.open = true;
      status.textContent = "No saved info — fill above and click Save info first.";
    } else status.textContent = res?.filled
      ? `Filled ${res.filled} field(s) ✓ (${res.skipped || 0} already had values)`
      : "No matching fields found on this page.";
  } catch (e) {
    status.textContent = "Could not fill here (try reloading the page).";
  }
});
