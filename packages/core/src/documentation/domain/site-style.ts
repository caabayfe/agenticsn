// The site's CSS: readable pages, light and dark, phone width without horizontal scroll.
export const SITE_STYLE = `:root{--ink:#172B4D;--ink2:#44546F;--mute:#626F86;--line:#DCDFE4;--bg:#FFFFFF;--panel:#F7F8F9;
--blue:#0C66E4;--green:#1F845A;--greenL:#DCFFF1;--amber:#B65C02;--amberL:#FFF7D6;--red:#C9372C;--redL:#FFECEB;
--purple:#6E5DC6;--purpleL:#F3F0FF;--blueL:#E9F2FF;--greyL:#F1F2F4}
@media (prefers-color-scheme: dark){:root{--ink:#DEE4EA;--ink2:#B6C2CF;--mute:#9FADBC;--line:#38414A;--bg:#1D2125;
--panel:#22272B;--blue:#579DFF;--green:#4BCE97;--greenL:#1C3329;--amber:#F5CD47;--amberL:#332E1B;--red:#F87168;
--redL:#42221F;--purple:#9F8FEF;--purpleL:#2B273F;--blueL:#1C2B41;--greyL:#2C333A}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header.site{border-bottom:1px solid var(--line);padding:12px 16px}
header.site a{color:var(--ink);font-weight:650;text-decoration:none}
main{max-width:980px;margin:0 auto;padding:16px}
footer.site{max-width:980px;margin:0 auto;padding:16px;color:var(--mute);font-size:13px;border-top:1px solid var(--line)}
a{color:var(--blue)}
h1{font-size:28px;line-height:1.25;margin:8px 0 12px}
h2{font-size:21px;margin:28px 0 8px}
h3{font-size:17px;margin:20px 0 6px}
.banner{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:8px 12px;border-radius:6px;background:var(--panel);font-size:14px;color:var(--ink2)}
.banner .kind{font-weight:650;color:var(--ink)}
.stale{margin:12px 0;padding:10px 12px;border-left:4px solid var(--red);background:var(--redL);border-radius:0 6px 6px 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:var(--panel)}
code{font-size:.9em;background:var(--greyL);padding:1px 4px;border-radius:3px;overflow-wrap:anywhere}
pre{background:var(--greyL);padding:12px;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
.label,.status{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:3px;vertical-align:middle}
.label-new,.status-fresh{background:var(--greenL);color:var(--green)}
.label-corrected,.status-unpinned{background:var(--amberL);color:var(--amber)}
.label-restored{background:var(--blueL);color:var(--blue)}
.label-changed,.label-unknown{background:var(--greyL);color:var(--mute)}
.label-documented-only{background:var(--purpleL);color:var(--purple)}
.label-open-question,.status-changed,.status-missing{background:var(--redL);color:var(--red)}
.cite{font-size:12px;font-weight:650;text-decoration:none;padding:0 3px;border:1px solid var(--line);border-radius:3px}
.cite.unknown{color:var(--red)}
.animation{margin:16px 0}
.animation iframe{width:100%;height:640px;border:0;display:block;border-radius:10px;background:#fff}
.transcript{margin-top:8px;font-size:14px}
.pages{list-style:none;padding:0}
.pages li{padding:6px 0;border-bottom:1px solid var(--line)}
.code{display:inline-block;min-width:3.5em;font-weight:650;color:var(--mute)}
`;
