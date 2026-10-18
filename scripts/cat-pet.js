/* ====== 🐱 貓咪動畫 ======
   偶爾有一隻小貓從畫面底部跑過，或縮成一團翻跟斗。
   - 不擋操作（pointer-events: none）。
   - 正在輸入、有視窗打開、切到別的分頁、手機設定「減少動態效果」時，不會自動出現。
   - 「設定」選單裡有開關，設定存在這台瀏覽器（HUI_CAT_PET_V1）。 */
(function () {
  var KEY = 'HUI_CAT_PET_V1';
  var cat = null, layer = null, playing = false, timer = null;
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function enabled() { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* 存不了就算了 */ } }

  var SVG = '' +
    '<div class="axis"><svg class="runsvg" viewBox="0 0 130 84" xmlns="http://www.w3.org/2000/svg"><g class="bob">' +
    '<rect class="leg b" x="30" y="52" width="9" height="26" rx="4.5" fill="#f0b27a"/>' +
    '<rect class="leg" x="82" y="52" width="9" height="26" rx="4.5" fill="#f0b27a"/>' +
    '<path class="tail" d="M26 46 C6 40 4 18 16 12" fill="none" stroke="#fff6ea" stroke-width="9" stroke-linecap="round"/>' +
    '<ellipse cx="58" cy="46" rx="36" ry="21" fill="#fff6ea"/><ellipse cx="60" cy="56" rx="24" ry="10" fill="#fff"/>' +
    '<path d="M40 30 q3 6 0 12 M52 27 q3 6 0 12 M64 27 q3 6 0 12" stroke="#f0b27a" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '<rect class="leg" x="40" y="52" width="9" height="26" rx="4.5" fill="#fff6ea"/>' +
    '<rect class="leg b" x="72" y="52" width="9" height="26" rx="4.5" fill="#fff6ea"/>' +
    '<polygon points="88,26 92,6 104,20" fill="#fff6ea"/><polygon points="108,20 120,8 122,30" fill="#fff6ea"/>' +
    '<polygon points="92,22 94,12 100,19" fill="#f7b9b0"/><polygon points="111,20 118,13 119,25" fill="#f7b9b0"/>' +
    '<circle cx="106" cy="38" r="19" fill="#fff6ea"/><ellipse cx="112" cy="46" rx="10" ry="7.5" fill="#fff"/>' +
    '<circle cx="112" cy="34" r="2.6" fill="#4a3428"/><circle cx="97" cy="36" r="2.6" fill="#4a3428"/><circle cx="113" cy="33" r="0.9" fill="#fff"/>' +
    '<ellipse cx="119" cy="43" rx="3" ry="2.2" fill="#e88d8d"/><circle cx="92" cy="43" r="3.4" fill="#f7b9b0" opacity="0.8"/>' +
    '<path d="M108 47 q3 3 6 0" stroke="#4a3428" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M96 20 l-9 -6 l1 12 z M96 20 l9 -6 l-1 12 z" fill="#f08a4b"/><circle cx="96" cy="20" r="3.2" fill="#f08a4b"/>' +
    '</g></svg></div>' +
    '<div class="hop"><svg class="ballsvg" viewBox="0 0 84 84" xmlns="http://www.w3.org/2000/svg"><g class="spin">' +
    '<circle cx="42" cy="44" r="30" fill="#fff6ea"/>' +
    '<path d="M18 40 q6 -2 8 4 M16 52 q7 -1 9 4 M66 40 q-6 -2 -8 4" stroke="#f0b27a" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '<polygon points="22,22 24,6 37,17" fill="#fff6ea"/><polygon points="62,22 60,6 47,17" fill="#fff6ea"/>' +
    '<polygon points="25,19 26,11 33,17" fill="#f7b9b0"/><polygon points="59,19 58,11 51,17" fill="#f7b9b0"/>' +
    '<ellipse cx="42" cy="50" rx="17" ry="14" fill="#fff"/>' +
    '<circle cx="34" cy="44" r="2.6" fill="#4a3428"/><circle cx="50" cy="44" r="2.6" fill="#4a3428"/>' +
    '<ellipse cx="42" cy="49" rx="2.6" ry="2" fill="#e88d8d"/><path d="M37 53 q5 4 10 0" stroke="#4a3428" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<circle cx="29" cy="50" r="3.6" fill="#f7b9b0" opacity="0.8"/><circle cx="55" cy="50" r="3.6" fill="#f7b9b0" opacity="0.8"/>' +
    '<path d="M40 16 l-8 -5 l1 11 z M44 16 l8 -5 l-1 11 z" fill="#f08a4b"/><circle cx="42" cy="16" r="3" fill="#f08a4b"/>' +
    '<circle cx="26" cy="68" r="6" fill="#f0b27a"/><circle cx="58" cy="68" r="6" fill="#f0b27a"/>' +
    '</g></svg></div>';

  function build() {
    if (layer) return;
    layer = document.createElement('div');
    layer.className = 'cat-layer';
    layer.setAttribute('aria-hidden', 'true');
    cat = document.createElement('div');
    cat.className = 'cat';
    cat.innerHTML = SVG;
    layer.appendChild(cat);
    document.body.appendChild(layer);
  }

  function play(kind) {
    if (playing) return;
    build();
    playing = true;
    var vw = Math.max(document.documentElement.clientWidth, 320);
    var ltr = Math.random() < 0.5;
    var from = ltr ? -140 : vw + 30, to = ltr ? vw + 30 : -140;
    cat.querySelector('.runsvg').style.transform = ltr ? 'none' : 'scaleX(-1)';
    cat.classList.toggle('rolling', kind === 'roll');
    cat.classList.add('on');
    var main;
    if (kind === 'roll') {
      var hops = Math.max(4, Math.round(vw / 110)), per = 900, dur = hops * per;
      var hop = cat.querySelector('.hop'), spin = cat.querySelector('.spin');
      spin.style.transformOrigin = '42px 44px';
      main = cat.animate([{ transform: 'translateX(' + from + 'px)' }, { transform: 'translateX(' + to + 'px)' }], { duration: dur, easing: 'linear', fill: 'forwards' });
      hop.animate([{ transform: 'translateY(0)', easing: 'ease-out' }, { transform: 'translateY(-34px)', offset: 0.5, easing: 'ease-in' }, { transform: 'translateY(0)' }], { duration: per, iterations: hops });
      spin.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(' + (ltr ? 360 : -360) + 'deg)' }], { duration: per, iterations: hops, easing: 'ease-in-out' });
    } else {
      cat.style.transformOrigin = '55px 50px';
      main = cat.animate([{ transform: 'translateX(' + from + 'px)' }, { transform: 'translateX(' + to + 'px)' }], { duration: Math.max(5200, vw * 8), easing: 'linear', fill: 'forwards' });
    }
    main.onfinish = function () { cat.classList.remove('on'); cat.classList.remove('rolling'); playing = false; };
  }

  function busy() {
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    return !!document.querySelector('.modal-overlay.open');
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (enabled() && !document.hidden && !reduce.matches && !busy()) play(Math.random() < 0.6 ? 'run' : 'roll');
      schedule(60000 + Math.random() * 60000);
    }, ms);
  }

  function syncButtons() {
    var on = enabled();
    var els = document.querySelectorAll('.cat-toggle-btn');
    for (var i = 0; i < els.length; i++) els[i].textContent = '🐱 貓咪動畫：' + (on ? '開' : '關');
  }

  window.toggleCatPet = function () {
    var on = !enabled();
    setEnabled(on);
    syncButtons();
    if (on) play(Math.random() < 0.5 ? 'run' : 'roll');
    else if (layer && cat) { var a = cat.getAnimations ? cat.getAnimations({ subtree: true }) : []; a.forEach(function (x) { x.cancel(); }); cat.classList.remove('on'); playing = false; }
  };

  function init() { syncButtons(); schedule(25000 + Math.random() * 20000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
