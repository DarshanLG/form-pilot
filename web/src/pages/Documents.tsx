import { useEffect, useState } from "react";
import { api, type FileKind, type StoredFile } from "../api";

const KINDS: { kind: FileKind; title: string }[] = [
  { kind: "resume", title: "Resume" },
  { kind: "cover_letter", title: "Cover letter" },
];
const ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function Documents() {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.files().then(setFiles, (e) => setError(e.message));
  useEffect(() => void load(), []);

  async function run(p: Promise<unknown>) {
    setError(null);
    try {
      await p;
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  }

  return (
    <>
      <p className="muted">The extension uploads these into file fields when the model asks for them (PDF, DOC or DOCX, up to 10 MB).</p>
      {error && <p className="error">{error}</p>}
      <div className="form-grid">
        {KINDS.map(({ kind, title }) => {
          const f = files?.find((x) => x.kind === kind);
          return (
            <section className="card" key={kind}>
              <h2>{title}</h2>
              {f ? (
                <p>
                  <a href={api.fileUrl(kind)} download={f.filename}>
                    {f.filename}
                  </a>{" "}
                  <span className="muted small">
                    {(f.size / 1024).toFixed(0)} KB · {new Date(f.uploadedAt).toLocaleString()}
                  </span>
                </p>
              ) : (
                <p className="muted">{files ? "None uploaded." : "Loading…"}</p>
              )}
              <div className="buttons">
                <label className="button primary">
                  {f ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept={ACCEPT}
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) run(api.uploadFile(kind, file));
                    }}
                  />
                </label>
                {f && (
                  <button onClick={() => confirm(`Delete your ${title.toLowerCase()}?`) && run(api.deleteFile(kind))}>
                    Delete
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
