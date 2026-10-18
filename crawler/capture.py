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
  // Button-ish text that some platforms put in a field's own <label> (Greenhouse file inputs: "Attach").
  const GENERIC = /^(attach|upload|browse|choose file|enter manually|dropbox|select\.*)?$/i;
  // Question text for a field: nearest legend/label-like element that isn't an option label of its own.
  const groupLabel = el => {
    const lg = el.closest('fieldset')?.querySelector('legend'); if (lg) return txt(lg);
    let p = el.parentElement;
    for (let i = 0; i < 8 && p; i++, p = p.parentElement) {  // Lever pronoun grids nest ~7 deep
      for (const l of p.querySelectorAll('legend, label, .label, [class*=label]')) {
        if (l.contains(el) || l.querySelector('input, select, textarea')) continue;
        const t = txt(l); if (!GENERIC.test(t)) return t;
      }
    }
    return '';
  };
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
    // react-select (Greenhouse) keeps an aria-hidden shadow input beside each combobox for validation.
    if (el.getAttribute('aria-hidden') === 'true' && el.type !== 'file') return;
    // radios/checkboxes: one mark per option; the question goes in `group`
    let target = el;
    const role = el.getAttribute('role') || '';
    if (el.type === 'file') target = el.closest('div') || el;
    // react-select's typing <input> is a few px wide; box the visible control instead.
    if (role === 'combobox') target = el.closest('[class*=control]') || el;
    const r = target.getBoundingClientRect();
    const isOption = el.type === 'radio' || el.type === 'checkbox';
    let label = labelFor(el);
    const group = isOption ? groupLabel(el) : '';
    if (!isOption && GENERIC.test(label)) label = groupLabel(el) || label;
    el.setAttribute('data-fp', out.length);
    out.push({
      tag: el.tagName.toLowerCase(),
      type: ['combobox', 'listbox'].includes(role) ? role : (el.type || role),
      name: el.name || '',
      id: el.id || '',
      label: label.slice(0, 300),
      group: group.slice(0, 300),
      placeholder: el.placeholder || '',
      // Lever marks required with ✱, Greenhouse with a trailing *
      required: el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$|✱/.test(label + ' ' + group),
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


def form_url(url: str) -> str:
    """URL that loads the application form itself, in one page load."""
    plat, u = platform_of(url), urlparse(url)
    seg = [s for s in u.path.split("/") if s]
    # Hosted Greenhouse jobs often redirect to a company careers site that embeds the form in an
    # iframe; the embed URL serves the same form top-level.
    if plat == "greenhouse" and len(seg) == 3 and seg[1] == "jobs":
        return f"https://job-boards.greenhouse.io/embed/job_app?for={seg[0]}&token={seg[2]}"
    if plat == "lever" and seg[-1] != "apply":
        return url.rstrip("/") + "/apply"
    return url


def open_application(page: Page, url: str) -> None:
    resp = page.goto(form_url(url), wait_until="domcontentloaded", timeout=45_000)
    if resp and resp.status >= 400:
        raise RuntimeError(f"HTTP {resp.status} (posting closed?)")
    page.wait_for_timeout(2500)
    if platform_of(url) in ("greenhouse", "lever"):
        return  # form_url already lands on the form
    # Workday / other: may need an "Apply" click.
    for text in ("Apply", "Apply for this job", "Apply Now"):
        btn = page.get_by_role("button", name=text).or_(page.get_by_role("link", name=text))
        if btn.count():
            try:
                btn.first.click(timeout=3000)
                page.wait_for_timeout(2500)
            except Exception:
                pass
            break


def combobox_options(page: Page, fields: list[dict]) -> None:
    """Custom dropdowns (react-select etc.) only render options when opened: open, read, close."""
    for i, f in enumerate(fields):
        if f["type"] not in ("combobox", "listbox"):
            continue
        try:
            box = page.locator(f'[data-fp="{i}"]')
            box.click(timeout=2000)
            page.wait_for_timeout(400)
            # Scope to this field's menu: phone widgets keep a hidden country list of role=option.
            menu = box.get_attribute("aria-controls") or box.get_attribute("aria-owns")
            if menu:
                opts = page.locator(f'[id="{menu}"] [role=option]').all_inner_texts()
                f["options"] = [o.strip() for o in opts if o.strip()][:60]
        except Exception:
            pass  # async-search fields (e.g. location) have no options until you type
        finally:
            page.keyboard.press("Escape")


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
    combobox_options(page, fields)  # after screenshots: opening menus can shift layout
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

    urls = (
        [args.url]
        if args.url
        else [
            u.strip() for u in Path(args.urls).read_text().splitlines() if u.strip() and not u.startswith("#")
        ]
    )
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
