/** 自有市场的独立静态网页，目录数据始终通过 textContent 呈现。 */
export function marketSite() {
  return String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>插件市场</title><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.65 system-ui,-apple-system,sans-serif;background:#fafafa;color:#1c1c1f}
main{max-width:1050px;margin:auto;padding:64px 28px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:42px}
h1{font-size:32px;line-height:1.2;font-weight:600;margin:12px 0}header p{margin:0;color:#727278}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase}
button,input,a.download{font:inherit;border-radius:10px;padding:10px 14px;border:1px solid #ddd}button{cursor:pointer;background:transparent;color:inherit}
button:hover{background:#eee}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.toolbar{display:flex;gap:14px;align-items:center;margin-bottom:22px}.toolbar input{flex:1;min-width:0;background:transparent;color:inherit}.count{color:#777;font-size:13px}
#plugins{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}article{background:#f0f0f1;border-radius:18px;padding:24px;display:flex;flex-direction:column;gap:12px}
h2{font-size:19px;margin:0;font-weight:600}article p{margin:0;color:#68686e;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#777}
.card-foot{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:12px;gap:12px}.download{background:#202024;color:#fff;text-decoration:none;white-space:nowrap;border:0}
.empty{grid-column:1/-1;padding:64px 20px;text-align:center;color:#777;border:1px dashed #ddd;border-radius:18px}footer{margin-top:40px;color:#888;font-size:12px}
@media(prefers-color-scheme:dark){body{background:#181818;color:#eee}article{background:#242424}article p,header p{color:#aaa}button,input,a.download{border-color:#444}button:hover{background:#333}.download{background:#eee;color:#181818}}
@media(max-width:620px){main{padding:36px 20px}header{align-items:start;flex-direction:column}#plugins{grid-template-columns:1fr}h1{font-size:27px}}
</style></head><body><main><header><div><div class="eyebrow">Belfry · Plugins</div><h1 id="title">插件市场</h1><p>让工作方式，随你的想法扩展。</p></div>
<button id="copy" type="button">复制市场地址</button></header><div class="toolbar"><input id="search" type="search" aria-label="搜索插件" placeholder="搜索名称、功能或作者…"><span class="count" id="count"></span></div>
<div id="plugins" aria-live="polite"></div><footer>下载插件包后，在 Belfry 的插件页面选择“安装插件包”。也可添加市场地址，直接安装和更新。</footer></main><script>
const list=document.getElementById('plugins'),query=document.getElementById('search');let plugins=[];
function text(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
function render(){list.replaceChildren();const needle=query.value.trim().toLowerCase();const items=plugins.filter(p=>[p.id,p.name,p.author,p.description].join(' ').toLowerCase().includes(needle));
 document.getElementById('count').textContent=items.length+' 个插件';
 for(const plugin of items){const version=plugin.versions.find(v=>!v.yanked);if(!version)continue;const card=document.createElement('article');card.append(text('h2',plugin.name||plugin.id),text('small',(plugin.author||'独立创作者')+' · v'+version.version),text('p',plugin.description||''));
 const foot=document.createElement('div');foot.className='card-foot';foot.append(text('small',plugin.id));
 if(/^packages\/[a-zA-Z0-9._+-]+\.piplug$/.test(version.url)){const link=text('a','下载插件包','download');link.href=new URL(version.url,location.href).href;link.download=version.url.split('/').pop();foot.append(link);}card.append(foot);list.append(card);}
 if(!items.length)list.append(text('p',needle?'没有匹配的插件':'这里将展示创作者发布的插件。','empty'));}
query.addEventListener('input',render);
document.getElementById('copy').onclick=async()=>{const url=new URL('catalog.json',location.href).href;try{await navigator.clipboard.writeText(url);document.getElementById('copy').textContent='已复制市场地址';}catch{prompt('市场地址',url);}};
fetch('./catalog.json').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(c=>{plugins=c.plugins||[];document.title=c.name||'插件市场';document.getElementById('title').textContent=c.name||'插件市场';render()}).catch(()=>list.append(text('p','暂时无法加载市场，请稍后刷新。','empty')));
</script></body></html>`;
}
