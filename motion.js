(function(){
'use strict';
var D = document;
var less = matchMedia('(prefers-reduced-motion: reduce)').matches;
D.documentElement.classList.add('js');
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
if(less) return;
var items = D.querySelectorAll('.reveal');
var io = new IntersectionObserver(function(list){
list.forEach(function(e){
if(!e.isIntersecting) return;
e.target.classList.add('is-in');
io.unobserve(e.target);
});
}, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
items.forEach(function(el ){ io.observe(el); });

})();
