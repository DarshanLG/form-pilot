import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";
import {
  actionError,
  autoAcceptable,
  effectiveDecision,
  historyEntry,
  nextMark,
  platformOf,
  radioSiblings,
  resolveFinal,
  type Decision,
} from "../lib/steps";
import { ACTIONS, type Action, type ExecResult, type FieldInfo, type FileKind, type Msg, type Proposal, type SubmitTarget } from "../lib/types";

type Phase = "idle" | "thinking" | "review" | "executing" | "ready" | "gate" | "confirm" | "finished";

interface LogEntry {
  id: string;
  n: number;
  proposed: Proposal;
  decision: Decision | "auto"; // auto: another option of a radio question that was just answered
  final: Action;
  error?: string;
}

/** Live run state the async loop reads; React state mirrors it for rendering. */
interface Run {
  id: string;
  tabId: number;
  windowId: number;
  fields: FieldInfo[];
  visible: number[];
  history: Record<string, unknown>[];
  screenshot: string;
  steps: number;
}

const send = <T,>(tabId: number, msg: Msg) => chrome.tabs.sendMessage(tabId, msg) as Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(a: Action) {
  const parts = [a.action, a.mark != null ? `#${a.mark}` : "", a.value ? `"${a.value}"` : ""];
  return parts.filter(Boolean).join(" ");
}

