// The menu's browser script. It hides and shows the menu (remembered across pages on wide screens;
// narrow screens always start with it hidden) and searches the guide from assets/search.js.
export const MENU_SCRIPT = String.raw`<script>(function(){var b=document.body,t=document.querySelector('.navtoggle');
var narrow=matchMedia('(max-width: 800px)').matches,s=null;try{s=localStorage.getItem('snagentic-nav');}catch(x){}
var set=function(h){b.classList.toggle('nav-hidden',h);if(t)t.setAttribute('aria-expanded',String(!h));};
set(narrow?true:s==='hidden');
if(t)t.addEventListener('click',function(){var h=!b.classList.contains('nav-hidden');set(h);if(!narrow)try{localStorage.setItem('snagentic-nav',h?'hidden':'shown');}catch(x){}});
var q=document.querySelector('input.search');if(!q)return;
var side=q.closest('.side'),res=side.querySelector('.results'),grp=side.querySelector('.groups'),p=b.getAttribute('data-prefix')||'';
var esc=function(v){return v.replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
q.addEventListener('input',function(){var w=q.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
if(!w.length){res.hidden=true;grp.hidden=false;return;}
var hits=(window.SNAGENTIC_SEARCH||[]).filter(function(e){var h=(e.t+' '+e.x).toLowerCase();
return e.g===q.getAttribute('data-guide')&&w.every(function(v){return h.indexOf(v)>=0;});}).slice(0,30);
res.innerHTML=hits.length?hits.map(function(e){return '<li><a href="'+p+e.u+'">'+esc(e.t)+'<small>'+esc(e.p)+'</small></a></li>';}).join(''):'<li class="none">No page found</li>';
res.hidden=false;grp.hidden=true;});})();</script>`;
