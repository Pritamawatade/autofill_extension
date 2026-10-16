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
const draftHint = document.getElementById("draftHint");

// Pop-out mode: when opened as a full tab (?popout=1) the page persists
// across tab/window switches, so copy-paste never closes it.
try {
  if (new URLSearchParams(location.search).has("popout")) {
    document.body.classList.add("popout");
    const po = document.getElementById("popoutBtn");
    if (po) po.style.display = "none";
  }
} catch (e) { /* non-browser env */ }

// ---- Unsaved-typing draft (survives popup auto-close) ----
// Chrome closes extension popups on any focus loss — by design it cannot be
// prevented. So every keystroke is auto-saved to chrome.storage.session
// (separate from the saved profile in .local) and restored on reopen.
const DRAFT_KEY = "qja_draft";
const SAVE_TS_KEY = "__qja_savedAt";
async function sessionGet() {
  try {
    if (chrome.storage?.session) return await chrome.storage.session.get(DRAFT_KEY);
  } catch (e) { /* session storage unavailable */ }
  return {};
}
async function sessionSet(draft) {
  try {
    if (chrome.storage?.session) await chrome.storage.session.set({ [DRAFT_KEY]: draft });
  } catch (e) { /* ignore — worst case draft is lost, saved profile unaffected */ }
}
async function sessionClear() {
  try {
    if (chrome.storage?.session) await chrome.storage.session.remove(DRAFT_KEY);
  } catch (e) { /* ignore */ }
}
function collectForm() {
  const data = {};
  document.querySelectorAll("[data-key]").forEach((el) => (data[el.dataset.key] = el.value));
  return data;
}
let draftTimer = null;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    await sessionSet({ values: collectForm(), updatedAt: Date.now() });
    if (draftHint) {
      draftHint.style.display = "block";
      draftHint.textContent = "Typing auto-saved — safe to switch tabs, nothing is lost.";
    }
  }, 400);
}

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
  const savedAt = stored[SAVE_TS_KEY] || 0;
  let draftValues = null;
  try {
    const d = await sessionGet();
    const draft = d && d[DRAFT_KEY];
    if (draft?.values && Object.values(draft.values).some((v) => (v || "").trim?.() !== "")) {
      // Restore unsaved typing if it is newer than the last explicit Save
      // (or if nothing was ever saved).
      if (isEmptyProfile(stored) || (draft.updatedAt || 0) > savedAt) draftValues = draft.values;
    }
  } catch (e) { /* no draft */ }
  const merged = { ...base, ...stored, ...(draftValues || {}) };
  document.querySelectorAll("[data-key]").forEach((el) => {
    el.value = merged[el.dataset.key] || "";
  });
  if (draftValues && draftHint) {
    draftHint.style.display = "block";
    draftHint.textContent = "Restored your unsaved typing — click Save info to keep it.";
  }

  // First-run flow: nothing saved yet -> prompt user to fill + save once.
  const firstRun = isEmptyProfile(stored);
  if (firstRunHint) firstRunHint.style.display = firstRun ? "block" : "none";
  if (detailsEl) detailsEl.open = firstRun ? true : detailsEl.open;
  if (firstRun) status.textContent = "No saved info yet — fill below and click Save info.";
  return { stored, firstRun };
}
loadProfile();
form.addEventListener("input", scheduleDraftSave);

// Persistent surfaces: pop-out tab and side panel stay open while the user
// copies data from other tabs/windows (extension popups always close on blur).
document.getElementById("popoutBtn")?.addEventListener("click", async () => {
  try {
    await sessionSet({ values: collectForm(), updatedAt: Date.now() });
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?popout=1") });
    window.close();
  } catch (e) {
    status.textContent = "Could not open tab — your typing was auto-saved.";
  }
});
document.getElementById("sidePanelBtn")?.addEventListener("click", async () => {
  try {
    if (!chrome.sidePanel?.open) throw new Error("unsupported");
    await sessionSet({ values: collectForm(), updatedAt: Date.now() });
    try { await chrome.sidePanel.setOptions({ path: "popup.html", enabled: true }); } catch (e) { /* optional */ }
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch (e) {
    status.textContent = 'Side panel unavailable here — use "Open in tab" instead.';
  }
});

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
  try { await chrome.storage.local.set({ [SAVE_TS_KEY]: Date.now() }); } catch (e) { /* ignore */ }
  await sessionClear();
  if (draftHint) draftHint.style.display = "none";
  if (firstRunHint) firstRunHint.style.display = "none";
  status.textContent = "Saved ✓ — now click Start Filling on any job form.";
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.clear();
  await sessionClear();
  document.querySelectorAll("[data-key]").forEach((el) => (el.value = ""));
  if (draftHint) draftHint.style.display = "none";
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
    // Ensure content script is injected (handles SPAs / late loads,
    // Shadow-DOM pages like SmartRecruiters oneclick-ui, and iframes)
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["profile.js", "content.js"] });
    } catch (e) { /* already injected — ignore */ }
    // Run fill in EVERY frame (top + iframes). tabs.sendMessage only reaches
    // the top frame, so forms inside iframes would be missed.
    let res = null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => (typeof window.__qja_fill === "function" ? window.__qja_fill() : Promise.resolve(null)),
      });
      const frames = (results || []).map((r) => r?.result).filter(Boolean);
      if (frames.length) {
        res = frames.reduce((acc, r) => ({
          filled: (acc.filled || 0) + (r.filled || 0),
          skipped: (acc.skipped || 0) + (r.skipped || 0),
          total: (acc.total || 0) + (r.total || 0),
          details: [...(acc.details || []), ...(r.details || [])],
          noProfile: acc.noProfile && r.noProfile,
        }), { filled: 0, skipped: 0, total: 0, details: [], noProfile: true });
        if (res.total > 0) res.noProfile = false;
      }
    } catch (e) { /* executeScript blocked — fall back to messaging */ }
    if (!res) {
      try { res = await chrome.tabs.sendMessage(tab.id, { action: "FILL" }); }
      catch (e) { res = null; }
    }
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
