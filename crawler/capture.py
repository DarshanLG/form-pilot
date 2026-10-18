"""Capture a job-application form: screenshot with numbered marks + field metadata.

Usage:
    python crawler/capture.py --urls data/urls/greenhouse.txt --out data/raw
    python crawler/capture.py --url https://job-boards.greenhouse.io/<co>/jobs/<id> --out data/raw
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Page, sync_playwright

# Collect visible form controls and best-guess label text for each.
COLLECT_JS = r"""
() => {
  const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=combobox], [role=listbox], [contenteditable=true]';
  const vis = el => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    const fileOk = el.type === 'file';  // file inputs are often hidden behind a button
    return fileOk || (r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none');
  };
  const txt = n => (n?.innerText || n?.textContent || '').replace(/\s+/g, ' ').trim();
  const labelFor = el => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return txt(l); }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(/\s+/).map(id => txt(document.getElementById(id))).join(' ');
    const wrap = el.closest('label'); if (wrap) return txt(wrap);
    // walk up to a container that holds a label/legend-like element
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const l = p.querySelector('label, legend, .label, [class*=label]');
      if (l && !l.contains(el)) return txt(l);
    }
    return el.placeholder || el.name || '';
  };
  const out = [];
  document.querySelectorAll(sel).forEach(el => {
    if (!vis(el)) return;
    // radios/checkboxes: one mark per option is fine; group name kept
    let target = el;
    if (el.type === 'file') target = el.closest('div') || el;
    const r = target.getBoundingClientRect();
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.type || el.getAttribute('role') || '',
      name: el.name || '',
      id: el.id || '',
      label: labelFor(el).slice(0, 300),
      placeholder: el.placeholder || '',
      required: el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelFor(el)),
      options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()).filter(Boolean).slice(0, 60) : [],
      bbox: [r.x + scrollX, r.y + scrollY, r.width, r.height],
    });
  });
  return out;
}
"""

# Draw numbered boxes (set-of-marks) over each field.
MARK_JS = r"""
(fields) => {
  document.querySelectorAll('.__fp_mark').forEach(n => n.remove());
  fields.forEach((f, i) => {
    const [x, y, w, h] = f.bbox;
    const box = document.createElement('div');
    box.className = '__fp_mark';
    Object.assign(box.style, {position:'absolute', left:x+'px', top:y+'px', width:w+'px', height:h+'px',
      border:'2px solid #e11d48', zIndex:2147483647, pointerEvents:'none', boxSizing:'border-box'});
    const tag = document.createElement('div');
    tag.textContent = String(i + 1);
    Object.assign(tag.style, {position:'absolute', left:'calc(100% + 4px)', top:'0', background:'#e11d48', color:'#fff',
      font:'bold 12px/16px monospace', padding:'0 4px', borderRadius:'3px'});
    box.appendChild(tag);
    document.body.appendChild(box);
  });
}
"""


def platform_of(url: str) -> str:
    host = urlparse(url).netloc
    if "greenhouse" in host:
        return "greenhouse"
    if "lever.co" in host:
        return "lever"
    if "myworkdayjobs" in host or "workday" in host:
        return "workday"
    return "other"


def company_of(url: str) -> str:
    u = urlparse(url)
    if platform_of(url) == "workday":
        return u.netloc.split(".")[0]  # <tenant>.wd5.myworkdayjobs.com
    seg = [s for s in u.path.split("/") if s]
    return f"{u.netloc}/{seg[0]}" if seg else u.netloc


def open_application(page: Page, url: str) -> None:
    page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    page.wait_for_timeout(2500)
    # Lever job pages link to /apply; Greenhouse/Workday may need an "Apply" click.
    if platform_of(url) == "lever" and not url.rstrip("/").endswith("/apply"):
        page.goto(url.rstrip("/") + "/apply", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        return
    for text in ("Apply", "Apply for this job", "Apply Now"):
        btn = page.get_by_role("button", name=text).or_(page.get_by_role("link", name=text))
        if btn.count():
            try:
                btn.first.click(timeout=3000)
                page.wait_for_timeout(2500)
            except Exception:
                pass
            break


def capture(page: Page, url: str, out_dir: Path) -> dict | None:
    open_application(page, url)
    fields = page.evaluate(COLLECT_JS)
    if not fields:
        print(f"  no fields: {url}")
        return None
    sid = hashlib.sha1(url.encode()).hexdigest()[:12]
    page.screenshot(path=str(out_dir / f"{sid}_clean.png"), full_page=True)
    page.evaluate(MARK_JS, fields)
    page.screenshot(path=str(out_dir / f"{sid}_marked.png"), full_page=True)
    rec = {
        "id": sid,
        "url": url,
        "company": company_of(url),  # split key: held-out layouts = held-out companies
        "platform": platform_of(url),
        "captured_at": int(time.time()),
        "viewport": page.viewport_size,
        "marks": [{"mark": i + 1, **f} for i, f in enumerate(fields)],
    }
    (out_dir / f"{sid}.json").write_text(json.dumps(rec, indent=2))
    print(f"  {len(fields):3d} fields  {rec['platform']:10s} {url}")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url")
    ap.add_argument("--urls", help="text file, one URL per line")
    ap.add_argument("--out", default="data/raw")
    ap.add_argument("--delay", type=float, default=3.0)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    urls = [args.url] if args.url else [
        u.strip() for u in Path(args.urls).read_text().splitlines() if u.strip() and not u.startswith("#")
    ]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        for u in urls:
            if (out / f"{hashlib.sha1(u.encode()).hexdigest()[:12]}.json").exists():
                continue  # resume-safe
            try:
                capture(page, u, out)
            except Exception as e:  # keep crawling
                print(f"  FAIL {u}: {e}")
            time.sleep(args.delay)
        browser.close()


if __name__ == "__main__":
    main()
