// The menu and the site map: an icon rail and a sidebar beside the content, as in a settings
// window; hidden with the menu button, and over the page on a phone.
export const SHELL_STYLE = `header.site{position:sticky;top:0;z-index:20;align-items:center}
.navtoggle{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin-right:4px;border:1px solid var(--line-strong);border-radius:8px;background:var(--panel);color:var(--ink);cursor:pointer}
.navtoggle:hover{border-color:var(--brand)}
.shell{display:flex;align-items:flex-start}
.content{flex:1;min-width:0}
aside.nav{display:flex;flex:none;position:sticky;top:var(--header-h);height:calc(100dvh - var(--header-h));border-right:1px solid var(--line);background:var(--side-bg)}
body.nav-hidden aside.nav{display:none}
.rail{display:flex;flex-direction:column;gap:6px;width:72px;padding:12px 6px;border-right:1px solid var(--line);background:var(--rail-bg)}
.rail a{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 2px;border-radius:10px;color:var(--ink2);font-size:11px;text-decoration:none}
.rail a:hover{background:var(--panel);color:var(--ink)}
.rail a.on{background:var(--brandL);color:var(--brand)}
.side{width:280px;overflow-y:auto;padding:14px 12px 24px}
.side-h{font-size:19px;font-weight:700;margin:2px 6px 10px}
.side .search{width:100%;padding:9px 14px;border:1px solid var(--line-strong);border-radius:999px;background:var(--panel);color:var(--ink);font:inherit;font-size:15px}
.side .search:focus{outline:2px solid var(--brand);outline-offset:1px}
.side ul,.side ol{list-style:none;margin:0;padding:0}
.side .results{margin-top:4px}
.side .count{margin:8px 6px 0;font-size:12px;color:var(--mute)}
.side .count:empty{display:none}
.side .results small{display:block;font-size:12px;color:var(--mute)}
.side .results .none{padding:6px 10px;color:var(--mute);font-size:14px}
.grp{margin-top:16px}
.grp-h{display:flex;align-items:center;gap:8px;margin:0 6px 4px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mute)}
.grp-h.sep{margin-top:20px}
.side li a{display:block;padding:6px 10px;border-radius:var(--radius);color:var(--ink);font-size:15px;text-decoration:none}
.side li a:hover{background:var(--panel)}
.side li a[aria-current=page]{background:var(--brandL);color:var(--brand);font-weight:650}
details.proc{margin-top:4px}
details.proc summary{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;list-style:none}
details.proc summary::-webkit-details-marker{display:none}
details.proc summary:hover{background:var(--panel)}
details.proc summary::after{content:"›";margin-left:auto;color:var(--mute);transition:transform .15s}
details.proc[open] summary::after{transform:rotate(90deg)}
details.proc ul{margin:2px 0 6px 18px;padding-left:8px;border-left:1px solid var(--line)}
.icon{flex:none}
.map{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin:12px 0 28px}
.card{padding:14px 16px;border:1px solid var(--line);border-radius:calc(var(--radius) + 4px);background:var(--panel)}
.card h3{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:17px}
.card h3 .icon{width:34px;height:34px;padding:6px;border-radius:9px;background:var(--brandL);color:var(--brand)}
.card p{margin:0 0 8px;font-size:14px}
.card ul{margin:0;padding-left:18px;font-size:15px}
.card li{margin:3px 0}
@media (max-width:800px){aside.nav{position:fixed;left:0;top:var(--header-h);bottom:0;z-index:15;height:auto;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.side{width:min(280px,calc(100vw - 88px))}}
@media (max-width:600px){header.site .crumbs{display:none}}
`;
