(function(){
'use strict';
var D = document;
var less = matchMedia('(prefers-reduced-motion: reduce)').matches;
D.documentElement.classList.add('js');

// Мобильная панель: появляется после ухода кнопки первого экрана и уступает место форме.
var bar = D.getElementById('mbar'), cta = D.getElementById('hero-cta');
if(bar && cta){
var mq = matchMedia('(max-width: 900px)'), passed = false;
var sync = function(){
var on = passed && mq.matches;
bar.classList.toggle('is-on', on);
D.body.classList.toggle('has-mbar', on);
if(on) bar.removeAttribute('inert'); else bar.setAttribute('inert', '');
};
if('IntersectionObserver' in window){
new IntersectionObserver(function(e ){ passed = !e[0].isIntersecting; sync(); }, { threshold: 0 }).observe(cta);
}
if(mq.addEventListener) mq.addEventListener('change', sync);
else if(mq.addListener) mq.addListener(sync);
sync();
}
var leadSec = D.getElementById('lead');
if(leadSec && 'IntersectionObserver' in window){
new IntersectionObserver(function(e ){ D.body.classList.toggle('at-lead', e[0].isIntersecting); }, { threshold: 0.01 }).observe(leadSec);
}

// Шкала сход-развала: один прогон, когда лист замера попал в кадр. Цикла нет.
var sheet = D.querySelector('.sheet');
if(sheet){
if(less || !('IntersectionObserver' in window)){
sheet.classList.add('is-lit');
} else {
var sio = new IntersectionObserver(function(list){
if(!list[0].isIntersecting) return;
sheet.classList.add('is-lit');
sio.disconnect();
}, { threshold: 0.2 });
sio.observe(sheet);
}
}

if(less) return;

// Появление блоков: один раз на элемент, без повторной анимации при возврате.
var items = D.querySelectorAll('.reveal');
if(!('IntersectionObserver' in window)) return;
var io = new IntersectionObserver(function(list){
list.forEach(function(e){
if(!e.isIntersecting) return;
e.target.classList.add('is-in');
io.unobserve(e.target);
});
}, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
items.forEach(function(el ){ io.observe(el); });

})();
