'use strict';
(() => {
 const grid=document.querySelector('#bulk-grid'),search=document.querySelector('#bulk-search'),category=document.querySelector('#bulk-category');
 const count=document.querySelector('#bulk-count'),lines=document.querySelector('#bulk-lines'),empty=document.querySelector('#bulk-empty'),total=document.querySelector('#bulk-total');
 const clear=document.querySelector('#bulk-clear');
 if(!grid||!Array.isArray(CATALOG))return;
 const worksheet=new Map();
 const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
 const dollars=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
 const groups=[...new Set(CATALOG.map(p=>p.group))].sort();
 for(const group of groups){const o=make('option',group);o.value=group;category.append(o);}
 function renderSummary(){
  lines.replaceChildren();
  let sum=0;
  for(const item of worksheet.values()){
   const p=CATALOG.find(x=>x.id===item.id),v=p?.variants.find(x=>x.size===item.size);
   if(!p||!v)continue;
   const line=v.price*item.qty;sum+=line;
   lines.append(make('li',p.name+' · '+item.size+' · '+item.qty+' × '+dollars(v.price)+' = '+dollars(line)));
  }
  empty.hidden=worksheet.size>0;
  total.textContent=worksheet.size?'Illustrative subtotal (no discount): '+dollars(sum):'';
 }
 function render(){
  const q=search.value.trim().toLowerCase(),group=category.value;
  const matches=CATALOG.filter(p=>(!group||p.group===group)&&(!q||(p.name+' '+p.group).toLowerCase().includes(q)));
  grid.replaceChildren();count.textContent=matches.length+' catalog products';
  for(const p of matches){
   const card=make('article');card.className='bulk-card';
   card.append(make('p',p.group),make('h2',p.name),make('p',p.blurb));
   const label=make('label','Strength');const select=make('select');
   for(const v of p.variants){const option=make('option',v.size+' — '+dollars(v.price));option.value=v.size;select.append(option);}
   label.append(select);card.append(label);
   const qtyLabel=make('label','Quantity (units)');const qty=make('input');qty.type='number';qty.min='1';qty.max='100';qty.step='1';qty.value='10';qtyLabel.append(qty);card.append(qtyLabel);
   const button=make('button','Add to worksheet');button.type='button';
   button.addEventListener('click',()=>{
    const n=Number(qty.value);if(!Number.isSafeInteger(n)||n<1||n>100){qty.setCustomValidity('Enter a quantity from 1 to 100.');qty.reportValidity();return;}
    qty.setCustomValidity('');
    const key=p.id+'::'+select.value;
    worksheet.set(key,{id:p.id,size:select.value,qty:n});renderSummary();
   });
   card.append(button);grid.append(card);
  }
 }
 search.addEventListener('input',render);category.addEventListener('change',render);
 clear.addEventListener('click',()=>{worksheet.clear();renderSummary();});
 render();renderSummary();
})();