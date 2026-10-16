/* Quick Job Apply Autofill — content script.
 * Universal filler: works on plain DOM, Shadow DOM (incl. nested),
 * Angular/React/Vue SPAs (SmartRecruiters oneclick-ui, Workday,
 * Greenhouse, Lever, etc.), iframes (via all_frames) and custom elements.
 */
(() => {
  if (window.__qja_loaded && window.__qja_fill) return;
  window.__qja_loaded = true;

  // ---- Field definitions: key -> keywords to match ----
  // Order matters: more specific first (first-name before generic name).
  const FIELDS = [
    { key: "firstName", keys: ["first name", "firstname", "first-name", "given name", "givenname", "fname", "forename", "vorname"] },
    { key: "lastName", keys: ["last name", "lastname", "last-name", "family name", "familyname", "surname", "lname", "nachname"] },
    { key: "fullName", keys: ["full name", "fullname", "full-name", "your name", "applicant name", "candidate name", "name and surname"] },
    { key: "email", keys: ["email", "e-mail", "mail id", "email id", "email address", "e mail"] },
    { key: "phone", keys: ["phone", "mobile", "cell", "tel", "telephone", "contact number", "phone number", "mobile number", "telefon", "handy"] },
    { key: "street", keys: ["street", "address line 1", "address1", "address line1", "address 1"] },
    { key: "address", keys: ["address", "street address", "mailing address", "permanent address", "current address", "location address", "address line", "place of residence", "residence"] },
    { key: "city", keys: ["city", "town", "suburb", "ort", "stadt"] },
    { key: "state", keys: ["state", "province", "region"] },
    { key: "zip", keys: ["zip", "postal", "postcode", "post code", "zip code", "pin code", "pincode", "plz"] },
    { key: "country", keys: ["country", "nationality", "citizenship", "land"] },
    { key: "dob", keys: ["date of birth", "dob", "birth date", "birthday", "birthdate"] },
    { key: "gender", keys: ["gender", "sex"] },
    { key: "jobTitle", keys: ["job title", "current title", "designation", "position title", "role title", "title/position"] },
    { key: "company", keys: ["current company", "current employer", "employer", "organization", "organisation", "company name", "present employer"] },
    { key: "experience", keys: ["experience", "years of experience", "total experience", "work experience", "yrs of exp"] },
    { key: "currentCTC", keys: ["current ctc", "current salary", "present ctc", "current compensation"] },
    { key: "expectedCTC", keys: ["expected ctc", "expected salary", "desired salary", "salary expectation", "expected compensation"] },
    { key: "noticePeriod", keys: ["notice period", "notice", "joining", "availability"] },
    { key: "linkedin", keys: ["linkedin", "linked-in"] },
    { key: "github", keys: ["github", "git hub"] },
    { key: "portfolio", keys: ["portfolio"] },
    { key: "website", keys: ["website", "personal site", "blog url", "web site", "homepage", "url"] },
    { key: "summary", keys: ["summary", "about you", "about me", "profile summary", "bio", "tell us about yourself", "brief intro", "message to hiring", "message to the hiring", "cover message"] },
    { key: "coverLetter", keys: ["cover letter", "coverletter", "why should we hire", "why do you want", "motivation", "additional information"] },
  ];

  // Generic fallbacks checked LAST so they don't steal specific fields.
  const FALLBACKS = [
    { key: "firstName", keys: ["fname"] },
    { key: "phone", keys: ["contact"] },
    { key: "address", keys: ["addr"] },
  ];

  // Native autocomplete attribute -> profile key (HTML spec values)
  const AUTOCOMPLETE_MAP = {
    "given-name": "firstName", "fname": "firstName",
    "family-name": "lastName", "lname": "lastName",
    "name": "fullName", "honorific-prefix": "fullName",
    "email": "email",
    "tel": "phone", "tel-national": "phone", "tel-country-code": "phone",
    "street-address": "address", "address-line1": "street", "address-line2": "address",
    "address-level2": "city", "address-level1": "state",
    "postal-code": "zip", "country-name": "country", "country": "country",
    "bday": "dob", "sex": "gender",
    "organization-title": "jobTitle", "organization": "company",
    "url": "website", "photo": null,
  };

  function norm(s) {
    return (s || "")
      .toString()
      // split camelCase: firstName -> first Name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ---- Deep DOM traversal (pierces nested Shadow DOM) ----
  function deepCollectFillable(root, out, depth, seen) {
    if (!root || depth > 20) return out;
    out = out || [];
    seen = seen || new Set();
    let els = [];
    try {
      if (root.querySelectorAll) {
        els = root.querySelectorAll(
          "input, textarea, select, [contenteditable], [role='textbox'], [role='combobox'], [role='searchbox']"
        );
      }
    } catch (e) { /* ignore */ }
    for (const el of els) {
      if (!seen.has(el)) { seen.add(el); out.push(el); }
      // Nested shadow roots on the element itself or its descendants are
      // covered by the recursive walk below; handle element's own root here.
      if (el.shadowRoot) deepCollectFillable(el.shadowRoot, out, depth + 1, seen);
    }
    // Walk every descendant's shadowRoot (covers custom elements like
    // SmartRecruiters' SPL-INPUT, SPL-DROPZONE wrappers, etc.)
    try {
      const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const node of all) {
        if (node.shadowRoot && !seen.has(node.shadowRoot)) {
          seen.add(node.shadowRoot);
          deepCollectFillable(node.shadowRoot, out, depth + 1, seen);
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function getRootHostChain(el) {
    // Walk up through shadow hosts to collect context (labels often live
    // outside the inner shadow root, e.g. <slot> light DOM).
    const chain = [];
    let node = el;
    let guard = 0;
    while (node && guard++ < 8) {
      const root = node.getRootNode && node.getRootNode();
      if (root && root instanceof ShadowRoot) {
        if (root.host) {
          chain.push(root.host);
          node = root.host;
          continue;
        }
      }
      break;
    }
    return chain;
  }

  function textOf(node) {
    try {
      const t = node.innerText || node.textContent || "";
      return t.slice(0, 200);
    } catch (e) { return ""; }
  }

  // Gather every textual signal for an element (light DOM + shadow context).
  function signalsFor(el) {
    const parts = [];
    const push = (v) => { const n = norm(v); if (n) parts.push(n); };
    try {
      push(el.name); push(el.id); push(el.placeholder);
      push(el.getAttribute && el.getAttribute("aria-label"));
      push(el.getAttribute && el.getAttribute("aria-placeholder"));
      push(el.getAttribute && el.getAttribute("title"));
      push(el.getAttribute && el.getAttribute("data-automation-id"));
      push(el.getAttribute && el.getAttribute("data-testid"));
      push(el.getAttribute && el.getAttribute("data-test"));
      push(el.getAttribute && el.getAttribute("data-qa"));
      push(el.getAttribute && el.getAttribute("data-field"));
      push(el.getAttribute && el.getAttribute("data-name"));
      push(el.getAttribute && el.getAttribute("name"));
      // class hints like "first-name-input" (low quality, but helps custom els)
      if (el.className && typeof el.className === "string") {
        for (const c of el.className.split(/\s+/).slice(0, 8)) {
          if (/name|mail|phone|tel|city|country|addr|city|zip|post|gender|company|linkedin|github/i.test(c)) push(c);
        }
      }
      push(el.autocomplete);
      push(el.getAttribute && el.getAttribute("autocomplete"));
      push(el.type);
      push(el.inputMode);

      const doc = el.ownerDocument || document;

      // <label for="id">
      if (el.id) {
        try {
          const lbl = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lbl) push(lbl.innerText);
        } catch (e) { /* bad id */ }
      }
      // wrapping label
      const wrap = el.closest && el.closest("label");
      if (wrap) push(textOf(wrap));
      // aria-labelledby
      const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
      if (labelledby) {
        labelledby.split(/\s+/).forEach((id) => {
          const n = (el.getRootNode && el.getRootNode().getElementById)
            ? el.getRootNode().getElementById(id)
            : doc.getElementById(id);
          if (n) push(textOf(n));
        });
      }
      // slot: label text is often slotted light-DOM content
      if (el.assignedSlot) {
        push(el.assignedSlot.name);
        const slotParent = el.assignedSlot.closest && el.assignedSlot.closest("label, div, span");
        if (slotParent) push(textOf(slotParent));
      }
      // nearby text in same root: parent row / previous sibling
      const parent = el.closest && el.closest("div, li, tr, fieldset, section, article");
      if (parent) {
        const labelEl = parent.querySelector && parent.querySelector("label, legend, span, div");
        if (labelEl && labelEl !== el && !labelEl.contains(el)) push(textOf(labelEl));
        else push(textOf(parent).split("\n")[0]);
      }
      const prev = el.previousElementSibling;
      if (prev) push(textOf(prev));

      // Shadow host chain: attributes + light-DOM context of each host
      for (const host of getRootHostChain(el)) {
        push(host.getAttribute && host.getAttribute("label"));
        push(host.getAttribute && host.getAttribute("name"));
        push(host.getAttribute && host.getAttribute("data-test"));
        push(host.getAttribute && host.getAttribute("data-testid"));
        push(host.getAttribute && host.getAttribute("data-automation-id"));
        push(host.tagName);
        // host's parent row text (where SmartRecruiters puts the <slot> label)
        const hParent = host.parentElement;
        if (hParent) push(textOf(hParent).split("\n")[0]);
        const hPrev = host.previousElementSibling;
        if (hPrev) push(textOf(hPrev));
      }
    } catch (e) { /* ignore DOM quirks */ }

    return parts.filter(Boolean);
  }

  function matchField(el, profile) {
    // 1. autocomplete attribute wins
    const ac = norm(el.autocomplete || (el.getAttribute && el.getAttribute("autocomplete")) || "");
    if (ac) {
      for (const token of ac.split(" ")) {
        if (AUTOCOMPLETE_MAP[token] && profile[AUTOCOMPLETE_MAP[token]]) return AUTOCOMPLETE_MAP[token];
      }
    }
    // 2. input type=email/tel
    const type = (el.type || "").toLowerCase();
    if (type === "email" && profile.email) return "email";
    if (type === "tel" && profile.phone) return "phone";
    const sigParts = signalsFor(el);
    const sigJoined = sigParts.join(" | ");
    if ((type === "date" || (el.placeholder && (el.placeholder.includes("DD") || el.placeholder.includes("YYYY"))))) {
      const sig = sigJoined;
      if (/dob|birth|bday/.test(sig) && profile.dob) return "dob";
    }

    // 3. keyword match against combined signals
    const sig = " " + sigJoined + " ";
    const allDefs = [...FIELDS, ...FALLBACKS];
    let best = null, bestLen = 0;
    for (const def of allDefs) {
      if (profile[def.key] == null || profile[def.key] === "") continue;
      for (const kw of def.keys) {
        const k = norm(kw);
        if (sig.includes(" " + k + " ") || sig.includes(" " + k.replace(/ /g, "") + " ") || sig === ` ${k} `) {
          if (k.length > bestLen) { best = def.key; bestLen = k.length; }
        } else if (k.length >= 5 && sig.includes(k) && k.length > bestLen) {
          const compact = sig.replace(/ /g, "");
          if (compact.includes(k.replace(/ /g, ""))) { best = def.key; bestLen = k.length; }
        }
      }
    }

    // 4. "confirm email" style second field -> same email value
    if (!best && /confirm|retype|re enter|repeat/.test(sig) && /e.?mail/.test(sig.replace(/ /g, "")) && profile.email) {
      return "email";
    }

    // 5. Bare generic "name" -> fullName (only if nothing else matched)
    if (!best && /\bname\b/.test(sig) && profile.fullName) return "fullName";

    return best;
  }

  function fire(el, type, Ctor, init) {
    try {
      const Evt = Ctor || Event;
      el.dispatchEvent(new Evt(type, Object.assign({ bubbles: true, cancelable: true, composed: true }, init || {})));
    } catch (e) {
      try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e2) { /* ignore */ }
    }
  }

  function setValue(el, value) {
    const tag = el.tagName;
    if (tag === "SELECT") {
      const opts = [...el.options];
      const lv = norm(value);
      let hit = opts.find((o) => norm(o.text) === lv || norm(o.value) === lv)
        || opts.find((o) => { const t = norm(o.text); return t && (t.includes(lv) || lv.includes(t)); });
      if (hit) {
        el.focus && el.focus();
        el.value = hit.value;
        fire(el, "input", InputEvent, { data: value });
        fire(el, "change", Event);
        el.blur && el.blur();
        return true;
      }
      return false;
    }
    if (el.type === "checkbox" || el.type === "radio") return false;
    if (el.type === "file") return false;
    // contenteditable / custom textbox roles
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || (el.getAttribute("role") === "textbox" && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag))) {
      try {
        el.focus && el.focus();
        el.textContent = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: value }));
        fire(el, "change", Event);
        el.blur && el.blur();
        return true;
      } catch (e) { return false; }
    }
    if (!/^(INPUT|TEXTAREA)$/.test(tag)) return false;
    if (el.disabled || el.readOnly) return false;
    try { el.focus && el.focus(); } catch (e) { /* ignore */ }
    // Framework-safe native setter (React / Angular / Vue)
    try {
      const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    } catch (e) {
      try { el.value = value; } catch (e2) { return false; }
    }
    fire(el, "input", InputEvent, { data: value });
    fire(el, "change", Event);
    // Extra events some frameworks listen for
    fire(el, "keydown", KeyboardEvent, { key: "a" });
    fire(el, "keyup", KeyboardEvent, { key: "a" });
    try { el.blur && el.blur(); } catch (e) { /* ignore */ }
    return true;
  }

  async function getProfile() {
    try {
      const stored = await chrome.storage.local.get(null);
      const hasStored = stored && Object.keys(stored).some((k) => stored[k] !== "" && stored[k] != null);
      if (hasStored) return { ...EMPTY_PROFILE, ...DEFAULT_PROFILE_EMPTY, ...stored };
    } catch (e) { /* storage unavailable (edge cases) */ }
    return { ...EMPTY_PROFILE, ...DEFAULT_PROFILE_EMPTY };
  }

  // No hard-coded data — empty shape only. Real values come from chrome.storage.
  const EMPTY_PROFILE = {
    firstName: "", lastName: "", fullName: "", email: "", phone: "",
    address: "", street: "", city: "", state: "", zip: "", country: "",
    dob: "", gender: "", jobTitle: "", company: "", experience: "",
    currentCTC: "", expectedCTC: "", noticePeriod: "", linkedin: "",
    github: "", portfolio: "", website: "", summary: "", coverLetter: "",
    authorization: "",
  };
  // Injected DEFAULT_PROFILE is empty now; keep for key-list compatibility.
  const DEFAULT_PROFILE_EMPTY = (typeof DEFAULT_PROFILE !== "undefined" && DEFAULT_PROFILE) || {};
  const DEFAULT_PROFILE_FALLBACK = { ...EMPTY_PROFILE, ...DEFAULT_PROFILE_EMPTY };

  function splitFullName(full) {
    const parts = (full || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return {};
    if (parts.length === 1) return { firstName: parts[0] };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  async function fillAll() {
    const profile = await getProfile();
    const hasData = Object.values(profile).some((v) => typeof v === "string" ? v.trim() !== "" : v != null);
    if (!hasData) return { filled: 0, skipped: 0, total: 0, details: [], noProfile: true };
    // derive fullName if empty; split it if first/last empty
    if (!profile.fullName && (profile.firstName || profile.lastName)) {
      profile.fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    }
    if ((!profile.firstName || !profile.lastName) && profile.fullName) {
      const split = splitFullName(profile.fullName);
      if (!profile.firstName && split.firstName) profile.firstName = split.firstName;
      if (!profile.lastName && split.lastName) profile.lastName = split.lastName;
    }
    const els = deepCollectFillable(document);
    let filled = 0, skipped = 0;
    const details = [];
    for (const el of els) {
      try {
        if (el.disabled || el.readOnly) continue;
        const t = (el.type || "").toLowerCase();
        if (t === "password" || t === "hidden" || t === "submit" || t === "button" || t === "file" || t === "image") continue;
        // skip invisible placeholders but keep shadow-DOM els (offsetParent is
        // null inside closed layouts, so only skip display:none in light DOM)
        if (el.offsetParent === null && el.tagName !== "BODY") {
          try {
            const cs = window.getComputedStyle(el);
            if (cs && (cs.display === "none" || cs.visibility === "hidden")) continue;
          } catch (e) { /* ignore */ }
        }
        const cur = el.isContentEditable ? (el.textContent || "") : (el.value || "");
        if (cur && el.tagName !== "SELECT") { skipped++; continue; } // don't clobber user-typed values
        const key = matchField(el, profile);
        if (key && profile[key]) {
          if (setValue(el, profile[key])) {
            filled++;
            try {
              el.style.outline = "2px solid #22c55e";
              setTimeout(() => { try { el.style.outline = ""; } catch (e) {} }, 2500);
            } catch (e) { /* custom els may not have style */ }
          }
          details.push({ key, tag: el.tagName });
        }
      } catch (e) { /* per-field fault tolerance */ }
    }
    return { filled, skipped, total: els.length, details };
  }

  window.__qja_fill = fillAll;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action === "FILL") {
      fillAll().then(sendResponse);
      return true; // async
    }
    if (msg?.action === "PING") sendResponse({ ok: true });
  });
})();
