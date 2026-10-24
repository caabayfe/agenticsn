// The site's scripts, served as files so the pages run no inline script (spec 012, B-08).

// assets/players.js. Talks to the players on the page; nothing else is accepted. Sizes each from
// its height message, remembers the reader's sound choice across pages (localStorage; a sandboxed
// player can't), and tells the players about the reader's first click, after which browsers allow sound. Sound is on
// until the reader turns it off: browsers play an animation muted until that first click.
// Messages count only from a player's own frame (e.source). They are sent with "*" because a
// sandboxed player's origin is opaque, so no origin can name it.
export const PLAYERS_JS =
  "(function(){var K='snagentic-sound',on=true,act=false;try{on=localStorage.getItem(K)!=='off';}catch(x){}" +
  "var all=function(){return document.querySelectorAll('iframe.player');};" +
  "var send=function(f,m){try{f.contentWindow.postMessage(m,'*');}catch(x){}};" +
  "addEventListener('message',function(e){all().forEach(function(f){if(e.source!==f.contentWindow||!e.data)return;" +
  "if(e.data.snagenticAnimH){f.style.height=e.data.snagenticAnimH+'px';send(f,{snagenticSoundPref:on});if(act)send(f,{snagenticActivate:true});}" +
  "if(typeof e.data.snagenticSound==='boolean'){on=e.data.snagenticSound;try{localStorage.setItem(K,on?'on':'off');}catch(x){}" +
  "all().forEach(function(g){send(g,{snagenticSoundPref:on});});}});});" +
  "var go=function(){if(act)return;act=true;all().forEach(function(f){send(f,{snagenticActivate:true});});};" +
  "addEventListener('pointerdown',go);addEventListener('keydown',go);})();";

// assets/early.js, loaded first in the body: before the page is drawn, so a phone never flashes
// the menu over the content.
export const EARLY_JS =
  "try{if(matchMedia('(max-width: 800px)').matches||localStorage.getItem('snagentic-nav')==='hidden')" +
  "document.body.classList.add('nav-hidden');}catch(x){}";
