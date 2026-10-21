import { useEffect, useState } from "react";
import { api, type Json, type Profile } from "../api";
import { TEMPLATE, blankLike, label, profileError, setIn, withTemplate, type Path } from "../profile";

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<string | null>(null); // JSON of the last saved version
  const [raw, setRaw] = useState<string | null>(null); // raw-JSON mode text, or null for the form
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.profile().then(
      (res) => {
        const p = res ? withTemplate(res.profile) : TEMPLATE;
        setProfile(p);
        setSaved(res ? JSON.stringify(p) : null);
      },
      (e) => setStatus({ kind: "error", text: e.message }),
    );
  }, []);

  if (!profile) return status ? <p className="error">{status.text}</p> : <p className="muted">Loading…</p>;
  const dirty = JSON.stringify(profile) !== saved;
  const update = (path: Path, value: Json) => {
    setProfile(setIn(profile, path, value) as Profile);
    setStatus(null);
  };

  async function save() {
    let p = profile!;
    if (raw != null) {
      try {
        p = JSON.parse(raw);
      } catch (e) {
        return setStatus({ kind: "error", text: `Invalid JSON: ${(e as Error).message}` });
      }
    }
    const err = profileError(p);
    if (err) return setStatus({ kind: "error", text: err });
    try {
      const res = await api.saveProfile(p);
      setProfile(res.profile);
      setSaved(JSON.stringify(res.profile));
      if (raw != null) setRaw(JSON.stringify(res.profile, null, 2));
      setStatus({ kind: "ok", text: "Saved. The extension uses it from the next step." });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <>
      <section className="card row sticky">
        <p className="muted small">
          {saved == null ? "No profile saved yet: fill in at least your name, then save." : dirty || raw != null ? "Unsaved changes." : "All changes saved."}
        </p>
        <div className="buttons">
          <button onClick={() => setRaw(raw == null ? JSON.stringify(profile, null, 2) : null)}>
            {raw == null ? "Edit as JSON" : "Back to form"}
          </button>
          <button className="primary" onClick={save}>
            Save profile
          </button>
        </div>
      </section>
      {status && <p className={status.kind === "ok" ? "ok" : "error"}>{status.text}</p>}

      {raw != null ? (
        <textarea className="json" spellCheck={false} value={raw} onChange={(e) => setRaw(e.target.value)} />
      ) : (
        <div className="form-grid">
          {/* Top-level single values (pronouns, email, phone) share one card; each object gets its own. */}
          <section className="card">
            <h2>Basics</h2>
            {Object.entries(profile)
              .filter(([, v]) => v === null || typeof v !== "object")
              .map(([k, v]) => (
                <Field key={k} path={[k]} value={v} onChange={update} />
              ))}
          </section>
          {Object.entries(profile)
            .filter(([, v]) => v !== null && typeof v === "object")
            .map(([k, v]) => (
              <section className="card" key={k}>
                <h2>{label(k)}</h2>
                <Field path={[k]} value={v} onChange={update} />
              </section>
            ))}
        </div>
      )}
    </>
  );
}

/** Renders any JSON value: objects as labeled groups, arrays of objects as repeatable groups, lists as comma text. */
function Field({ path, value, onChange }: { path: Path; value: Json; onChange: (p: Path, v: Json) => void }) {
  const key = String(path[path.length - 1]);
  if (typeof value === "boolean")
    return (
      <label className="check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(path, e.target.checked)} /> {label(key)}
      </label>
    );
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x !== "object" || x === null))
      return (
        <label className="field">
          <span>{label(key)} <span className="muted small">(comma-separated)</span></span>
          <input
            value={value.join(", ")}
            onChange={(e) => onChange(path, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          />
        </label>
      );
    return (
      <div className="repeat">
        {value.map((item, i) => (
          <fieldset key={i}>
            <legend>
              #{i + 1}
              <button className="link" onClick={() => onChange(path, value.filter((_, j) => j !== i))}>
                remove
              </button>
            </legend>
            <Field path={[...path, i]} value={item} onChange={onChange} />
          </fieldset>
        ))}
        <button onClick={() => onChange(path, [...value, blankLike(value[0] ?? {})])}>Add another</button>
      </div>
    );
  }
  if (value && typeof value === "object")
    return (
      <div className="group">
        {Object.entries(value).map(([k, v]) => (
          <Field key={k} path={[...path, k]} value={v} onChange={onChange} />
        ))}
      </div>
    );
  const long = key === "summary" || key.startsWith("why_");
  return (
    <label className="field">
      <span>{label(key)}</span>
      {long ? (
        <textarea rows={3} value={String(value ?? "")} onChange={(e) => onChange(path, e.target.value)} />
      ) : (
        <input value={String(value ?? "")} onChange={(e) => onChange(path, e.target.value)} />
      )}
    </label>
  );
}
