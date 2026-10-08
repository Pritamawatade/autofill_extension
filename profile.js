// ============================================================
// DEFAULT (empty) PROFILE — no hard-coded personal data.
// First time you open the extension popup, fill in your info
// once and click "Save info". It is stored in
// chrome.storage.local and reused on every page via Start Filling.
// To reset, use "Clear saved info" in the popup.
// ============================================================
const DEFAULT_PROFILE = {
  firstName: "",
  lastName: "",
  fullName: "",
  email: "",
  phone: "",
  address: "",
  street: "",
  city: "",
  state: "",
  zip: "",
  country: "",
  dob: "",
  gender: "",
  jobTitle: "",
  company: "",
  experience: "",
  currentCTC: "",
  expectedCTC: "",
  noticePeriod: "",
  linkedin: "",
  github: "",
  portfolio: "",
  website: "",
  summary: "",
  coverLetter: "",
  authorization: "" // work authorization / visa sponsorship helper
};
