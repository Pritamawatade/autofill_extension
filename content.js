/* Quick Job Apply Autofill — content script.
 * Scans inputs/textareas/selects, matches labels/attributes,
 * and fills from profile. Works on Workday, Greenhouse, Lever, etc.
 */
(() => {
  if (window.__qja_loaded) return;
  window.__qja_loaded = true;

  // ---- Field definitions: key -> keywords to match + autocomplete hints ----
  // Order matters: more specific first (first-name before generic name).
  const FIELDS = [
    { key: "firstName", keys: ["first name", "firstname", "first-name", "given name", "givenname", "fname", "forename"] },
    { key: "lastName", keys: ["last name", "lastname", "last-name", "family name", "familyname", "surname", "lname"] },
    { key: "fullName", keys: ["full name", "fullname", "full-name", "your name", "applicant name", "candidate name"] },
    { key: "email", keys: ["email", "e-mail", "mail id", "email id", "email address"], types: ["email"] },
    { key: "phone", keys: ["phone", "mobile", "cell", "tel", "telephone", "contact number", "phone number", "mobile number"], types: ["tel"] },
    { key: "street", keys: ["street", "address line 1", "address1", "address line1", "address 1"] },
    { key: "address", keys: ["address", "street address", "mailing address", "permanent address", "current address", "location address", "address line"] },
    { key: "city", keys: ["city", "town", "suburb"] },
    { key: "state", keys: ["state", "province", "region"] },
    { key: "zip", keys: ["zip", "postal", "postcode", "post code", "zip code", "pin code", "pincode"] },
    { key: "country", keys: ["country", "nationality", "citizenship"] },
    { key: "dob", keys: ["date of birth", "dob", "birth date", "birthday", "birthdate"] },
    { key: "gender", keys: ["gender", "sex"] },
    { key: "jobTitle", keys: ["job title", "current title", "designation", "position title", "role title", "title/position"] },
    { key: "company", keys: ["current company", "employer", "organization", "organisation", "company name", "present employer"] },
    { key: "experience", keys: ["experience", "years of experience", "total experience", "work experience", "yrs of exp"] },
    { key: "currentCTC", keys: ["current ctc", "current salary", "present ctc", "current compensation"] },
    { key: "expectedCTC", keys: ["expected ctc", "expected salary", "desired salary", "salary expectation", "expected compensation"] },
    { key: "noticePeriod", keys: ["notice period", "notice", "joining", "availability"] },
    { key: "linkedin", keys: ["linkedin", "linked-in"] },
    { key: "github", keys: ["github", "git hub"] },
    { key: "portfolio", keys: ["portfolio"] },
    { key: "website", keys: ["website", "personal site", "blog url", "web site", "homepage", "url"] },
    { key: "summary", keys: ["summary", "about you", "about me", "profile summary", "bio", "tell us about yourself", "brief intro"] },
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
    return (s || "").toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  // Gather every textual signal for an element.
  function signalsFor(el) {
    const parts = [];
    const push = (v) => { if (v) parts.push(norm(v)); };
    push(el.name); push(el.id); push(el.placeholder);
    push(el.getAttribute && el.getAttribute("aria-label"));
    push(el.getAttribute && el.getAttribute("data-automation-id"));
    push(el.getAttribute && el.getAttribute("data-testid"));
    push(el.autocomplete);

    // <label for="id">
    try {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) push(lbl.innerText);
      }
      // wrapping label
      const wrap = el.closest && el.closest("label");
      if (wrap) push(wrap.innerText);
      // aria-labelledby
      const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
      if (labelledby) {
        labelledby.split(/\s+/).forEach((id) => {
          const n = document.getElementById(id);
          if (n) push(n.innerText);
        });
      }
      // nearby text: parent row / previous sibling (for Workday-style divs)
      const parent = el.closest("div, li, tr, fieldset");
      if (parent) {
        const labelEl = parent.querySelector("label, legend, span, div");
        if (labelEl && labelEl !== el) push((labelEl.innerText || "").slice(0, 120));
      }
      const prev = el.previousElementSibling;
      if (prev) push((prev.innerText || "").slice(0, 120));
    } catch (e) { /* ignore DOM quirks */ }

    return parts.filter(Boolean);
  }

  function matchField(el, profile) {
    // 1. autocomplete attribute wins
    const ac = norm(el.autocomplete || el.getAttribute?.("autocomplete") || "");
    if (ac) {
      for (const token of ac.split(" ")) {
        if (AUTOCOMPLETE_MAP[token] && profile[AUTOCOMPLETE_MAP[token]]) return AUTOCOMPLETE_MAP[token];
      }
    }
    // 2. input type=email/tel
    const type = (el.type || "").toLowerCase();
    if (type === "email" && profile.email) return "email";
    if (type === "tel" && profile.phone) return "phone";
    if ((type === "date" || el.placeholder?.includes("DD") || el.placeholder?.includes("YYYY"))) {
      const sig = signalsFor(el).join(" | ");
      if (/dob|birth|bday/.test(sig) && profile.dob) return "dob";
    }

    // 3. keyword match against combined signals
    const sig = " " + signalsFor(el).join(" | ") + " ";
    const allDefs = [...FIELDS, ...FALLBACKS];
    let best = null, bestLen = 0;
    for (const def of allDefs) {
      if (profile[def.key] == null || profile[def.key] === "") continue;
      for (const kw of def.keys) {
        const k = norm(kw);
        // match whole-word-ish: pad with spaces
        if (sig.includes(" " + k + " ") || sig.includes(" " + k.replace(/ /g, "") + " ") || sig === ` ${k} `) {
          if (k.length > bestLen) { best = def.key; bestLen = k.length; }
        } else if (k.length >= 5 && sig.includes(k) && k.length > bestLen) {
          // substring fallback for ids like "applicantFirstName"
          const compact = sig.replace(/ /g, "");
          if (compact.includes(k.replace(/ /g, ""))) { best = def.key; bestLen = k.length; }
        }
      }
    }

    // 4. Bare generic "name" -> fullName (only if nothing else matched)
    if (!best && /\bname\b/.test(sig) && profile.fullName) return "fullName";

    return best;
  }

  function setValue(el, value) {
    if (el.tagName === "SELECT") {
      const opts = [...el.options];
      const lv = norm(value);
      let hit = opts.find((o) => norm(o.text) === lv || norm(o.value) === lv)
        || opts.find((o) => norm(o.text).includes(lv) || lv.includes(norm(o.text)));
      if (hit) {
        el.value = hit.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      return false;
    }
    if (el.type === "checkbox" || el.type === "radio") return false;
    // React-safe setter
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    try {
      const prev = el.value;
      if (setter) setter.call(el, value);
      else el.value = value;
      if (prev !== el.value || prev !== value) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Workday/React sometimes need key events + blur
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
      return true;
    } catch (e) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
  }

  async function getProfile() {
    try {
      const stored = await chrome.storage.local.get(null);
      const hasStored = stored && Object.keys(stored).some((k) => stored[k] !== "" && stored[k] != null);
      // No hard-coded personal data: use ONLY what user saved via popup.
      // DEFAULT_PROFILE is now empty and only provides the key list.
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

  async function fillAll() {
    const profile = await getProfile();
    const hasData = Object.values(profile).some((v) => typeof v === "string" ? v.trim() !== "" : v != null);
    if (!hasData) return { filled: 0, skipped: 0, total: 0, details: [], noProfile: true };
    // derive fullName if empty
    if (!profile.fullName && (profile.firstName || profile.lastName)) {
      profile.fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    }
    const els = document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), textarea, select");
    let filled = 0, skipped = 0;
    const details = [];
    els.forEach((el) => {
      if (el.disabled || el.readOnly) return;
      if (el.type === "password" || el.type === "hidden") return;
      if (el.value && el.tagName !== "SELECT") { skipped++; return; } // don't clobber user-typed values
      const key = matchField(el, profile);
      if (key && profile[key]) {
        if (setValue(el, profile[key])) {
          filled++;
          el.style.outline = "2px solid #22c55e";
          setTimeout(() => (el.style.outline = ""), 2500);
        }
        details.push({ key, tag: el.tagName });
      }
    });
    return { filled, skipped, total: els.length, details };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action === "FILL") {
      fillAll().then(sendResponse);
      return true; // async
    }
    if (msg?.action === "PING") sendResponse({ ok: true });
  });
})();