export function App() {
  const [setup, setSetup] = useState<api.SetupStatus | null>(null);
  const [server, setServerUrl] = useState(api.DEFAULT_SERVER);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState<Action | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [auto, setAuto] = useState(false);
  const [submit, setSubmit] = useState<SubmitTarget | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const run = useRef<Run | null>(null);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const refresh = useCallback(async () => {
    setServerUrl(await api.getServer());
    setSetup(await api.setupStatus());
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setPhase(run.current ? "ready" : "idle");
  };

  /** Mark the page, scroll to the next field, screenshot, ask the model. */
  const step = useCallback(async () => {
    const r = run.current;
    if (!r) return;
    setError(null);
    setPhase("thinking");
    try {
      const tab = await chrome.tabs.get(r.tabId);
      if (!tab.active) throw new Error("Switch back to the application tab to continue.");
      if (r.steps >= r.fields.length * 2 + 5) {
        await toGate(r);
        throw new Error("Stopped: more steps than fields. Review the form yourself.");
      }
      r.fields = (await send<{ fields: FieldInfo[] }>(r.tabId, { kind: "fp:mark" })).fields;
      const target = nextMark(r.history, r.fields.map((f) => f.mark));
      r.visible = (await send<{ visible: number[] }>(r.tabId, { kind: "fp:focus", mark: target })).visible;
      await sleep(250); // let the scroll paint before capturing
      r.screenshot = await chrome.tabs.captureVisibleTab(r.windowId, { format: "png" });
      const p = await api.act(r.screenshot, r.visible, r.history);
      await send(r.tabId, { kind: "fp:highlight", mark: p.mark });
      setProposal(p);
      setEditing(null);
      if (p.action === "done") return void (await toGate(r, p));
      if (autoRef.current && autoAcceptable(p, r.history)) return void (await decide("accepted", undefined, p));
      setPhase("review");
    } catch (e) {
      fail(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Run the user's decision on the page, log it to the server (corrections keep the screenshot), go on. */
  const decide = useCallback(
    async (chosen: Decision, edited?: Action, p: Proposal | null = proposal) => {
      const r = run.current;
      if (!r || !p) return;
      const final = resolveFinal(p, chosen, edited);
      const decision = effectiveDecision(p, chosen, final);
      setPhase("executing");
      let res: ExecResult = { ok: true };
      try {
        if (final.action !== "done") {
          const file = final.action === "upload" ? await api.fetchFile(final.value as FileKind) : undefined;
          res = await send<ExecResult>(r.tabId, { kind: "fp:exec", action: final, file });
        }
        await api.logStep(r.id, {
          marks: r.visible,
          history: r.history,
          proposed: { action: p.action, mark: p.mark, value: p.value, thought: p.thought ?? null },
          decision,
          final,
          fallback: p.fallback,
          latency_ms: p.latency_ms,
          screenshot: decision === "accepted" ? undefined : r.screenshot,
        });
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      r.history = [...r.history, historyEntry(final)];
      r.steps += 1;
      const entries: LogEntry[] = [{ id: String(r.steps), n: r.steps, proposed: p, decision, final, error: res.error }];
      if (res.ok)
        for (const mark of radioSiblings(r.fields, final, r.history)) {
          const skip: Action = { action: "skip", mark, value: null };
          r.history = [...r.history, historyEntry(skip)];
          entries.unshift({ id: `${r.steps}-${mark}`, n: r.steps, proposed: { ...skip, fallback: false, attempts: 0, latency_ms: 0 }, decision: "auto", final: skip });
        }
      setLog((l) => [...entries, ...l]);
      setProposal(null);
      setEditing(null);
      if (final.action === "done") return void (await toGate(r));
      if (!res.ok) {
        setError(`${res.error} — fix that field by hand, then continue.`);
        setPhase("ready");
      } else if (autoRef.current) await step();
      else setPhase("ready");
    },
    [proposal, step],
  );

  async function toGate(r: Run, p?: Proposal) {
    if (p) setProposal(p);
    setSubmit(await send<SubmitTarget>(r.tabId, { kind: "fp:submitTarget" }).catch(() => ({ found: false })));
    setPhase("gate");
  }

  async function start() {
    setError(null);
    setLog([]);
    setOutcome(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url?.startsWith("http")) throw new Error("Open the job application page first.");
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      const { _id } = await api.startRun(tab.url, platformOf(tab.url));
      run.current = { id: _id, tabId: tab.id, windowId: tab.windowId, fields: [], visible: [], history: [], screenshot: "", steps: 0 };
      await step();
    } catch (e) {
      fail(e);
    }
  }

  async function finish(status: "submitted" | "filled" | "abandoned") {
    const r = run.current;
    if (!r) return;
    try {
      if (status === "submitted") {
        const res = await send<ExecResult>(r.tabId, { kind: "fp:submit" });
        if (!res.ok) throw new Error(res.error);
      } else await send(r.tabId, { kind: "fp:clear" }).catch(() => undefined);
      await api.finishRun(r.id, status);
      setOutcome(
        { submitted: "Application submitted.", filled: "Form filled. Review it and submit it yourself.", abandoned: "Run stopped." }[status],
      );
      run.current = null;
      setPhase("finished");
    } catch (e) {
      fail(e);
    }
  }

  const ready = setup?.server && setup.profile;
  const busy = phase === "thinking" || phase === "executing";

  return (
    <main>
      <header>
        <h1>FormPilot</h1>
        <span className={`dot ${setup?.server ? "ok" : "bad"}`} title={server} />
      </header>

      {setup && !ready && (
        <section className="card warn">
          {!setup.server ? (
            <>
              <p>Can't reach the FormPilot server at {server}.</p>
              <p className="muted">Start it with <code>cd server && npm start</code>, or change the address:</p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await api.setServer(server);
                  refresh();
                }}
              >
                <input value={server} onChange={(e) => setServerUrl(e.target.value)} />
                <button>Save</button>
              </form>
            </>
          ) : (
            <p>No profile saved yet. Add one in the dashboard (or <code>PUT /api/profile</code>), then <button className="link" onClick={refresh}>check again</button>.</p>
          )}
        </section>
      )}
      {setup?.server && setup.profile && !setup.files.includes("resume") && (
        <p className="muted small">No resume uploaded: upload steps will fail until you add one.</p>
      )}

      {(phase === "idle" || phase === "finished") && (
        <section className="card">
          {outcome && <p className="outcome">{outcome}</p>}
          <button className="primary" disabled={!ready} onClick={start}>
            Fill this application
          </button>
          <label className="toggle">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-accept routine steps
          </label>
          <p className="muted small">FormPilot never submits on its own: you confirm the final submit.</p>
        </section>
      )}

      {busy && <p className="status">{phase === "thinking" ? "Reading the page…" : "Filling the field…"}</p>}
      {error && <p className="error">{error}</p>}

      {phase === "review" && proposal && (
        <section className="card proposal">
          <div className="row">
            <strong>{describe(proposal)}</strong>
            {proposal.fallback && <span className="badge">model unsure</span>}
          </div>
          {proposal.thought && <p className="thought">{proposal.thought}</p>}
          <p className="muted small">
            {proposal.latency_ms} ms · {proposal.attempts} attempt{proposal.attempts > 1 ? "s" : ""}
          </p>
          {editing ? (
            <EditForm
              value={editing}
              fields={run.current?.fields ?? []}
              onCancel={() => setEditing(null)}
              onSave={(a) => decide("edited", a)}
            />
          ) : (
            <div className="buttons">
              <button className="primary" onClick={() => decide("accepted")}>Accept</button>
              <button onClick={() => setEditing({ action: proposal.action, mark: proposal.mark, value: proposal.value })}>Edit</button>
              <button onClick={() => decide("overridden")}>Skip</button>
            </div>
          )}
        </section>
      )}

      {phase === "ready" && (
        <section className="card">
          <div className="buttons">
            <button className="primary" onClick={step}>Next step</button>
            <button onClick={() => run.current && toGate(run.current)}>I'm done filling</button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-accept routine steps
          </label>
        </section>
      )}

      {phase === "gate" && (
        <section className="card gate">
          <p><strong>Review the whole form before submitting.</strong></p>
          <p className="muted small">Scroll through the page and fix anything by hand. FormPilot will not submit unless you confirm.</p>
          <div className="buttons">
            <button className="danger" disabled={!submit?.found} onClick={() => setPhase("confirm")}>
              {submit?.found ? `${submit.label}…` : "No submit button found"}
            </button>
            <button onClick={() => finish("filled")}>I'll submit myself</button>
            <button onClick={() => setPhase("ready")}>Keep filling</button>
          </div>
        </section>
      )}

      {phase === "confirm" && (
        <section className="card gate">
          <p><strong>Submit this application now?</strong> This sends it to the employer and can't be undone.</p>
          <div className="buttons">
            <button className="danger" onClick={() => finish("submitted")}>Yes, submit</button>
            <button onClick={() => setPhase("gate")}>Back</button>
          </div>
        </section>
      )}

      {run.current && phase !== "gate" && phase !== "confirm" && (
        <button className="link stop" onClick={() => finish("abandoned")}>Stop run</button>
      )}

      {log.length > 0 && (
        <section>
          <h2>Steps</h2>
          <ol className="log">
            {log.map((e) => (
              <li key={e.id} className={e.error ? "err" : e.decision}>
                <span className="n">{e.decision === "auto" ? "" : e.n}</span>
                <span>
                  {describe(e.final)}
                  {(e.decision === "edited" || e.decision === "overridden") && <span className="was"> (model: {describe(e.proposed)})</span>}
                  {e.error && <span className="was"> — {e.error}</span>}
                </span>
                <span className="tag">{e.decision}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

function EditForm(props: { value: Action; fields: FieldInfo[]; onSave: (a: Action) => void; onCancel: () => void }) {
  const [a, setA] = useState<Action>(props.value);
  const err = actionError(a);
  const field = props.fields.find((f) => f.mark === a.mark);
  return (
    <form
      className="edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (!err) props.onSave({ ...a, value: a.action === "click" || a.action === "skip" || a.action === "done" ? null : a.value });
      }}
    >
      <label>
        Action
        <select value={a.action} onChange={(e) => setA({ ...a, action: e.target.value as Action["action"] })}>
          {ACTIONS.filter((x) => x !== "done").map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label>
        Mark
        <input type="number" min={1} value={a.mark ?? ""} onChange={(e) => setA({ ...a, mark: e.target.value ? Number(e.target.value) : null })} />
      </label>
      {field && <p className="muted small">{field.label || field.group || field.type}</p>}
      {(a.action === "type" || a.action === "select") && (
        <label>
          Value
          {a.action === "select" && field?.options.length ? (
            <select value={a.value ?? ""} onChange={(e) => setA({ ...a, value: e.target.value })}>
              <option value="">—</option>
              {field.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input value={a.value ?? ""} onChange={(e) => setA({ ...a, value: e.target.value })} />
          )}
        </label>
      )}
      {a.action === "upload" && (
        <label>
          File
          <select value={a.value ?? ""} onChange={(e) => setA({ ...a, value: e.target.value })}>
            <option value="">—</option>
            <option value="resume">resume</option>
            <option value="cover_letter">cover letter</option>
          </select>
        </label>
      )}
      {err && <p className="error small">{err}</p>}
      <div className="buttons">
        <button className="primary" disabled={!!err}>Run edited</button>
        <button type="button" onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}
