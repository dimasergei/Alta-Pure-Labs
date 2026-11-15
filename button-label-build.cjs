const fs=require('fs');
const path=require('path');

// Run after the page builders: several integrations match their source labels exactly.
function visit(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()){visit(file);continue;}
    if(!/\.(?:html|js)$/.test(entry.name))continue;
    const before=fs.readFileSync(file,'utf8');
    const after=before.replace(/>↗<\/a>/g,'>View COAS</a>').replace(/\s*[↗→](?=\s*(?:<|$))/gm,'').replace(/([↗→])(?=["'`])/g,'');
    if(after!==before)fs.writeFileSync(file,after);
  }
}
visit(path.join(__dirname,'public-build'));
