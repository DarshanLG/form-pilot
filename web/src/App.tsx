import { useEffect, useState } from "react";
import { api } from "./api";
import { Documents } from "./pages/Documents";
import { Overview } from "./pages/Overview";
import { ProfilePage } from "./pages/Profile";
import { Runs } from "./pages/Runs";

const PAGES = [
  { id: "overview", title: "Overview", Page: Overview },
  { id: "profile", title: "Profile", Page: ProfilePage },
  { id: "documents", title: "Documents", Page: Documents },
  { id: "runs", title: "Runs", Page: Runs },
] as const;

const fromHash = () => location.hash.replace(/^#\/?/, "").split("/")[0] || "overview";

export function App() {
  const [page, setPage] = useState(fromHash);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = () => setPage(fromHash());
    addEventListener("hashchange", onHash);
    api.health().then(() => setOnline(true), () => setOnline(false));
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  return (
    <div className="shell">
      <header>
        <h1>FormPilot</h1>
        <nav>
          {PAGES.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={p.id === current.id ? "active" : ""}>
              {p.title}
            </a>
          ))}
        </nav>
        <span className={`status ${online ? "ok" : online === false ? "bad" : ""}`}>
          {online ? "Server connected" : online === false ? "Server offline" : "…"}
        </span>
      </header>
      {online === false && (
        <p className="banner">
          Can't reach the FormPilot server. Start it with <code>cd server && npm start</code> (port 4000).
        </p>
      )}
      <main>
        <current.Page />
      </main>
    </div>
  );
}
