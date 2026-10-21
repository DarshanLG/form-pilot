import type { Json, Profile } from "./api";

/**
 * Empty profile with the shape of data/profile.example.json (keep in sync). New users start here;
 * the model reads these keys by name (profile.name.first, profile.links.linkedin, ...).
 */
export const TEMPLATE: Profile = {
  name: { first: "", last: "", preferred: "" },
  pronouns: "",
  email: "",
  phone: "",
  location: { city: "", state: "", country: "", zip: "" },
  links: { linkedin: "", github: "", portfolio: "", twitter: "" },
  education: [{ school: "", degree: "", field: "", gpa: "", end: "" }],
  work: [{ company: "", title: "", start: "", end: "", summary: "" }],
  languages: [],
  work_authorization: { authorized_us: false, needs_sponsorship: false },
  preferences: { start_date: "", relocate: false, salary_expectation: "", notice_period: "" },
  eeo: {
    gender: "decline",
    race: "decline",
    veteran: "decline",
    disability: "decline",
    hispanic: "decline",
    lgbtq: "decline",
    sexual_orientation: "decline",
    age: "decline",
    religion: "decline",
  },
  consent: { marketing: false },
  files: { resume: "", cover_letter: "" },
  answers: { how_did_you_hear: "", previously_employed_at: [], why_this_company: "" },
};

export type Path = (string | number)[];

export function getIn(obj: Json, path: Path): Json {
  return path.reduce<Json>((o, k) => (o != null && typeof o === "object" ? (o as never)[k] ?? null : null), obj);
}

/** Immutable set: copies every container on the way down. */
export function setIn(obj: Json, path: Path, value: Json): Json {
  if (!path.length) return value;
  const [k, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = obj.slice();
    copy[k as number] = setIn(obj[k as number] ?? null, rest, value);
    return copy;
  }
  const base = obj && typeof obj === "object" ? obj : {};
  return { ...base, [k]: setIn((base as Record<string, Json>)[k as string] ?? null, rest, value) };
}

/** A blank item shaped like the array's first element (for "Add another" on education/work). */
export function blankLike(sample: Json): Json {
  if (Array.isArray(sample)) return [];
  if (sample && typeof sample === "object")
    return Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, blankLike(v)]));
  if (typeof sample === "boolean") return false;
  if (typeof sample === "number") return 0;
  return "";
}

/** Keys from the template the stored profile lacks (older profiles), filled with blanks. Never drops keys. */
export function withTemplate(p: Profile): Profile {
  const merge = (t: Json, v: Json | undefined): Json => {
    if (v === undefined) return t;
    if (t && typeof t === "object" && !Array.isArray(t) && v && typeof v === "object" && !Array.isArray(v))
      return { ...Object.fromEntries(Object.entries(t).map(([k, tv]) => [k, merge(tv, (v as Record<string, Json>)[k])])), ...Object.fromEntries(Object.entries(v).filter(([k]) => !(k in t))) };
    return v;
  };
  return merge(TEMPLATE, p) as Profile;
}

/** What the server requires (server/src/schemas.ts Profile). */
export function profileError(p: Profile): string | null {
  const name = p.name as Record<string, Json> | undefined;
  if (!name || typeof name.first !== "string" || typeof name.last !== "string") return "name.first and name.last are required";
  if (!name.first.trim() || !name.last.trim()) return "Fill in your first and last name";
  return null;
}

export const label = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
